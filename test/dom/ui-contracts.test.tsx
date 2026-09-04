import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useCallback, useEffect, useRef, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import AdminTaskSwitcher from "@/app/admin/components/AdminTaskSwitcher";
import AnalyticsAttendance from "@/app/admin/components/analytics/AnalyticsAttendance";
import AnalyticsContributors from "@/app/admin/components/analytics/AnalyticsContributors";
import AnalyticsPeriodBar from "@/app/admin/components/analytics/AnalyticsPeriodBar";
import ExternalDjCombobox from "@/app/admin/components/ExternalDjCombobox";
import ExternalEventCombobox from "@/app/admin/components/ExternalEventCombobox";
import AsyncListContent from "@/components/AsyncListContent";
import ConfirmDialog from "@/components/ConfirmDialog";
import GuestListCard from "@/components/GuestListCard";
import OperationalSectionNav from "@/components/OperationalSectionNav";
import GuestBulkEntry from "@/components/GuestBulkEntry";
import {
  RouteTransitionProvider,
  useRouteTransition,
} from "@/components/RouteTransitionProvider";
import useMobileDockInset from "@/app/door/components/useMobileDockInset";
import { EMPTY_ANALYTICS_DTO_FIXTURE } from "@/lib/analytics/test-fixtures";
import { useLatestRef } from "@/lib/hooks";
import messages from "@/messages/en.json";

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
}

afterEach(() => {
  cleanup();
  document.getElementById("main-content")?.removeAttribute("inert");
});

test("latest ref keeps a loader stable while reading the latest translator", () => {
  let loader: (() => string) | undefined;

  function LoaderHarness({
    translate,
  }: {
    translate: (key: string) => string;
  }) {
    const translateRef = useLatestRef(translate);
    loader = useCallback(
      () => translateRef.current("loadFailed"),
      [translateRef],
    );
    return null;
  }

  const { rerender } = render(
    <LoaderHarness translate={() => "Unable to load guests"} />,
  );
  const initialLoader = loader;

  assert.equal(initialLoader?.(), "Unable to load guests");

  rerender(<LoaderHarness translate={() => "게스트를 불러올 수 없습니다"} />);

  assert.equal(loader, initialLoader);
  assert.equal(loader?.(), "게스트를 불러올 수 없습니다");
});

test("mobile Door dock measures its rendered height and clears the page inset", async () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = globalThis.ResizeObserver;
  const observerState: { callback: ResizeObserverCallback | null } = {
    callback: null,
  };
  let isDisconnected = false;

  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      observerState.callback = callback;
    }

    observe() {}

    unobserve() {}

    disconnect() {
      isDisconnected = true;
    }
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
  window.matchMedia = () => ({
    matches: true,
    media: "(max-width: 767px)",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });

  function DockHarness() {
    const dockRef = useRef<HTMLElement>(null);
    useMobileDockInset(dockRef);
    return (
      <div className="page-scroll">
        <section ref={dockRef} data-testid="door-dock" />
      </div>
    );
  }

  const { unmount } = render(<DockHarness />);
  const dock = screen.getByTestId("door-dock");
  Object.defineProperty(dock, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ height: 173 }),
  });
  observerState.callback?.([], {} as ResizeObserver);

  const pageScroll = dock.closest<HTMLElement>(".page-scroll");
  await waitFor(() => {
    assert.equal(
      pageScroll?.style.getPropertyValue("--door-mobile-dock-height"),
      "173px",
    );
  });

  unmount();
  assert.equal(isDisconnected, true);
  assert.equal(
    pageScroll?.style.getPropertyValue("--door-mobile-dock-height"),
    "",
  );
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: originalResizeObserver,
  });
});

test("full error hides empty copy and retry success restores it", () => {
  const { rerender } = render(
    <AsyncListContent
      state="error"
      loading={<p>LOADING</p>}
      empty={<p>EMPTY</p>}
    >
      <p>DATA</p>
    </AsyncListContent>,
  );

  assert.equal(screen.queryByText("EMPTY"), null);
  assert.equal(screen.queryByText("DATA"), null);

  rerender(
    <AsyncListContent
      state="success-empty"
      loading={<p>LOADING</p>}
      empty={<p>EMPTY</p>}
    >
      <p>DATA</p>
    </AsyncListContent>,
  );
  assert.ok(screen.getByText("EMPTY"));
});

test("task and section controls expose current state and respect busy locks", () => {
  let nextTask = "";
  const { rerender } = render(
    <AdminTaskSwitcher
      label="Admin sections"
      groupLabels={{
        guests: "Guests",
        events: "Events",
        links: "Links",
        users: "Users",
        analytics: "Analytics",
        venues: "Venues",
      }}
      options={[
        { id: "guest-list", group: "guests", label: "Guest list" },
        { id: "link-create", group: "links", label: "Create link" },
      ]}
      value="guest-list"
      onChange={(task) => {
        nextTask = task;
      }}
    />,
  );

  const activeLinks = screen.getAllByRole("link", { name: /Guest list/i });
  assert.ok(activeLinks.every((link) => link.getAttribute("aria-current") === "page"));
  fireEvent.click(screen.getAllByRole("link", { name: /Create link/i })[0]);
  assert.equal(nextTask, "link-create");

  rerender(
    <AdminTaskSwitcher
      label="Admin sections"
      groupLabels={{
        guests: "Guests",
        events: "Events",
        links: "Links",
        users: "Users",
        analytics: "Analytics",
        venues: "Venues",
      }}
      options={[
        { id: "guest-list", group: "guests", label: "Guest list" },
        { id: "link-create", group: "links", label: "Create link" },
      ]}
      value="guest-list"
      onChange={() => {}}
      disabled
    />,
  );
  assert.ok(
    screen
      .getAllByRole("link")
      .every((link) => link.getAttribute("aria-disabled") === "true"),
  );

  cleanup();
  render(
    <OperationalSectionNav
      label="Link section"
      items={[
        { id: "create", label: "Create", icon: "add" },
        { id: "manage", label: "Manage", icon: "link" },
      ]}
      activeId="create"
      onChange={() => {}}
      disabled
    />,
  );
  assert.equal(
    screen.getByRole("button", { name: "Create" }).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(screen.getByRole("button", { name: "Manage" }).hasAttribute("disabled"), true);
});

test("analytics period controls expose selection and keyboard-native navigation", () => {
  let previousAnchor = "";
  let nextGranularity = "";
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        AdminAnalytics: {
          refresh: "Refresh",
          period: {
            granularity: "Period unit",
            selected: "Selected period",
            month: "Month",
            quarter: "Quarter",
            year: "Year",
            previous: "Previous period",
            next: "Next period",
            inProgress: "In progress",
            loading: "Preparing period",
            comparison: "Compared with {start}-{end}",
          },
          coverage: {
            summary: "{confirmed} confirmed, {days} days, {unconfirmed} unconfirmed",
          },
        },
      }}
    >
      <AnalyticsPeriodBar
        granularity="month"
        view={EMPTY_ANALYTICS_DTO_FIXTURE}
        isLoading={false}
        onGranularityChange={(value) => {
          nextGranularity = value;
        }}
        onAnchorDateChange={(value) => {
          previousAnchor = value;
        }}
        onRefresh={() => {}}
      />
    </NextIntlClientProvider>,
  );

  assert.equal(
    screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed"),
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Quarter" }));
  assert.equal(nextGranularity, "quarter");
  fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
  assert.equal(previousAnchor, "2026-07-01");
});

test("attendance analytics keeps KPI definitions and its empty state visible", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        AdminAnalytics: {
          comparison: {
            notCalculable: "Comparison unavailable",
            noBaseline: "No comparison baseline",
          },
          attendance: {
            title: "Total attendance",
            description: "Checked-in guests plus net walk-ins.",
            totalAttendance: "Total attendance",
            checkedInGuests: "Checked-in guests",
            walkIns: "Walk-ins",
            attendancePerOperatingDay: "Attendance per operating day",
            trendTitle: "Attendance trend",
            trendDescription: "Attendance over time.",
            tableTitle: "Attendance chart data",
            date: "Period",
            empty: "No attendance was recorded for this period.",
            definition: "This is not a unique-visitor count.",
          },
        },
      }}
    >
      <AnalyticsAttendance attendance={EMPTY_ANALYTICS_DTO_FIXTURE.attendance} />
    </NextIntlClientProvider>,
  );

  assert.ok(screen.getByRole("heading", { name: "Total attendance" }));
  assert.ok(screen.getByText("Checked-in guests"));
  assert.ok(screen.getByText("Walk-ins"));
  assert.ok(screen.getByText("Attendance per operating day"));
  assert.ok(screen.getByText("No attendance was recorded for this period."));
});

test("named unmapped contributors show only their source name", () => {
  render(
    <NextIntlClientProvider
      locale="ko"
      messages={{
        AdminAnalytics: {
          contributors: {
            title: "DJ·기여자별 게스트",
            description: "미연결 출처는 확인 가능한 이름을 표시합니다.",
            name: "DJ·기여자",
            operatingDays: "등록 영업일",
            sort: "정렬 기준",
            ascending: "오름차순",
            descending: "내림차순",
            deleted: "삭제된 기여자",
            unmappedLink: "미연결 외부 링크",
            unmappedUser: "미연결 내부 계정",
            unattributed: "귀속되지 않은 등록",
          },
          summary: {
            registered: "등록 게스트",
            checkedIn: "입장 게스트",
            entryRatePercent: "입장률",
          },
        },
      }}
    >
      <AnalyticsContributors
        rows={[
          {
            contributorId: null,
            displayName: "DJ Nova",
            sourceStatus: "unmapped",
            source: { kind: "external_link", id: "link-nova" },
            operatingDays: 2,
            registered: 12,
            checkedIn: 9,
            entryRatePercent: 75,
            registeredPerOperatingDay: 6,
          },
          {
            contributorId: null,
            displayName: "Staff Mina",
            sourceStatus: "unmapped",
            source: { kind: "user", id: "user-mina" },
            operatingDays: 1,
            registered: 8,
            checkedIn: 5,
            entryRatePercent: 62.5,
            registeredPerOperatingDay: 8,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );

  assert.equal(screen.getAllByText("DJ Nova").length, 3);
  assert.equal(screen.getAllByText("Staff Mina").length, 3);
  assert.equal(screen.queryByText(/DJ Nova.*미연결 외부 링크/), null);
  assert.equal(screen.queryByText(/Staff Mina.*미연결 내부 계정/), null);
  assert.ok(screen.getByRole("columnheader", { name: "DJ·기여자" }));
});

test("external DJ autocomplete supports keyboard selection and a new-name fallback", () => {
  function Harness() {
    const [value, setValue] = useState("");
    const [contributorId, setContributorId] = useState<string | null>(null);

    return (
      <>
        <label htmlFor="link-dj-name">DJ name</label>
        <ExternalDjCombobox
          value={value}
          contributorId={contributorId}
          suggestions={[
            {
              contributorId: "dj-stann",
              displayName: "DJ STANN",
              linkCount: 4,
              lastUsedDate: "2026-08-16",
            },
            {
              contributorId: "dj-stanley",
              displayName: "DJ STANLEY",
              linkCount: 2,
              lastUsedDate: "2026-08-10",
            },
          ]}
          isDirectoryEnabled
          isDirectoryLoading={false}
          directoryError={null}
          disabled={false}
          hasError={false}
          onChange={(nextValue, nextContributorId) => {
            setValue(nextValue);
            setContributorId(nextContributorId);
          }}
        />
        <output data-testid="selected-dj">{contributorId ?? "new"}</output>
      </>
    );
  }

  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        LinkAdmin: {
          djName: "DJ name",
          djSuggestions: "Existing DJ names",
          djPreviousLinks: "{count} previous links",
          djSuggestionsLoading: "Loading existing DJ names.",
          existingDjSelected:
            "Linking to existing DJ {name}. {count} previous links",
          newDjWillBeCreated: "A new DJ will be added.",
          djAutocompleteHelp: "Start typing to choose a DJ registered before.",
        },
      }}
    >
      <Harness />
    </NextIntlClientProvider>,
  );

  const input = screen.getByRole("combobox", { name: "DJ name" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "DJ STA" } });
  assert.ok(screen.getByRole("listbox", { name: "Existing DJ names" }));

  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.equal((input as HTMLInputElement).value, "DJ STANN");
  assert.equal(screen.getByTestId("selected-dj").textContent, "dj-stann");
  assert.equal(screen.queryByRole("listbox"), null);

  fireEvent.change(input, { target: { value: "DJ NEW" } });
  assert.equal(screen.getByTestId("selected-dj").textContent, "new");
  assert.ok(screen.getByText("A new DJ will be added."));

  fireEvent.change(input, { target: { value: "DJ STA" } });
  assert.ok(screen.getByRole("listbox"));
  fireEvent.keyDown(input, { key: "Escape" });
  assert.equal(screen.queryByRole("listbox"), null);
});

test("external event autocomplete supports keyboard selection and free text", () => {
  function Harness() {
    const [value, setValue] = useState("");
    return (
      <>
        <label htmlFor="link-event-name">Event name</label>
        <ExternalEventCombobox
          value={value}
          suggestions={[
            {
              eventName: "FRIDAY NIGHT",
              linkCount: 4,
              lastUsedDate: "2026-08-16",
            },
            {
              eventName: "SATURDAY NIGHT",
              linkCount: 2,
              lastUsedDate: "2026-08-10",
            },
          ]}
          isLoading={false}
          directoryError={null}
          disabled={false}
          hasError={false}
          onChange={setValue}
        />
        <output data-testid="event-value">{value}</output>
      </>
    );
  }

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Harness />
    </NextIntlClientProvider>,
  );

  const input = screen.getByRole("combobox", { name: "Event name" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "fri" } });
  assert.ok(screen.getByRole("listbox", { name: "Existing event names" }));
  fireEvent.keyDown(input, { key: "Enter" });
  assert.equal(screen.getByTestId("event-value").textContent, "FRIDAY NIGHT");
  assert.equal(screen.queryByRole("listbox"), null);

  fireEvent.change(input, { target: { value: "NEW EVENT" } });
  assert.equal(screen.getByTestId("event-value").textContent, "NEW EVENT");
  assert.equal(input.getAttribute("aria-expanded"), "false");
});

test("dialog traps the interaction, Escape closes it, and focus returns", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <ConfirmDialog
          open={open}
          title="Confirm action"
          description="Check before continuing"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          onConfirm={() => {}}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open dialog" });
  opener.focus();
  fireEvent.click(opener);

  const dialog = screen.getByRole("alertdialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById("main-content")?.hasAttribute("inert"), true);
  assert.equal(document.activeElement, screen.getByRole("button", { name: "Cancel" }));

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => assert.equal(screen.queryByRole("alertdialog"), null));
  assert.equal(document.activeElement, opener);
});

test("busy dialog reports aria-busy and ignores Escape", () => {
  let cancelled = false;
  render(
    <NextIntlClientProvider locale="en" messages={{ Common: { loading: "Loading" } }}>
      <ConfirmDialog
        open
        title="Busy action"
        description="Please wait"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
        isLoading
      />
    </NextIntlClientProvider>,
  );

  const dialog = screen.getByRole("alertdialog");
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  assert.equal(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"), true);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(cancelled, false);
  assert.ok(screen.getByRole("alertdialog"));
});

test("dialog falls back to main when confirmation removes its opener", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [showOpener, setShowOpener] = useState(true);
    return (
      <>
        {showOpener && (
          <button type="button" onClick={() => setOpen(true)}>
            Remove opener
          </button>
        )}
        <ConfirmDialog
          open={open}
          title="Remove opener"
          description="The opener will no longer exist."
          confirmLabel="Confirm removal"
          cancelLabel="Cancel"
          onConfirm={() => {
            setShowOpener(false);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Remove opener" });
  opener.focus();
  fireEvent.click(opener);
  const confirmButton = screen.getByRole("button", {
    name: "Confirm removal",
  });
  confirmButton.focus();
  fireEvent.click(confirmButton);

  assert.equal(screen.queryByRole("button", { name: "Remove opener" }), null);
  assert.equal(document.activeElement, document.getElementById("main-content"));
});

test("dialog cleanup preserves focus already moved outside", () => {
  let closeDialog: (() => void) | null = null;
  function Harness() {
    const [open, setOpen] = useState(false);
    closeDialog = () => setOpen(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open focus guard
        </button>
        <ConfirmDialog
          open={open}
          title="Focus guard"
          description="Preserve a newer focus target."
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          onConfirm={() => {}}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open focus guard" });
  opener.focus();
  fireEvent.click(opener);
  const externalButton = document.createElement("button");
  externalButton.textContent = "External focus";
  document.body.append(externalButton);

  try {
    externalButton.focus();
    act(() => closeDialog?.());
    assert.equal(document.activeElement, externalButton);
  } finally {
    externalButton.remove();
  }
});

test("guest deletion dialog explains that analytics will change", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        Common: {
          waitingStatus: "Status: waiting.",
          delete: "Delete",
          deleteGuest: "Delete guest",
          removeGuestConfirm:
            "Deleting this guest registration removes it from the guest list and analytics. Continue?",
          cancel: "Cancel",
        },
      }}
    >
      <GuestListCard
        guest={{ id: "guest-a", name: "Guest A", status: "pending" }}
        index={0}
        onDelete={() => {}}
      />
    </NextIntlClientProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete guest" });
  const descriptionId = dialog.getAttribute("aria-describedby");
  assert.ok(descriptionId);
  assert.equal(
    document.getElementById(descriptionId)?.textContent,
    "Deleting this guest registration removes it from the guest list and analytics. Continue?",
  );
});

test("CSV mapping and line preview controls keep native labels and file boundaries", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        BulkGuestEntry: {
          title: "Paste multiple names",
          optional: "Optional",
          fieldLabel: "Names to paste",
          placeholder: "One name per line",
          helper: "Review names",
          csv: {
            fileLabel: "Import a CSV file",
            helper: "Choose the name column",
          },
        },
      }}
    >
      <GuestBulkEntry
        existingNames={[]}
        remaining={10}
        onSubmitChunk={async () => ({ data: { items: [] }, error: null })}
      />
    </NextIntlClientProvider>,
  );

  const fileInput = screen.getByLabelText("Import a CSV file");
  assert.equal(fileInput.getAttribute("type"), "file");
  assert.match(fileInput.getAttribute("accept") ?? "", /text\/csv/);
  assert.equal(screen.getByLabelText("Names to paste").tagName, "TEXTAREA");
});

test("bulk guest submit uses a synchronous ref latch for same-tick clicks", async () => {
  let resolve!: (value: {
    data: {
      items: Array<{ index: number; status: "created"; guest: unknown }>;
    };
    error: null;
  }) => void;
  const submission = new Promise<{
    data: {
      items: Array<{ index: number; status: "created"; guest: unknown }>;
    };
    error: null;
  }>((done) => {
    resolve = done;
  });
  let calls = 0;
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GuestBulkEntry
        existingNames={[]}
        remaining={10}
        onSubmitChunk={async () => {
          calls += 1;
          return submission;
        }}
      />
    </NextIntlClientProvider>,
  );

  await act(async () => {
    fireEvent.change(screen.getByLabelText("Names to paste"), {
      target: { value: "Guest A" },
    });
  });
  const submit = screen.getByRole("button", { name: "Add 1" });
  await act(async () => {
    fireEvent.click(submit);
    fireEvent.click(submit);
    await Promise.resolve();
  });
  assert.equal(calls, 1);

  await act(async () => {
    resolve({
      data: { items: [{ index: 0, status: "created", guest: {} }] },
      error: null,
    });
    await submission;
  });
});

test("bulk submit reports completion after unmount while its request is pending", async () => {
  let resolve!: (value: {
    data: {
      items: Array<{ index: number; status: "created"; guest: unknown }>;
    };
    error: null;
  }) => void;
  const submission = new Promise<{
    data: {
      items: Array<{ index: number; status: "created"; guest: unknown }>;
    };
    error: null;
  }>((done) => {
    resolve = done;
  });
  const submittingStates: boolean[] = [];
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GuestBulkEntry
        existingNames={[]}
        remaining={10}
        onSubmitChunk={async () => submission}
        onSubmittingChange={(isSubmitting) =>
          submittingStates.push(isSubmitting)
        }
      />
    </NextIntlClientProvider>,
  );

  await act(async () => {
    fireEvent.change(screen.getByLabelText("Names to paste"), {
      target: { value: "Guest A" },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add 1" }));
    await Promise.resolve();
  });
  assert.deepEqual(submittingStates, [true]);
  view.unmount();

  await act(async () => {
    resolve({
      data: { items: [{ index: 0, status: "created", guest: {} }] },
      error: null,
    });
    await submission;
  });
  assert.deepEqual(submittingStates, [true, false]);
});

test("a cancelled route-owned target restore falls back to main after overlay removal", async () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const setupMain = document.getElementById("main-content");
  setupMain?.removeAttribute("id");
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  window.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };

  try {
    function Target({ label }: { label: string }) {
      const targetRef = useRef<HTMLHeadingElement>(null);
      const { requestFocusRestore } = useRouteTransition();
      useEffect(() => {
        const cancel = requestFocusRestore(targetRef);
        return cancel;
      }, [requestFocusRestore]);
      return (
        <h1 ref={targetRef} tabIndex={-1}>
          {label}
        </h1>
      );
    }

    function Harness() {
      const { registerRouteLoadingTask } = useRouteTransition();
      const releaseRef = useRef<(() => void) | null>(null);
      const [target, setTarget] = useState<"A" | "B" | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              releaseRef.current = registerRouteLoadingTask();
              setTarget("A");
            }}
          >
            Start route
          </button>
          <button type="button" onClick={() => releaseRef.current?.()}>
            Release route
          </button>
          <button type="button" onClick={() => setTarget("B")}>
            Latest target
          </button>
          <button type="button" onClick={() => setTarget(null)}>
            Unmount target
          </button>
          <main id="main-content" tabIndex={-1}>
            Main fallback
          </main>
          {target && <Target key={target} label={`${target} target`} />}
        </>
      );
    }

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RouteTransitionProvider>
          <Harness />
        </RouteTransitionProvider>
      </NextIntlClientProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start route" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Release route"));
    });
    await waitFor(() => {
      assert.equal(
        document.querySelector(".route-transition-overlay") === null,
        true,
      );
    });
    await waitFor(() => {
      assert.equal(frames.size > 0, true);
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Latest target"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Unmount target"));
    });
    await act(async () => {
      for (const callback of [...frames.values()]) callback(performance.now());
      frames.clear();
    });

    const main = screen.getByText("Main fallback");
    assert.equal(document.activeElement === main, true);
    assert.equal(main.dataset.routeFocus, "true");
    assert.equal(main.closest("[inert]") === null, true);
    assert.equal(
      document.querySelector(".route-transition-overlay") === null,
      true,
    );
  } finally {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    setupMain?.setAttribute("id", "main-content");
  }
});
