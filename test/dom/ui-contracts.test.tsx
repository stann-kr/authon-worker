import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { useCallback, useEffect, useRef, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import AdminTaskSwitcher from "@/app/admin/components/AdminTaskSwitcher";
import AnalyticsAttendance from "@/app/admin/components/analytics/AnalyticsAttendance";
import AnalyticsContributors from "@/app/admin/components/analytics/AnalyticsContributors";
import AnalyticsPeriodBar from "@/app/admin/components/analytics/AnalyticsPeriodBar";
import ExternalDjCombobox from "@/app/admin/components/ExternalDjCombobox";
import ExternalEventCombobox from "@/app/admin/components/ExternalEventCombobox";
import AsyncListContent from "@/components/AsyncListContent";
import ConfirmDialog from "@/components/ConfirmDialog";
import Sheet from "@/components/overlays/Sheet";
import RecordList, { useRecordDetail } from "@/components/records/RecordList";
import DateField from "@/components/dates/DateField";
import RosterView, { type RosterStatus } from "@/components/guests/RosterView";
import GuestListCard from "@/components/GuestListCard";
import OperationalSectionNav from "@/components/OperationalSectionNav";
import GuestBulkEntry from "@/components/GuestBulkEntry";
import EventScopeSelector from "@/components/EventScopeSelector";
import OperationsScope from "@/components/operations/OperationsScope";
import {
  RouteTransitionProvider,
  useRouteTransition,
} from "@/components/RouteTransitionProvider";
import useMobileDockInset from "@/app/door/components/useMobileDockInset";
import { EMPTY_ANALYTICS_DTO_FIXTURE } from "@/lib/analytics/test-fixtures";
import { useLatestRef, useLocalStorage } from "@/lib/hooks";
import messages from "@/messages/en.json";

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
}

afterEach(() => {
  cleanup();
  document.getElementById("main-content")?.removeAttribute("inert");
});

test("date selection handles leap days, preserves month-control focus and cancels browsing without changing the value", async () => {
  const dayName = (date: string) => new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(new Date(`${date}T12:00:00`));
  function Harness() {
    const [value, setValue] = useState("2024-02-28");
    return <><label htmlFor="visit-date">Visit date</label>
      <DateField id="visit-date" value={value} onChange={setValue} businessDate="2024-03-01" /></>;
  }
  render(<NextIntlClientProvider locale="en" messages={messages}><RouteTransitionProvider><Harness /></RouteTransitionProvider></NextIntlClientProvider>);
  const field = screen.getByRole("combobox", { name: "Visit date" }) as HTMLInputElement;
  field.focus();
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => assert.equal(document.activeElement === screen.getByRole("button", { name: dayName("2024-02-28") }), true));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  assert.equal(document.activeElement === screen.getByRole("button", { name: dayName("2024-02-29") }), true);
  fireEvent.click(document.activeElement!);
  assert.equal(field.value, "2024-02-29");
  assert.equal(screen.queryByRole("region") === null, true);
  await waitFor(() => assert.equal(document.activeElement === field, true));

  fireEvent.click(field);
  await waitFor(() => assert.equal(document.activeElement === screen.getByRole("button", { name: dayName("2024-02-29") }), true));
  const next = screen.getByRole("button", { name: "Next month" });
  next.focus();
  fireEvent.click(next);
  assert.ok(screen.getByRole("grid", { name: "March 2024" }));
  assert.equal(document.activeElement === next, true);
  const year = screen.getByRole("spinbutton", { name: "Year" });
  act(() => year.focus());
  fireEvent.change(year, { target: { value: "" } });
  assert.equal((year as HTMLInputElement).value, "");
  fireEvent.change(year, { target: { value: "2025" } });
  assert.equal(document.activeElement === year, true);
  fireEvent.change(screen.getByRole("combobox", { name: "Month" }), { target: { value: "1" } });
  assert.ok(screen.getByRole("grid", { name: "February 2025" }));
  assert.ok(screen.getByRole("button", { name: dayName("2025-02-28") }));
  fireEvent.keyDown(year, { key: "Escape" });
  assert.equal(field.value, "2024-02-29");
  await waitFor(() => assert.equal(document.activeElement === field, true));
});

test("an inline calendar keeps its parent available and restores field focus", async () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return <><main id="main-content">Workspace</main>
      <Sheet open={open} title="Scope" onClose={() => setOpen(false)}>
        <label htmlFor="scope-date">Operating date</label>
        <DateField id="scope-date" value="2026-09-12" onChange={() => {}} />
      </Sheet></>;
  }
  render(<NextIntlClientProvider locale="en" messages={messages}><RouteTransitionProvider><Harness /></RouteTransitionProvider></NextIntlClientProvider>);
  const parent = screen.getByRole("region", { name: "Scope" });
  const field = screen.getByRole("combobox", { name: "Operating date" });
  field.focus();
  fireEvent.click(field);
  assert.equal(parent.hasAttribute("inert"), false);
  assert.ok(screen.getByRole("region", { name: "Choose date" }));
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  assert.equal(screen.queryByRole("region", { name: "Choose date" }) === null, true);
  assert.equal(parent.hasAttribute("inert"), false);
  assert.equal(document.getElementById("main-content")!.hasAttribute("inert"), false);
  await waitFor(() => assert.equal(document.activeElement === field, true));
  fireEvent.keyDown(field, { key: "Escape" });
  assert.equal(screen.queryByRole("region") === null, true);
  assert.equal(document.getElementById("main-content")!.hasAttribute("inert"), false);
});

test("saved workspace preferences restore without replacing server-rendered controls", async () => {
  const key = "test:workspace-hydration";
  window.localStorage.removeItem(key);
  function Harness() {
    const [venue, setVenue] = useLocalStorage(key, "");
    return <button onClick={() => setVenue((current) => `${current}-next`)}>{venue || "Choose venue"}</button>;
  }
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Harness />);
  const originalButton = container.querySelector("button");
  document.body.append(container);
  window.localStorage.setItem(key, JSON.stringify("saved-venue"));
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <Harness />, { onRecoverableError: (error) => errors.push(error) });
    });
    assert.deepEqual(errors, []);
    const restored = within(container).getByRole("button", { name: "saved-venue" });
    assert.equal(restored, originalButton);
    fireEvent.click(restored);
    assert.equal(restored.textContent, "saved-venue-next");
    assert.equal(JSON.parse(window.localStorage.getItem(key)!), "saved-venue-next");
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    window.localStorage.removeItem(key);
  }
});

test("event selection, scope sheet reopening and parent renders reuse the loaded event list", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ data: [
      { id: "event-a", name: "Event A", state: "open", compatibilityKey: null },
      { id: "event-b", name: "Event B", state: "open", compatibilityKey: null },
    ], error: null });
  };
  function Harness({ revision }: { revision: number }) {
    const [value, setValue] = useState<string | null>(null);
    return <NextIntlClientProvider locale="en" messages={messages}>
      <EventScopeSelector venueId="venue-a" businessDate="2026-09-12" value={value}
        onChange={(id) => setValue(id)} renderScope={(control, label) =>
          <OperationsScope date="2026-09-12" label={label}>{control}</OperationsScope>} />
      <output>{revision}</output>
    </NextIntlClientProvider>;
  }
  try {
    const view = render(<Harness revision={0} />);
    fireEvent.click(screen.getByRole("button", { name: messages.Workspace.chooseScope }));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await waitFor(() => assert.equal(select.disabled, false));
    fireEvent.change(select, { target: { value: "event-a" } });
    fireEvent.click(screen.getByRole("button", { name: messages.Workspace.applyScope }));
    assert.equal(screen.queryByRole("combobox") === null, true);
    view.rerender(<Harness revision={1} />);
    await act(async () => {});
    const scope = screen.getByRole("button", { name: messages.Workspace.chooseScope });
    assert.match(scope.textContent ?? "", /Event A/);
    fireEvent.click(scope);
    const reopened = screen.getByRole("combobox") as HTMLSelectElement;
    assert.equal(reopened.value, "event-a");
    assert.equal(reopened.disabled, false);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("event list network failure releases loading and supports retry", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw new TypeError("Network failed");
    return Response.json({ data: [], error: null });
  };
  try {
    render(<NextIntlClientProvider locale="en" messages={messages}>
      <EventScopeSelector venueId="venue-a" businessDate="2026-09-12" value={null} onChange={() => {}} />
    </NextIntlClientProvider>);
    const retry = await screen.findByRole("button", { name: messages.EventScope.retry });
    assert.equal((screen.getByRole("combobox") as HTMLSelectElement).disabled, false);
    fireEvent.click(retry);
    await waitFor(() => assert.equal(screen.queryByRole("button", { name: messages.EventScope.retry }) === null, true));
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
            summary: "{days} guest registration days",
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
  assert.ok(screen.getByText(/Compared with 2026-07-01-2026-07-31/));
});

test("attendance analytics keeps KPIs and its empty state visible", () => {
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

test("attendance chart data remains available through its disclosure", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  try {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AnalyticsAttendance
          attendance={{
            ...EMPTY_ANALYTICS_DTO_FIXTURE.attendance,
            trend: [{
              bucketStartDate: "2026-08-07",
              checkedInGuests: 1,
              walkIns: 3,
              totalAttendance: 4,
              operatingDays: 1,
            }],
          }}
        />
      </NextIntlClientProvider>,
    );

    const title = messages.AdminAnalytics.attendance.tableTitle;
    const summary = screen.getByText(title, { selector: "summary span" });
    const details = summary.closest("details");
    assert.ok(details);
    assert.equal(details.open, false);
    fireEvent.click(summary);
    assert.equal(details.open, true);
    assert.ok(screen.getByRole("table", { name: title }));
    assert.ok(screen.getByRole("cell", { name: "4" }));
  } finally {
    globalThis.ResizeObserver = originalResizeObserver;
  }
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
          djSuggestionsLoading: "Loading existing DJ names.",
          existingDjSelected: "{name} selected",
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
  assert.equal(screen.queryByRole("listbox") === null, true);

  fireEvent.change(input, { target: { value: "DJ NEW" } });
  assert.equal(screen.getByTestId("selected-dj").textContent, "new");
  assert.equal(
    document.getElementById(input.getAttribute("aria-describedby")!)?.textContent,
    "",
  );

  fireEvent.change(input, { target: { value: "DJ STA" } });
  assert.ok(screen.getByRole("listbox"));
  fireEvent.keyDown(input, { key: "Escape" });
  assert.equal(screen.queryByRole("listbox") === null, true);
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
  assert.equal(screen.queryByRole("listbox") === null, true);

  fireEvent.change(input, { target: { value: "NEW EVENT" } });
  assert.equal(screen.getByTestId("event-value").textContent, "NEW EVENT");
  assert.equal(input.getAttribute("aria-expanded"), "false");
});

for (const withDescription of [true, false]) {
const role = "group";
test(`inline confirmation description=${withDescription}, Escape closes it, and focus returns`, async () => {
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
          description={withDescription ? "Check before continuing" : undefined}
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

  const dialog = screen.getByRole(role);
  assert.equal(dialog.hasAttribute("aria-modal"), false);
  assert.equal(dialog.hasAttribute("aria-describedby"), withDescription);
  assert.equal(document.getElementById("main-content")?.hasAttribute("inert"), false);
  assert.equal(document.activeElement === screen.getByRole("button", { name: "Cancel" }), true);

  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  await waitFor(() => assert.equal(screen.queryByRole(role) === null, true));
  assert.equal(document.activeElement === opener, true);
});
}

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

  const dialog = screen.getByRole("group");
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  assert.equal(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"), true);
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  assert.equal(cancelled, false);
  assert.ok(screen.getByRole("group"));
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

  assert.equal(screen.queryByRole("button", { name: "Remove opener" }) === null, true);
  assert.equal(document.activeElement === document.getElementById("main-content"), true);
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
    assert.equal(document.activeElement === externalButton, true);
  } finally {
    externalButton.remove();
  }
});

test("pending guest deletion confirms inline, restores focus, and respects a new disabled state", () => {
  let deleteCalls = 0;
  const card = (disabled = false) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <GuestListCard
        guest={{ id: "guest-a", name: "Guest A", status: "pending" }}
        index={0}
        isDeleteDisabled={disabled}
        onDelete={() => { deleteCalls += 1; }}
      />
    </NextIntlClientProvider>
  );
  const view = render(card());
  const trigger = screen.getByRole("button", { name: "Delete" });
  trigger.focus();
  fireEvent.click(trigger);
  assert.equal(deleteCalls, 0);
  assert.equal(screen.queryByRole("alertdialog") === null, true);
  assert.equal(document.getElementById("main-content")?.hasAttribute("inert"), false);
  const group = screen.getByRole("group", { name: /Guest A/ });
  assert.equal(document.activeElement === within(group).getByRole("button", { name: "Cancel" }), true);
  fireEvent.keyDown(group, { key: "Escape" });
  assert.equal(screen.queryByRole("group") === null, true);
  assert.equal(document.activeElement === trigger, true);

  fireEvent.click(trigger);
  view.rerender(card(true));
  const confirm = within(screen.getByRole("group")).getByRole("button", { name: "Delete" });
  assert.equal(confirm.hasAttribute("disabled"), true);
  fireEvent.click(confirm);
  assert.equal(deleteCalls, 0);
  view.rerender(card());
  fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: "Delete" }));
  assert.equal(deleteCalls, 1);
  assert.equal(screen.queryByRole("group") === null, true);
});

test("removing a pending guest row returns focus to the main content", () => {
  function Harness() {
    const [isRemoved, setIsRemoved] = useState(false);
    return (
      <NextIntlClientProvider locale="en" messages={messages}>
        {!isRemoved && (
          <GuestListCard
            guest={{ id: "guest-a", name: "Guest A", status: "pending" }}
            index={0}
            onDelete={() => setIsRemoved(true)}
          />
        )}
      </NextIntlClientProvider>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: "Delete" }));
  assert.equal(screen.queryByRole("article") === null, true);
  assert.equal(document.activeElement === document.getElementById("main-content"), true);
});

test("checked guest deletion requires a fresh named dialog after the guest status changes", () => {
  let deleteCalls = 0;
  const card = (status: "pending" | "checked", disabled = false) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <GuestListCard
        guest={{ id: "guest-a", name: "Guest A", status }}
        index={0}
        mode="operations"
        isDeleteDisabled={disabled}
        onDelete={() => { deleteCalls += 1; }}
      />
    </NextIntlClientProvider>
  );
  const view = render(card("pending"));
  fireEvent.click(screen.getByRole("button", { name: "Guest A" }));
  fireEvent.click(screen.getByRole("button", { name: messages.Common.deleteGuest }));
  assert.ok(screen.getByRole("group"));
  view.rerender(card("checked"));
  assert.equal(screen.queryByRole("group") === null, true);
  assert.equal(screen.queryByRole("group") === null, true);
  assert.ok(screen.getByRole("region", { name: "Guest A" }));
  fireEvent.click(screen.getByRole("button", { name: messages.Common.deleteGuest }));
  const dialog = screen.getByRole("group", { name: /Guest A/ });
  const descriptionId = dialog.getAttribute("aria-describedby");
  assert.ok(descriptionId);
  assert.equal(
    document.getElementById(descriptionId)?.textContent,
    messages.Common.removeGuestConfirm,
  );
  view.rerender(card("checked", true));
  const confirm = within(dialog).getByRole("button", { name: "Delete" });
  assert.equal(confirm.hasAttribute("disabled"), true);
  fireEvent.click(confirm);
  assert.equal(deleteCalls, 0);
  view.rerender(card("checked"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  assert.equal(deleteCalls, 1);
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
  const namesInput = screen.getByLabelText("Names to paste");
  assert.equal(namesInput.tagName, "TEXTAREA");
  const pasteSection = namesInput.closest("details")!;
  const csvSection = fileInput.closest("details")!;
  assert.notEqual(csvSection, pasteSection);
  assert.equal(csvSection.parentElement, pasteSection.parentElement);
  assert.ok(pasteSection.compareDocumentPosition(csvSection) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("a completed CSV submission clears the import draft before the sheet closes", async () => {
  let closed = false;
  render(<NextIntlClientProvider locale="en" messages={messages}>
    <Sheet title="Add guests" protectEdits onClose={() => { closed = true; }}>
      <GuestBulkEntry existingNames={[]} remaining={10}
        onSubmitChunk={async (names) => ({ data: { items: names.map((_, index) => ({
          index, status: "created", guest: {},
        })) }, error: null })} />
    </Sheet>
  </NextIntlClientProvider>);
  const fileInput = screen.getByLabelText(messages.BulkGuestEntry.csv.fileLabel) as HTMLInputElement;
  fireEvent.click(fileInput.closest("details")!.querySelector("summary")!);
  const file = new File(["name\nCSV Guest"], "guests.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => "name\nCSV Guest" });
  // JSDOM does not populate the native file input value when its files change.
  Object.defineProperty(fileInput, "value", { configurable: true, writable: true, value: "C:\\fakepath\\guests.csv" });
  await act(async () => { fireEvent.change(fileInput, { target: { files: [file] } }); });
  fireEvent.click(screen.getByRole("button", { name: messages.BulkGuestEntry.csv.apply }));
  const namesInput = screen.getByLabelText("Names to paste") as HTMLTextAreaElement;
  assert.equal(namesInput.closest("details")!.open, true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add 1" })); });
  assert.equal((screen.getByLabelText("Names to paste") as HTMLTextAreaElement).value, "");
  assert.equal(fileInput.value, "");
  assert.equal(screen.queryByLabelText(messages.BulkGuestEntry.csv.columnLabel), null);
  fireEvent.click(screen.getByRole("button", { name: messages.Sheet.close }));
  assert.equal(closed, true);
  assert.equal(screen.queryByRole("group", { name: messages.Sheet.unsaved }) === null, true);
});

test("bulk preview keeps its submitted names stable until registration and refresh finish", async () => {
  let publishGuests!: () => void;
  let resolveSubmit!: (value: { data: { items: { index: number; status: "created"; guest: unknown }[] }; error: null }) => void;
  let resolveRefresh!: () => void;
  const submission = new Promise<Parameters<typeof resolveSubmit>[0]>((resolve) => { resolveSubmit = resolve; });
  const refresh = new Promise<void>((resolve) => { resolveRefresh = resolve; });
  function Harness() {
    const [saved, setSaved] = useState(false);
    publishGuests = () => setSaved(true);
    return <GuestBulkEntry existingNames={saved ? ["Guest A", "Guest B"] : []} remaining={saved ? 0 : 2}
      onSubmitChunk={() => submission} onSubmissionComplete={() => refresh} />;
  }
  render(<NextIntlClientProvider locale="en" messages={messages}><Harness /></NextIntlClientProvider>);
  const field = screen.getByLabelText(messages.BulkGuestEntry.fieldLabel) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Guest A\nGuest B" } });
  fireEvent.click(screen.getByRole("button", { name: "Add 2" }));
  act(() => publishGuests());
  assert.equal(field.readOnly, true);
  assert.equal(screen.queryAllByRole("checkbox").length, 0, "the saved batch must not become its own duplicate");
  assert.ok(screen.getByRole("button", { name: "Add 2" }));
  await act(async () => resolveSubmit({ data: { items: [0, 1].map(index => ({ index, status: "created", guest: {} })) }, error: null }));
  assert.equal(field.readOnly, true);
  assert.equal(screen.queryAllByRole("checkbox").length, 0, "refresh must not revalidate the unfinished draft");
  await act(async () => resolveRefresh());
  assert.equal(field.value, "");
  assert.equal(field.readOnly, false);
  assert.ok(screen.getByText("2 guests added."));
});

test("bulk completion still exposes a real concurrent duplicate and retains only unsaved names", async () => {
  function Harness() {
    const [names, setNames] = useState<string[]>([]);
    return <GuestBulkEntry existingNames={names} remaining={10}
      onSubmitChunk={async () => {
        setNames(["Guest A", "Guest B"]);
        return { data: { items: [
          { index: 0, status: "created", guest: {} },
          { index: 1, status: "duplicate_requires_confirmation", guest: null },
        ] }, error: null };
      }} />;
  }
  render(<NextIntlClientProvider locale="en" messages={messages}><Harness /></NextIntlClientProvider>);
  const field = screen.getByLabelText(messages.BulkGuestEntry.fieldLabel) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Guest A\nGuest B" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2" })));
  assert.equal(field.value, "Guest B");
  assert.ok(screen.getByRole("checkbox", { name: messages.BulkGuestEntry.duplicateExisting }));
  assert.equal(screen.getByRole("button", { name: "Add 0" }).hasAttribute("disabled"), true);
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

  const originalInfo = console.info;
  const performanceRecords: { event: string; outcome: string; durationMs: number }[] = [];
  window.sessionStorage.setItem("authon:performance", "1");
  console.info = (value: string) => { performanceRecords.push(JSON.parse(value)); };
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
    const loadingRecord = performanceRecords.find((record) => record.event === "browser.loading");
    assert.equal(loadingRecord?.outcome, "ready");
    assert.equal((loadingRecord?.durationMs ?? -1) >= 0, true);
  } finally {
    console.info = originalInfo;
    window.sessionStorage.removeItem("authon:performance");
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    setupMain?.setAttribute("id", "main-content");
  }
});

test("product sheet protects changed input, blocks dismissal while saving and restores focus", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return <NextIntlClientProvider locale="en" messages={messages}>
      <div className="workspace-shell"><button onClick={() => setOpen(true)}>Open form</button></div>
      <Sheet open={open} title="Edit guest" onClose={() => setOpen(false)} protectEdits busy={busy}>
        <form onSubmit={(event) => { event.preventDefault(); setBusy(true); }}>
          <label>Name<input name="name" defaultValue="" /></label>
          <button type="submit">Save draft</button>
        </form>
        <button onClick={() => setBusy(false)}>Simulate save failure</button>
      </Sheet>
    </NextIntlClientProvider>;
  }
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open form" });
  opener.focus(); fireEvent.click(opener);
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
  const input = screen.getByLabelText("Name") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Retained guest" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  assert.ok(screen.getByRole("region", { name: "Edit guest" }));
  fireEvent.click(screen.getByRole("button", { name: "Simulate save failure" }));
  assert.equal(input.value, "Retained guest");
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  assert.ok(screen.getByRole("group", { name: messages.Sheet.unsaved }));
  fireEvent.click(screen.getByRole("button", { name: messages.Sheet.continue }));
  assert.equal(screen.getByLabelText("Name") === input, true);
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: messages.Sheet.discard }));
  await waitFor(() => assert.equal(document.activeElement === opener, true));
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
});

test("inline detail preserves form, selection, and unlocked workspace through resizing", () => {
  let width = 1200;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.id === "main-content" ? { ...originalRect.call(this), width, right: width } as DOMRect : originalRect.call(this);
  };
  try {
    const frame = (size: "default" | "record" = "default") => <NextIntlClientProvider locale="en" messages={messages}>
      <div className="workspace-shell"><main id="main-content" /></div>
      <Sheet title="Guest detail" presentation="detail" size={size} onClose={() => {}}>
        <label>Note<input defaultValue="Selected guest" /></label>
      </Sheet>
    </NextIntlClientProvider>;
    const view = render(frame());
    const panel = screen.getByRole("region", { name: "Guest detail" });
    assert.equal(panel.hasAttribute("aria-modal"), false);
    const input = screen.getByLabelText("Note") as HTMLInputElement;
    input.focus(); input.setSelectionRange(2, 5);
    width = 600; fireEvent(window, new Event("resize"));
    assert.equal(panel.hasAttribute("aria-modal"), false);
    assert.equal(screen.getByLabelText("Note") === input, true);
    assert.equal(document.activeElement === input, true);
    assert.equal(input.selectionStart, 2);
    assert.equal(input.selectionEnd, 5);
    width = 1200; fireEvent(window, new Event("resize"));
    assert.equal(panel.hasAttribute("aria-modal"), false);
    assert.equal(document.activeElement === input, true);
    view.rerender(frame("record"));
    assert.equal(panel.hasAttribute("aria-modal"), false);
    assert.equal(screen.getByLabelText("Note"), input);
    assert.equal(input.selectionStart, 2);
    assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
  } finally { HTMLElement.prototype.getBoundingClientRect = originalRect; }
});

test("roster columns retain search, row identity and open details through resize", () => {
  let width = 1200;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains("product-roster") || this.id === "main-content"
      ? { ...originalRect.call(this), width, right: width } as DOMRect : originalRect.call(this);
  };
  function Harness() {
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState<RosterStatus>("all");
    return <NextIntlClientProvider locale="en" messages={messages}>
      <div className="workspace-shell"><main id="main-content"><RosterView header={<h2>Guests</h2>}
        query={query} onQueryChange={setQuery} status={status} onStatusChange={setStatus} counts={{ all: 1, pending: 1, checked: 0 }}>
        <div className="product-roster-rows"><GuestListCard guest={{ id: "g1", name: "Guest One", status: "pending" }} index={0} /></div>
      </RosterView></main></div>
    </NextIntlClientProvider>;
  }
  try {
    window.localStorage.removeItem("workspace:rosterColumns");
    render(<Harness />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Guest" } });
    const row = screen.getByRole("article");
    fireEvent.click(screen.getByRole("button", { name: messages.Roster.twoColumns }));
    assert.equal(screen.getByRole("article") === row, true);
    assert.equal(input.value, "Guest");
    fireEvent.click(screen.getByRole("button", { name: "Guest One" }));
    const detail = screen.getByRole("region", { name: "Guest One" });
    width = 500; fireEvent(window, new Event("resize"));
    assert.equal(screen.getByRole("region", { name: "Guest One" }) === detail, true);
    assert.equal(detail.hasAttribute("aria-modal"), false);
    assert.equal(screen.getByRole("article") === row, true);
    width = 1200; fireEvent(window, new Event("resize"));
    assert.equal(detail.hasAttribute("aria-modal"), false);
    assert.equal(screen.getByRole("button", { name: messages.Roster.twoColumns }).getAttribute("aria-pressed"), "true");
    assert.equal(input.value, "Guest");
  } finally { HTMLElement.prototype.getBoundingClientRect = originalRect; window.localStorage.removeItem("workspace:rosterColumns"); }
});

test("mobile roster expands search with two-step Escape and keeps owner filtering inside the filter sheet", async () => {
  function Harness() {
    const [query, setQuery] = useState("");
    const [owner, setOwner] = useState("all");
    return <NextIntlClientProvider locale="en" messages={messages}>
      <div className="workspace-shell"><RosterView query={query} onQueryChange={setQuery}
        filtersActive={owner !== "all"}
        status="all" onStatusChange={() => {}} counts={{ all: 1, pending: 1, checked: 0 }}
        header={<button type="button">Sort names</button>}
        filters={<label>Owner<select value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="all">All owners</option><option value="dj">DJ</option>
        </select></label>}>
        <p>Guest One</p>
      </RosterView></div>
    </NextIntlClientProvider>;
  }
  render(<Harness />);
  assert.equal(screen.queryByRole("searchbox") === null, true);
  assert.equal(screen.queryByRole("combobox") === null, true);
  const searchToggle = screen.getByRole("button", { name: messages.Common.searchGuestNames });
  fireEvent.click(searchToggle);
  const search = screen.getByRole("searchbox") as HTMLInputElement;
  assert.equal(document.activeElement === search, true);
  fireEvent.change(search, { target: { value: "Guest" } });
  const clearSearch = screen.getByRole("button", { name: messages.Common.clearSearch });
  clearSearch.focus();
  fireEvent.click(clearSearch);
  assert.equal(search.value, "");
  assert.equal(document.activeElement === search, true);
  fireEvent.change(search, { target: { value: "Guest" } });
  fireEvent.keyDown(search, { key: "Escape", isComposing: true });
  assert.equal(search.value, "Guest");
  fireEvent.keyDown(search, { key: "Escape" });
  assert.equal(search.value, "");
  assert.equal(screen.getByRole("searchbox"), search);
  fireEvent.keyDown(search, { key: "Escape" });
  assert.equal(screen.queryByRole("searchbox") === null, true);
  assert.equal(document.activeElement === searchToggle, true);
  const filters = screen.getByRole("button", { name: messages.Roster.filters });
  filters.focus(); fireEvent.click(filters);
  let dialog = screen.getByRole("region", { name: messages.Roster.filters });
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "dj" } });
  fireEvent.click(within(dialog).getByRole("button", { name: messages.Sheet.close }));
  await waitFor(() => assert.equal(document.activeElement === filters, true));
  assert.equal(screen.getByRole("button", { name: messages.Roster.filtersApplied }) === filters, true);
  fireEvent.click(filters);
  dialog = screen.getByRole("region", { name: messages.Roster.filters });
  assert.equal((within(dialog).getByRole("combobox") as HTMLSelectElement).value, "dj");
  assert.ok(within(dialog).getByRole("button", { name: "Sort names" }));
  within(dialog).getByRole("combobox").focus();
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  let width = 900;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains("product-roster")
      ? { ...originalRect.call(this), width, right: width } as DOMRect : originalRect.call(this);
  };
  try {
    fireEvent(window, new Event("resize"));
    assert.equal(screen.queryByRole("region") === null, true);
    assert.equal((screen.getByRole("combobox") as HTMLSelectElement).value, "dj");
    assert.equal(document.activeElement === screen.getByRole("searchbox"), true);
    width = 500; fireEvent(window, new Event("resize"));
    assert.equal(screen.queryByRole("region") === null, true);
    assert.equal(document.activeElement === screen.getByRole("searchbox"), true);
    assert.ok(screen.getByRole("button", { name: messages.Roster.filtersApplied }));
  } finally { HTMLElement.prototype.getBoundingClientRect = originalRect; }
});

test("closed entry scope locks row, detail, and an already-open undo confirmation", () => {
  let mutations = 0;
  const card = (status: "pending" | "checked", locked: boolean) =>
    <NextIntlClientProvider locale="en" messages={messages}>
      <GuestListCard guest={{ id: "locked-guest", name: "Shared guest", status }} index={0}
        accountKind="shared" registeredByName="Fixture operator" isEntryDisabled={locked}
        onCheck={() => { mutations++; }} onUndo={() => { mutations++; }} />
    </NextIntlClientProvider>;
  const view = render(card("pending", true));
  const check = screen.getByRole("button", { name: messages.Common.checkIn });
  assert.equal(check.hasAttribute("disabled"), true);
  fireEvent.click(check);
  fireEvent.click(screen.getByRole("button", { name: /^Shared guest/ }));
  const detail = screen.getByRole("region", { name: "Shared guest" });
  assert.equal(within(detail).getByText("Fixture operator").previousElementSibling?.textContent, messages.Roster.operator);
  assert.equal(screen.getByRole("button", { name: messages.Common.checkIn }).hasAttribute("disabled"), true);
  fireEvent.click(screen.getByRole("button", { name: /^Shared guest/ }));
  view.rerender(card("checked", false));
  fireEvent.click(screen.getByRole("button", { name: /Undo check-in for/ }));
  view.rerender(card("checked", true));
  const confirm = within(screen.getByRole("group")).getByRole("button", { name: messages.Roster.undoConfirm });
  assert.equal(confirm.hasAttribute("disabled"), true);
  fireEvent.click(confirm);
  assert.equal(mutations, 0);
});

test("check-in stays immediate while undo requires confirmation for the current guest", () => {
  let checkCalls = 0;
  let undoCalls = 0;
  const card = (status: "pending" | "checked") => <NextIntlClientProvider locale="en" messages={messages}>
    <GuestListCard guest={{ id: "g1", name: "Guest One", status }} index={0} mode="operations"
      onCheck={() => { checkCalls++; }} onUndo={() => { undoCalls++; }} />
  </NextIntlClientProvider>;
  const view = render(card("pending"));
  fireEvent.click(screen.getByRole("button", { name: messages.Common.checkIn }));
  assert.equal(checkCalls, 1);
  assert.equal(screen.queryByRole("group") === null, true);
  view.rerender(card("checked"));
  fireEvent.click(screen.getByRole("button", { name: /Undo check-in/ }));
  assert.equal(undoCalls, 0);
  const dialog = screen.getByRole("group", { name: messages.Roster.undoTitle });
  fireEvent.click(within(dialog).getByRole("button", { name: messages.Roster.undoConfirm }));
  assert.equal(undoCalls, 1);
});

test("event details hand off a template to a guarded create sheet and retain failed input", async () => {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const suffix = ["lib/events/client", "lib/api/events", "lib/api/closeout", "components/VenueSelector"].find((value) => specifier.endsWith(value));
      return suffix ? { url: `mock:event-sheet:${suffix}`, shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (!url.startsWith("mock:event-sheet:")) return nextLoad(url, context);
      const sources: Record<string, string> = {
        "lib/events/client": 'export const fetchEvents = async () => ({ data: [{ id: "event-1", name: "Test night", businessDate: "2026-09-16", state: "draft", compatibilityKey: null, capacity: 100, targetGuests: 30 }], error: null });',
        "lib/api/events": 'export const createEvent = async () => { throw new Error("offline"); }; export const transitionEventState = createEvent;',
        "lib/api/closeout": 'export const fetchEventCloseout = async () => ({ data: null, error: "UNAVAILABLE" }); export const confirmEventCloseout = fetchEventCloseout;',
        "components/VenueSelector": 'export const useVenueSelector = () => ({ venueId: "venue-1", venues: [], selectedVenueId: "venue-1", currentVenue: {}, isSuperAdmin: false }); export default function VenueSelector() { return null; }',
      };
      return { format: "module", shortCircuit: true, source: sources[url.replace("mock:event-sheet:", "")] };
    },
  });
  try {
    const { default: EventManagement } = await import("@/app/admin/components/EventManagement");
    render(<NextIntlClientProvider locale="en" messages={messages}>
      <EventManagement selectedDate="2026-09-16" businessDate="2026-09-16" onDateChange={() => {}}
        selectedEventId={null} onSelectedEventChange={() => {}} onEventsChanged={() => {}} />
    </NextIntlClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Test night/ }));
    const details = screen.getByRole("region", { name: "Test night" });
    const open = within(details).getByRole("button", { name: messages.EventAdmin.transition.open });
    fireEvent.click(open);
    await waitFor(() => assert.ok(within(details).getByText(messages.EventAdmin.transitionFailed)));
    assert.equal(open.hasAttribute("disabled"), false);
    fireEvent.click(screen.getByRole("button", { name: messages.EventAdmin.useTemplate }));
    const dialog = screen.getByRole("region", { name: messages.EventAdmin.createTitle });
    const name = within(dialog).getByLabelText(messages.EventAdmin.name) as HTMLInputElement;
    assert.match(name.value, /Test night/);
    fireEvent.change(name, { target: { value: "New night" } });
    fireEvent.click(within(dialog).getByRole("button", { name: messages.Sheet.close }));
    assert.ok(screen.getByRole("group", { name: messages.Sheet.unsaved }));
    fireEvent.click(screen.getByRole("button", { name: messages.Sheet.continue }));
    fireEvent.submit(name.closest("form")!);
    await waitFor(() => assert.ok(within(dialog).getByText(messages.EventAdmin.createFailed)));
    assert.equal(name.value, "New night");
    assert.equal(within(dialog).getByRole("button", { name: messages.EventAdmin.create }).hasAttribute("disabled"), false);
  } finally { cleanup(); hooks.deregister(); }
});

test("a credential result owns Escape while the underlying detail stays available", async () => {
  function Harness() {
    const [result, setResult] = useState(false);
    const [details, setDetails] = useState(true);
    return <NextIntlClientProvider locale="en" messages={messages}>
      <div className="workspace-shell"><button>Workspace</button></div>
      <Sheet open={details} title="Account details" onClose={() => setDetails(false)}>
        <button onClick={() => setResult(true)}>Issue credential</button>
      </Sheet>
      <Sheet open={result} title="Credential result" onClose={() => setResult(false)}><p>Result</p></Sheet>
    </NextIntlClientProvider>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Issue credential" }));
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  assert.equal(screen.queryByRole("region", { name: "Credential result" }) === null, true);
  assert.ok(screen.getByRole("region", { name: "Account details" }));
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
  assert.notEqual(document.body.style.overflow, "hidden");
  await act(async () => {});
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  assert.equal(screen.queryByRole("region") === null, true);
  await act(async () => {});
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
  assert.notEqual(document.body.style.overflow, "hidden");
});

test("removing an inline panel and its confirmation keeps the workspace available", async () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    const [confirm, setConfirm] = useState(false);
    return <NextIntlClientProvider locale="en" messages={messages}>
      <div className="workspace-shell"><button>Workspace</button></div>
      {open && <Sheet title="Record" onClose={() => setOpen(false)}>
        <button onClick={() => setConfirm(true)}>Delete record</button>
        <ConfirmDialog open={confirm} title="Delete record?" confirmLabel="Remove" cancelLabel="Cancel"
          onCancel={() => setConfirm(false)} onConfirm={() => setOpen(false)} />
      </Sheet>}
    </NextIntlClientProvider>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Delete record" }));
  assert.notEqual(document.body.style.overflow, "hidden");
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await act(async () => {});
  assert.equal(screen.queryByRole("region") === null, true);
  assert.equal(screen.queryByRole("group") === null, true);
  assert.notEqual(document.body.style.overflow, "hidden");
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
  assert.equal(document.getElementById("main-content")?.hasAttribute("inert"), false);
});

test("route loading locks an inline panel without replacing its draft", () => {
  let start: ((href: string) => boolean) | undefined;
  function Harness() {
    start = useRouteTransition().startRouteTransition;
    return <Sheet title="Draft" onClose={() => {}}><label>Draft name<input defaultValue="" /></label></Sheet>;
  }
  render(<NextIntlClientProvider locale="en" messages={messages}><RouteTransitionProvider><Harness /></RouteTransitionProvider></NextIntlClientProvider>);
  const input = screen.getByLabelText("Draft name") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Retained" } });
  act(() => { start?.("/other"); });
  const layer = input.closest(".product-sheet-layer");
  assert.equal(layer?.hasAttribute("inert"), true);
  assert.equal(layer?.hasAttribute("hidden"), true);
  assert.equal(input.value, "Retained");
  assert.equal(input.isConnected, true);
});

test("saved input and a persistent operator do not produce a false discard prompt", () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    const [quotaReady, setQuotaReady] = useState(false);
    return <NextIntlClientProvider locale="en" messages={messages}>
      <Sheet open={open} title="Registration" protectEdits onClose={() => setOpen(false)}>
        <label>Operator<input defaultValue="" data-preserve-on-close /></label>
        <form onSubmit={(event) => { event.preventDefault(); event.currentTarget.reset(); }}>
          <label>Guest draft<input defaultValue="" /></label><button type="submit">Save</button>
        </form>
        <button onClick={() => setQuotaReady(true)}>Load quota</button>
        {quotaReady && <label>Quota request<input defaultValue="1" /></label>}
      </Sheet>
    </NextIntlClientProvider>;
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "Operator name" } });
  fireEvent.change(screen.getByLabelText("Guest draft"), { target: { value: "Guest name" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Load quota" }));
  fireEvent.click(screen.getByRole("button", { name: messages.Sheet.close }));
  assert.equal(screen.queryByRole("region") === null, true);
});


test("operations deletion is only in guest details, confirms, and restores focus on cancellation", async () => {
  for (const status of ["pending", "checked"] as const) {
    let calls = 0;
    const frame = (disabled = false, allowed = true) => <NextIntlClientProvider locale="en" messages={messages}>
      <GuestListCard guest={{ id: "g1", name: "Guest One", status }} index={0} mode="operations"
        onDelete={allowed ? () => { calls += 1; } : undefined} isDeleteDisabled={disabled} />
    </NextIntlClientProvider>;
    const view = render(frame());
    assert.equal(screen.queryByRole("button", { name: messages.Common.deleteGuest }) === null, true);
    fireEvent.click(screen.getByRole("button", { name: "Guest One" }));
    const trigger = screen.getByRole("button", { name: messages.Common.deleteGuest });
    trigger.focus();
    fireEvent.click(trigger);
    assert.equal(calls, 0);
    const confirmation = screen.getByRole("group");
    assert.equal(document.activeElement === within(confirmation).getByRole("button", { name: messages.Common.cancel }), true);
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    await waitFor(() => assert.equal(screen.queryByRole("group") === null, true));
    assert.ok(screen.getByRole("region", { name: "Guest One" }));
    assert.equal(document.activeElement === trigger, true);
    fireEvent.click(trigger);
    view.rerender(frame(true));
    fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: messages.Common.delete }));
    assert.equal(calls, 0);
    view.rerender(frame(false, false));
    assert.equal(screen.queryByRole("group") === null, true);
    assert.equal(screen.queryByRole("button", { name: messages.Common.deleteGuest }) === null, true);
    view.rerender(frame());
    fireEvent.click(screen.getByRole("button", { name: messages.Common.deleteGuest }));
    fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: messages.Common.delete }));
    assert.equal(calls, 1);
    cleanup();
  }
});


test("guest rows toggle inline details while action buttons stay independent and Escape restores row focus", () => {
  let checks = 0;
  render(<NextIntlClientProvider locale="en" messages={messages}>
    <GuestListCard guest={{ id: "accordion-guest", name: "Accordion guest", status: "pending" }}
      index={0} mode="operations" onCheck={() => { checks++; }} onDelete={() => {}} />
  </NextIntlClientProvider>);
  const row = screen.getByRole("button", { name: "Accordion guest" });
  const check = screen.getByRole("button", { name: messages.Common.checkIn });
  assert.equal(row.getAttribute("aria-expanded"), "false");
  fireEvent.click(check);
  assert.equal(checks, 1);
  assert.equal(row.getAttribute("aria-expanded"), "false");
  fireEvent.click(row);
  const detail = screen.getByRole("region", { name: "Accordion guest" });
  assert.equal(row.getAttribute("aria-controls"), detail.id);
  assert.equal(screen.queryByRole("dialog") === null, true);
  assert.notEqual(document.body.style.overflow, "hidden");
  fireEvent.click(check);
  assert.equal(checks, 2);
  assert.equal(row.getAttribute("aria-expanded"), "true");
  fireEvent.keyDown(within(detail).getByRole("button", { name: messages.Common.deleteGuest }), { key: "Escape" });
  assert.equal(row.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement === row, true);
  assert.equal(screen.queryByRole("region", { name: "Accordion guest" }) === null, true);
  fireEvent.click(row);
  fireEvent.click(row);
  assert.equal(row.getAttribute("aria-expanded"), "false");
});


test("switching record accordions protects an unsaved draft and resumes only after discard", () => {
  function Record({ id }: { id: string }) {
    const detail = useRecordDetail(id);
    return <article><button onClick={detail.show}>Open {id}</button>
      <Sheet id={`record-${id}`} open={detail.open} title={id} onClose={detail.close} protectEdits>
        <label>{id} note<input defaultValue="" /></label>
      </Sheet>
    </article>;
  }
  render(<NextIntlClientProvider locale="en" messages={messages}><RecordList><Record id="A" /><Record id="B" /></RecordList></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open A" }));
  const note = screen.getByLabelText("A note") as HTMLInputElement;
  fireEvent.change(note, { target: { value: "Keep draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Open B" }));
  assert.equal(screen.queryByRole("region", { name: "B" }) === null, true);
  fireEvent.click(screen.getByRole("button", { name: messages.Sheet.continue }));
  assert.equal(note.value, "Keep draft");
  fireEvent.click(screen.getByRole("button", { name: "Open B" }));
  fireEvent.click(screen.getByRole("button", { name: messages.Sheet.discard }));
  assert.equal(screen.queryByRole("region", { name: "A" }) === null, true);
  assert.ok(screen.getByRole("region", { name: "B" }));
});
