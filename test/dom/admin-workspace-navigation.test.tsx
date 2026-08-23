import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import useAdminWorkspaceNavigation, {
  getAdminEventScope,
} from "@/app/admin/useAdminWorkspaceNavigation";

type HarnessProps = Partial<{
  isRouteTransitionActive: boolean;
  isSuperAdmin: boolean;
  venueId: string;
}>;

function NavigationHarness({
  isRouteTransitionActive = false,
  isSuperAdmin = false,
  venueId = "venue-a",
}: HarnessProps) {
  const navigation = useAdminWorkspaceNavigation({
    businessDate: "2026-08-20",
    hasCurrentVenue: true,
    isRouteTransitionActive,
    isSuperAdmin,
    venueId,
  });

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
      <button
        onClick={() =>
          navigation.onAnalyticsEventOpen("event-1", "2026-08-19")
        }
      >
        Open event
      </button>
      <input aria-label="Task filter" />
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
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  fireEvent.keyDown(window, { key: "4" });
  assert.equal(screen.getByTestId("active-task").textContent, "guest-list");
  dialog.remove();
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
