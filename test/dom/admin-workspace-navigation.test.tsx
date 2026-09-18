import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useLayoutEffect, useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import useAdminWorkspaceNavigation, {
  focusAdminWorkspaceAfterTaskChange,
  getAdminEventScope,
} from "@/app/admin/useAdminWorkspaceNavigation";

type HarnessProps = Partial<{
  businessDate: string;
  hasCurrentVenue: boolean;
  isRouteTransitionActive: boolean;
  isSuperAdmin: boolean;
  venueId: string;
}>;

function NavigationHarness({
  businessDate = "2026-08-20",
  hasCurrentVenue = true,
  isRouteTransitionActive = false,
  isSuperAdmin = false,
  venueId = "venue-a",
}: HarnessProps) {
  const navigation = useAdminWorkspaceNavigation({
    businessDate,
    hasCurrentVenue,
    isRouteTransitionActive,
    isSuperAdmin,
    venueId,
  });
  const workspaceRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (navigation.workspaceFocusRequestId === 0) return;
    focusAdminWorkspaceAfterTaskChange(workspaceRef.current);
  }, [navigation.workspaceFocusRequestId]);

  return (
    <>
      <output data-testid="active-task">{navigation.activeTask}</output>
      <output data-testid="selected-date">{navigation.selectedDate}</output>
      <output data-testid="selected-event">
        {navigation.selectedEventId ?? "none"}
      </output>
      <button onClick={() => navigation.changeTask("analytics")}>
        Open analytics
      </button>
      <button onClick={() => navigation.changeTask("guest-list")}>
        Open guest list
      </button>
      <input aria-label="Task filter" />
      <input aria-label="Operating date" type="date" value={navigation.selectedDate}
        onChange={(event) => navigation.setSelectedDate(event.target.value)} />
      <button onClick={() => navigation.setSelectedDate(businessDate)}>Today</button>
      <section
        ref={workspaceRef}
        id="admin-workspace"
        aria-label="Admin workspace"
        tabIndex={-1}
      >
        <button key={navigation.activeTask} type="button">
          Workspace action
        </button>
        <button
          onClick={() =>
            navigation.onAnalyticsEventOpen("event-1", "2026-08-19")
          }
        >
          Open event
        </button>
      </section>
    </>
  );
}

function setLocation(search: string) {
  window.history.replaceState(null, "", `/admin${search}`);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setLocation("");
});

test("an explicitly selected operating date survives leaving and reopening Admin", () => {
  const view = render(<NavigationHarness />);
  fireEvent.change(screen.getByLabelText("Operating date"), {
    target: { value: "2026-08-12" },
  });
  view.unmount();
  window.history.replaceState(null, "", "/");
  setLocation("?tab=guests&view=list");
  const reopened = render(<NavigationHarness />);
  assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-12");

  reopened.rerender(<NavigationHarness businessDate="2026-08-21" />);
  assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-12");
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-21");
});

test("legacy saved dates restore while invalid values use the current venue business date", () => {
  for (const saved of ["2026-08-12", "2026-02-30", 42]) {
    window.localStorage.setItem("admin:selectedDate", JSON.stringify(saved));
    const view = render(<NavigationHarness />);
    assert.equal(screen.getByTestId("selected-date").textContent,
      saved === "2026-08-12" ? saved : "2026-08-20");
    view.unmount();
  }
});

test("default dates follow venue readiness and selections do not leak into another venue", () => {
  const view = render(<NavigationHarness hasCurrentVenue={false} venueId="" />);
  view.rerender(<NavigationHarness businessDate="2026-08-19" />);
  assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-19");
  fireEvent.change(screen.getByLabelText("Operating date"), {
    target: { value: "2026-08-12" },
  });
  view.unmount();

  const otherVenue = render(<NavigationHarness venueId="venue-b" businessDate="2026-08-18" />);
  assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-18");
  fireEvent.change(screen.getByLabelText("Operating date"), {
    target: { value: "2026-08-10" },
  });
  otherVenue.rerender(<NavigationHarness venueId="venue-a" businessDate="2026-08-19" />);
  assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-19");
});

test("a current-venue event deep link takes precedence over a saved operating date", () => {
  window.localStorage.setItem("admin:selectedDate", JSON.stringify("2026-08-12"));
  setLocation("?tab=events&view=manage&venue=venue-a&eventId=event-1&date=2026-08-19");
  const view = render(<NavigationHarness />);
  assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-19");
  assert.equal(screen.getByTestId("selected-event").textContent, "event-1");
  view.rerender(<NavigationHarness businessDate="2026-08-21" />);
  assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-19");
  assert.equal(screen.getByTestId("selected-event").textContent, "event-1");
});

test("event scope only accepts a current-venue event with a business date", () => {
  assert.deepEqual(
    getAdminEventScope(
      new URLSearchParams("venue=venue-a&eventId=event-1&date=2026-08-19"),
      "venue-a",
    ),
    { venueId: "venue-a", eventId: "event-1", businessDate: "2026-08-19" },
  );
  assert.equal(
    getAdminEventScope(
      new URLSearchParams("venue=venue-b&eventId=event-1&date=2026-08-19"),
      "venue-a",
    ),
    null,
  );
  assert.equal(
    getAdminEventScope(
      new URLSearchParams("venue=venue-a&eventId=event-1&date=not-a-date"),
      "venue-a",
    ),
    null,
  );
});

test("initial legacy task URL is canonicalized and same-task selection is a history/state no-op", async () => {
  setLocation("?tab=requests");
  const originalPushState = window.history.pushState;
  let pushCount = 0;
  window.history.pushState = function (...args) {
    pushCount += 1;
    return originalPushState.apply(this, args);
  };

  try {
    render(<NavigationHarness />);
    await waitFor(() => {
      assert.equal(screen.getByTestId("active-task").textContent, "guest-requests");
    });
    assert.equal(window.location.search, "?tab=guests&view=requests");

    fireEvent.click(screen.getByRole("button", { name: "Open analytics" }));
    await waitFor(() => {
      assert.equal(screen.getByTestId("active-task").textContent, "analytics");
    });
    assert.equal(pushCount, 1);

    fireEvent.click(screen.getByRole("button", { name: "Open analytics" }));
    assert.equal(pushCount, 1);
  } finally {
    window.history.pushState = originalPushState;
  }
});

test("resolving an Admin destination never selects the legacy Door task first", () => {
  for (const search of ["?tab=links&view=manage", "?tab=users&view=directory", "?tab=analytics", "?tab=events"]) {
    setLocation(search);
    const committed: Array<string | null> = [];
    function Destination() {
      const navigation = useAdminWorkspaceNavigation({ businessDate: "2026-09-18", hasCurrentVenue: true,
        isRouteTransitionActive: false, isSuperAdmin: true, venueId: "venue-a" });
      useLayoutEffect(() => { committed.push(navigation.activeTask); });
      return <output>{navigation.activeTask}</output>;
    }
    const view = render(<Destination />);
    assert.equal(committed[0], null);
    assert.equal(committed.includes("guest-list"), false);
    assert.ok(committed.at(-1));
    view.unmount();
  }
});

test("popstate and analytics handoff apply only a valid current venue event scope", async () => {
  setLocation("?tab=analytics");
  render(<NavigationHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Open event" }));
  await waitFor(() => {
    assert.equal(screen.getByTestId("active-task").textContent, "event-manage");
    assert.equal(screen.getByTestId("selected-date").textContent, "2026-08-19");
    assert.equal(screen.getByTestId("selected-event").textContent, "event-1");
  });
  assert.equal(
    window.location.search,
    "?tab=events&view=manage&venue=venue-a&eventId=event-1&date=2026-08-19",
  );

  setLocation("?tab=events&view=manage&venue=venue-b&eventId=event-2&date=2026-08-18");
  fireEvent.popState(window);
  await waitFor(() => {
    assert.equal(screen.getByTestId("active-task").textContent, "event-manage");
    assert.equal(screen.getByTestId("selected-event").textContent, "none");
  });
});

test("shortcuts skip editable targets, route transitions, and modal dialogs", async () => {
  render(<NavigationHarness />);
  await waitFor(() => {
    assert.equal(screen.getByTestId("active-task").textContent, "guest-list");
  });

  fireEvent.keyDown(screen.getByRole("textbox", { name: "Task filter" }), {
    key: "4",
  });
  assert.equal(screen.getByTestId("active-task").textContent, "guest-list");

  fireEvent.keyDown(window, { key: "4" });
  await waitFor(() => {
    assert.equal(screen.getByTestId("active-task").textContent, "analytics");
  });

  cleanup();
  setLocation("");
  render(<NavigationHarness isRouteTransitionActive />);
  await waitFor(() => {
    assert.equal(screen.getByTestId("active-task").textContent, "guest-list");
  });
  fireEvent.keyDown(window, { key: "4" });
  assert.equal(screen.getByTestId("active-task").textContent, "guest-list");

  cleanup();
  setLocation("");
  render(<NavigationHarness />);
  await waitFor(() => {
    assert.equal(screen.getByTestId("active-task").textContent, "guest-list");
  });
  for (const role of ["alertdialog", "dialog"]) {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", role);
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "4" });
    assert.equal(screen.getByTestId("active-task").textContent, "guest-list");
    dialog.remove();
  }
});

test("task replacement restores only focus lost inside the workspace", async () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  let scrollCalls = 0;
  HTMLElement.prototype.scrollIntoView = () => {
    scrollCalls += 1;
  };

  try {
    render(<NavigationHarness />);
    await waitFor(() => {
      assert.equal(screen.getByTestId("active-task").textContent, "guest-list");
    });
    const workspaceAction = screen.getByRole("button", {
      name: "Workspace action",
    });
    workspaceAction.focus();
    fireEvent.keyDown(window, { key: "4" });
    await waitFor(() => {
      assert.equal(screen.getByTestId("active-task").textContent, "analytics");
      assert.equal(
        document.activeElement === screen.getByRole("region", {
          name: "Admin workspace",
        }),
        true,
      );
    });
    assert.equal(scrollCalls, 1);

    const guestListNavigation = screen.getByRole("button", {
      name: "Open guest list",
    });
    guestListNavigation.focus();
    fireEvent.click(guestListNavigation);
    await waitFor(() => {
      assert.equal(screen.getByTestId("active-task").textContent, "guest-list");
    });
    assert.equal(document.activeElement === guestListNavigation, true);
    assert.equal(scrollCalls, 1);
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  }
});

test("workspace focus fallback does not steal an external connected focus", () => {
  const workspace = document.createElement("section");
  workspace.tabIndex = -1;
  const externalButton = document.createElement("button");
  document.body.append(workspace, externalButton);
  externalButton.focus();

  try {
    assert.equal(focusAdminWorkspaceAfterTaskChange(workspace), false);
    assert.equal(document.activeElement === externalButton, true);
  } finally {
    workspace.remove();
    externalButton.remove();
  }
});

test("role changes replace an unavailable task with the guest list", async () => {
  setLocation("?tab=venues&view=list");
  const { rerender } = render(<NavigationHarness isSuperAdmin />);
  await waitFor(() => {
    assert.equal(screen.getByTestId("active-task").textContent, "venue-list");
  });

  rerender(<NavigationHarness isSuperAdmin={false} />);
  await waitFor(() => {
    assert.equal(screen.getByTestId("active-task").textContent, "guest-list");
  });
  assert.equal(window.location.search, "?tab=guests&view=list");
});
