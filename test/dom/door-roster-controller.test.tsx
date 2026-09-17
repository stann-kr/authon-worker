import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { announceRouteTransitionStart } from "@/lib/route-transition-events";

import useDoorRosterController, {
  type DoorRosterDependencies,
} from "@/app/door/useDoorRosterController";
import type {
  OfflineDoorMutation,
  OfflineDoorRosterSnapshot,
} from "@/lib/door/offline-domain";
import type { GuestOperationsSnapshot } from "@/lib/guest-snapshots/types";
import type { Guest } from "@/lib/guests/types";

const GUEST: Guest = {
  id: "guest-0001",
  venueId: "venue-0001",
  eventId: "event-0001",
  name: "Guest One",
  status: "pending",
  checkInTime: null,
  date: "2026-08-23",
  createdAt: "2026-08-23T10:00:00.000Z",
  updatedAt: "2026-08-23T10:00:00.000Z",
};

const OPERATIONS_SNAPSHOT: GuestOperationsSnapshot = {
  guests: [GUEST],
  users: [],
  externalLinks: [],
  failedSections: [],
};

const OFFLINE_SNAPSHOT: OfflineDoorRosterSnapshot = {
  scope: {
    venueId: "venue-0001",
    eventId: "event-0001",
    businessDate: "2026-08-23",
  },
  guests: [
    {
      id: GUEST.id,
      name: GUEST.name,
      status: "pending",
      checkInTime: null,
    },
  ],
  cachedAt: "2026-08-23T10:00:00.000Z",
  expiresAt: "2026-08-23T18:00:00.000Z",
};

const TRANSLATE = (key: string) => key;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createScopedGuest(eventId: string, name: string): Guest {
  return {
    ...GUEST,
    id: `guest-${eventId}`,
    eventId,
    name,
  };
}

function createScopedMutation(
  eventId: string,
  guestId: string,
): OfflineDoorMutation {
  return {
    idempotencyKey: `offline:device-0001:${eventId}`,
    deviceId: "device-0001",
    sequence: 1,
    scope: {
      venueId: "venue-0001",
      eventId,
      businessDate: "2026-08-23",
    },
    guestId,
    action: "check_in",
    queuedAt: "2026-08-23T10:05:00.000Z",
    expiresAt: "2026-08-23T22:05:00.000Z",
    state: "queued",
    resolution: null,
  };
}

function createScopedSnapshot(
  eventId: string,
  guest: Guest,
): OfflineDoorRosterSnapshot {
  return {
    scope: {
      venueId: "venue-0001",
      eventId,
      businessDate: "2026-08-23",
    },
    guests: [
      {
        id: guest.id,
        name: guest.name,
        status: guest.status === "checked" ? "checked" : "pending",
        checkInTime: guest.checkInTime ?? null,
      },
    ],
    cachedAt: "2026-08-23T10:00:00.000Z",
    expiresAt: "2026-08-23T18:00:00.000Z",
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

function createDependencies(
  overrides: Partial<DoorRosterDependencies> = {},
): DoorRosterDependencies {
  return {
    fetchGuestsByDate: async () => ({ data: [GUEST], error: null }),
    updateGuestStatus: async (_id, status) => ({
      data: { ...GUEST, status },
      error: null,
    }),
    deleteGuest: async () => ({
      data: { ...GUEST, status: "deleted" },
      error: null,
    }),
    fetchGuestOperationsSnapshot: async () => ({
      data: OPERATIONS_SNAPSHOT,
      error: null,
    }),
    fetchOfflineDoorRoster: async () => ({ data: [], error: null }),
    syncOfflineDoorMutations: async () => ({ data: [], error: null }),
    clearResolvedOfflineDoorMutations: async () => {},
    enqueueOfflineDoorMutation: async () => ({
      idempotencyKey: "offline:device-0001:1",
      deviceId: "device-0001",
      sequence: 1,
      scope: OFFLINE_SNAPSHOT.scope,
      guestId: GUEST.id,
      action: "check_in",
      queuedAt: "2026-08-23T10:05:00.000Z",
      expiresAt: "2026-08-23T22:05:00.000Z",
      state: "queued",
      resolution: null,
    }),
    listOfflineDoorMutations: async () => [],
    loadOfflineDoorRoster: async () => null,
    removeOfflineDoorRoster: async () => {},
    resolveOfflineDoorMutation: async () => {},
    saveOfflineDoorRoster: async () => {},
    randomUUID: () => "request-0001",
    ...overrides,
  };
}

function DoorRosterHarness({
  dependencies,
  selectedEventId = null,
  canDeleteGuests = false,
}: {
  dependencies: DoorRosterDependencies;
  selectedEventId?: string | null;
  canDeleteGuests?: boolean;
}) {
  const roster = useDoorRosterController({
    venueId: "venue-0001",
    selectedDate: "2026-08-23",
    selectedEventId,
    translate: TRANSLATE,
    dependencies,
    canDeleteGuests,
  });

  return (
    <>
      <output data-testid="outcome">{roster.loadOutcome}</output>
      <output data-testid="feedback">{roster.feedback ?? ""}</output>
      <output data-testid="guest-count">{roster.displayData.guests.length}</output>
      <output data-testid="guest-status">
        {roster.displayData.guests[0]?.status ?? "none"}
      </output>
      <output data-testid="guest-name">
        {roster.displayData.guests[0]?.name ?? "none"}
      </output>
      <output data-testid="has-current-scope-data">
        {String(roster.hasCurrentScopeData)}
      </output>
      <output data-testid="fetching">{String(roster.isFetching)}</output>
      <output data-testid="offline-mode">{String(roster.isOfflineMode)}</output>
      <output data-testid="offline-syncing">
        {String(roster.isOfflineSyncing)}
      </output>
      <output data-testid="offline-notice">{roster.offlineNotice ?? ""}</output>
      <output data-testid="offline-queued">{roster.offlineQueueCounts.queued}</output>
      <output data-testid="pending-guest-mutations">{String(roster.hasPendingGuestMutations)}</output>
      <output data-testid="busy">{String(Object.values(roster.loadingStates).some(Boolean))}</output>
      <output data-testid="guest-statuses">{roster.displayData.guests.map((guest) => guest.status).join(",")}</output>
      <button
        type="button"
        onClick={() =>
          void roster.handleStatusChange(GUEST.id, "checked", "check")
        }
      >
        Check in
      </button>
      <button type="button" onClick={() => void roster.handleStatusChange(GUEST.id, "pending", "cancel")}>
        Cancel check in
      </button>
      <button type="button" onClick={() => void roster.handleStatusChange("guest-0002", "checked", "check")}>
        Check in second
      </button>
      <button type="button" onClick={() => void roster.handleStatusChange(GUEST.id, "deleted", "remove")}>Delete guest</button>
      <button type="button" onClick={() => void roster.loadData()}>Refresh roster</button>
      <button type="button" onClick={() => void roster.syncOfflineQueue()}>
        Sync offline queue
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  setOnline(true);
});

test("authoritative success publishes the current roster", async () => {
  render(<DoorRosterHarness dependencies={createDependencies()} />);

  await waitFor(() => {
    assert.equal(screen.getByTestId("outcome").textContent, "success");
    assert.equal(screen.getByTestId("guest-count").textContent, "1");
  });
  assert.equal(screen.getByTestId("feedback").textContent, "");
  assert.equal(screen.getByTestId("offline-mode").textContent, "false");
});

test("concurrent saves finish before one coalesced background roster refresh", async () => {
  const secondGuest = { ...GUEST, id: "guest-0002" };
  const saves = [createDeferred<{ data: Guest; error: null }>(), createDeferred<{ data: Guest; error: null }>()];
  const refresh = createDeferred<{ data: GuestOperationsSnapshot; error: null }>();
  let reads = 0;
  const dependencies = createDependencies({
    fetchGuestOperationsSnapshot: async () => ++reads === 1
      ? { data: { ...OPERATIONS_SNAPSHOT, guests: [GUEST, secondGuest] }, error: null }
      : refresh.promise,
    updateGuestStatus: async (id) => saves[id === GUEST.id ? 0 : 1].promise,
  });
  render(<DoorRosterHarness dependencies={dependencies} />);
  await waitFor(() => assert.equal(screen.getByTestId("guest-count").textContent, "2"));
  fireEvent.click(screen.getByRole("button", { name: /^Check in$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check in second" }));
  assert.equal(screen.getByTestId("pending-guest-mutations").textContent, "true");
  await act(async () => { saves[0].resolve({ data: { ...GUEST, status: "checked" }, error: null }); });
  assert.equal(reads, 1);
  assert.equal(screen.getByTestId("pending-guest-mutations").textContent, "true");
  await act(async () => { saves[1].resolve({ data: { ...secondGuest, status: "checked" }, error: null }); });
  await waitFor(() => assert.equal(reads, 2));
  assert.equal(screen.getByTestId("busy").textContent, "false");
  assert.equal(screen.getByTestId("pending-guest-mutations").textContent, "false");
  assert.equal(screen.getByTestId("fetching").textContent, "false");
  assert.equal(screen.getByTestId("guest-statuses").textContent, "checked,checked");
  fireEvent.click(screen.getByRole("button", { name: "Refresh roster" }));
  assert.equal(reads, 2);
  await act(async () => { refresh.resolve({ data: { ...OPERATIONS_SNAPSHOT, guests: [GUEST, secondGuest].map((guest) => ({ ...guest, status: "checked" })) }, error: null }); });
  assert.equal(reads, 2);
});

test("an earlier refresh cannot undo a later confirmed mutation or survive navigation", async () => {
  for (const navigate of [false, true]) {
    const stale = createDeferred<{ data: GuestOperationsSnapshot; error: null }>();
    const fresh = createDeferred<{ data: GuestOperationsSnapshot; error: null }>();
    let reads = 0;
    const dependencies = createDependencies({
      fetchGuestOperationsSnapshot: async () => {
        reads += 1;
        if (reads === 1) return { data: OPERATIONS_SNAPSHOT, error: null };
        return reads === 2 ? stale.promise : fresh.promise;
      },
    });
    const view = render(<DoorRosterHarness dependencies={dependencies} />);
    await waitFor(() => assert.equal(screen.getByTestId("guest-count").textContent, "1"));
    fireEvent.click(screen.getByRole("button", { name: /^Check in$/ }));
    await waitFor(() => assert.equal(reads, 2));
    fireEvent.click(screen.getByRole("button", { name: "Cancel check in" }));
    await waitFor(() => assert.equal(screen.getByTestId("guest-status").textContent, "pending"));
    if (navigate) act(() => announceRouteTransitionStart());
    await act(async () => { stale.resolve({ data: { ...OPERATIONS_SNAPSHOT, guests: [{ ...GUEST, status: "checked", name: "Stale response" }] }, error: null }); });
    assert.equal(screen.getByTestId("guest-status").textContent, "pending");
    assert.equal(screen.getByTestId("guest-name").textContent, GUEST.name);
    assert.equal(reads, navigate ? 2 : 3);
    await act(async () => { fresh.resolve({ data: OPERATIONS_SNAPSHOT, error: null }); });
    view.unmount();
  }
});

test("a failed or partial background refresh preserves the confirmed row", async () => {
  for (const partial of [false, true]) {
    let reads = 0;
    const dependencies = createDependencies({
      fetchGuestOperationsSnapshot: async () => ++reads === 1
        ? { data: OPERATIONS_SNAPSHOT, error: null }
        : { data: partial ? { ...OPERATIONS_SNAPSHOT, guests: [], failedSections: ["guests"] } : null, error: "UNAVAILABLE" },
    });
    const view = render(<DoorRosterHarness dependencies={dependencies} />);
    await waitFor(() => assert.equal(screen.getByTestId("guest-count").textContent, "1"));
    fireEvent.click(screen.getByRole("button", { name: /^Check in$/ }));
    await waitFor(() => assert.equal(screen.getByTestId("outcome").textContent, "partial"));
    assert.equal(screen.getByTestId("guest-status").textContent, "checked");
    assert.equal(screen.getByTestId("busy").textContent, "false");
    assert.equal(screen.getByTestId("fetching").textContent, "false");
    assert.equal(screen.getByTestId("feedback").textContent, partial ? "partialLoadFailed" : "loadFailed");
    view.unmount();
  }
});

test("an eligible operations snapshot supplies the offline roster without another fetch", async () => {
  const saved: OfflineDoorRosterSnapshot[] = [];
  let extraReads = 0;
  const dependencies = createDependencies({
    fetchGuestOperationsSnapshot: async () => ({
      data: { ...OPERATIONS_SNAPSHOT, offlineRosterStatus: "available", guests: [
        GUEST,
        { ...GUEST, id: "deleted-0001", status: "deleted" },
        { ...GUEST, id: "foreign-0001", venueId: "venue-0002" },
        { ...GUEST, id: "foreign-0002", eventId: "event-0002" },
      ] },
      error: null,
    }),
    fetchOfflineDoorRoster: async () => { extraReads += 1; return { data: [], error: null }; },
    saveOfflineDoorRoster: async (snapshot) => { saved.push(snapshot); },
  });
  render(<DoorRosterHarness dependencies={dependencies} selectedEventId="event-0001" />);
  await waitFor(() => assert.equal(saved.length, 1));
  assert.equal(extraReads, 0);
  assert.deepEqual(saved[0].guests, OFFLINE_SNAPSHOT.guests);
  assert.deepEqual(Object.keys(saved[0].guests[0]).sort(), ["checkInTime", "id", "name", "status"]);
});

test("closed snapshots clear the offline cache while failed guest sections preserve it", async () => {
  for (const unavailable of [false, true]) {
    let saves = 0;
    let removals = 0;
    let extraReads = 0;
    const dependencies = createDependencies({
      fetchGuestOperationsSnapshot: async () => ({
        data: { ...OPERATIONS_SNAPSHOT, offlineRosterStatus: unavailable ? "unavailable" : "available", failedSections: ["guests"] },
        error: "PARTIAL",
      }),
      fetchOfflineDoorRoster: async () => { extraReads += 1; return { data: [], error: null }; },
      saveOfflineDoorRoster: async () => { saves += 1; },
      removeOfflineDoorRoster: async () => { removals += 1; },
    });
    const view = render(<DoorRosterHarness dependencies={dependencies} selectedEventId="event-0001" />);
    await waitFor(() => assert.equal(screen.getByTestId("fetching").textContent, "false"));
    if (unavailable) await waitFor(() => assert.equal(removals, 1));
    assert.equal(saves, 0);
    assert.equal(removals, unavailable ? 1 : 0);
    assert.equal(extraReads, 0);
    view.unmount();
  }
});

test("an optional offline roster rejection cannot hide authoritative data", async () => {
  render(
    <DoorRosterHarness
      dependencies={createDependencies({
        fetchOfflineDoorRoster: async () => {
          throw new Error("offline roster transport failed");
        },
      })}
      selectedEventId="event-0001"
    />,
  );

  await waitFor(() => {
    assert.equal(screen.getByTestId("outcome").textContent, "success");
    assert.equal(screen.getByTestId("guest-count").textContent, "1");
    assert.equal(screen.getByTestId("fetching").textContent, "false");
  });
  assert.equal(screen.getByTestId("feedback").textContent, "");
  assert.equal(screen.getByTestId("offline-mode").textContent, "false");
});

test("a partial authoritative response keeps its roster and scoped feedback", async () => {
  const dependencies = createDependencies({
    fetchGuestOperationsSnapshot: async () => ({
      data: {
        ...OPERATIONS_SNAPSHOT,
        failedSections: ["users"],
      },
      error: "PARTIAL",
    }),
  });
  render(<DoorRosterHarness dependencies={dependencies} />);

  await waitFor(() => {
    assert.equal(screen.getByTestId("outcome").textContent, "partial");
    assert.equal(screen.getByTestId("guest-count").textContent, "1");
  });
  assert.equal(
    screen.getByTestId("feedback").textContent,
    "partialLoadFailed",
  );
});

test("an unavailable authoritative roster falls back to the cached offline roster", async () => {
  const dependencies = createDependencies({
    fetchGuestOperationsSnapshot: async () => ({
      data: null,
      error: "LOAD_FAILED",
    }),
    fetchOfflineDoorRoster: async () => ({
      data: null,
      error: "OFFLINE_DOOR_ROSTER_FAILED",
    }),
    loadOfflineDoorRoster: async () => OFFLINE_SNAPSHOT,
  });
  render(
    <DoorRosterHarness
      dependencies={dependencies}
      selectedEventId="event-0001"
    />,
  );

  await waitFor(() => {
    assert.equal(screen.getByTestId("outcome").textContent, "success");
    assert.equal(screen.getByTestId("guest-count").textContent, "1");
    assert.equal(screen.getByTestId("offline-mode").textContent, "true");
  });
  assert.equal(screen.getByTestId("feedback").textContent, "");
});

test("an offline status change queues once and updates the visible roster", async () => {
  setOnline(false);
  const mutations: OfflineDoorMutation[] = [];
  let enqueueCalls = 0;
  const dependencies = createDependencies({
    listOfflineDoorMutations: async () => mutations,
    enqueueOfflineDoorMutation: async (params) => {
      enqueueCalls += 1;
      const mutation: OfflineDoorMutation = {
        idempotencyKey: "offline:device-0001:1",
        deviceId: "device-0001",
        sequence: 1,
        scope: params.scope,
        guestId: params.guestId,
        action: params.action,
        queuedAt: "2026-08-23T10:05:00.000Z",
        expiresAt: "2026-08-23T22:05:00.000Z",
        state: "queued",
        resolution: null,
      };
      mutations.push(mutation);
      return mutation;
    },
  });
  render(
    <DoorRosterHarness
      dependencies={dependencies}
      selectedEventId="event-0001"
    />,
  );
  await waitFor(() => {
    assert.equal(screen.getByTestId("guest-count").textContent, "1");
  });

  fireEvent.click(screen.getByRole("button", { name: "Check in" }));

  await waitFor(() => {
    assert.equal(screen.getByTestId("guest-status").textContent, "checked");
    assert.equal(screen.getByTestId("offline-queued").textContent, "1");
    assert.equal(screen.getByTestId("pending-guest-mutations").textContent, "true");
    assert.equal(screen.getByTestId("offline-notice").textContent, "queued");
  });
  assert.equal(enqueueCalls, 1);
});

test("a deferred save from the previous scope cannot replace completed current-scope data", async () => {
  const guestA = createScopedGuest("event-aaaa", "Guest A");
  const guestB = createScopedGuest("event-bbbb", "Guest B");
  const saveA = createDeferred<void>();
  const savedScopes: string[] = [];
  const dependencies = createDependencies({
    fetchGuestOperationsSnapshot: async (_date, _venueId, eventId) => ({
      data: {
        guests: [eventId === "event-aaaa" ? guestA : guestB],
        users: [],
        externalLinks: [],
        failedSections: [],
      },
      error: null,
    }),
    fetchOfflineDoorRoster: async (scope) => ({
      data: [
        {
          id: scope.eventId === "event-aaaa" ? guestA.id : guestB.id,
          name: scope.eventId === "event-aaaa" ? guestA.name : guestB.name,
          status: "pending",
          checkInTime: null,
        },
      ],
      error: null,
    }),
    saveOfflineDoorRoster: async (snapshot) => {
      savedScopes.push(snapshot.scope.eventId);
      if (snapshot.scope.eventId === "event-aaaa") await saveA.promise;
    },
  });
  const view = render(
    <DoorRosterHarness dependencies={dependencies} selectedEventId="event-aaaa" />,
  );

  await waitFor(() => assert.deepEqual(savedScopes, ["event-aaaa"]));
  view.rerender(
    <DoorRosterHarness dependencies={dependencies} selectedEventId="event-bbbb" />,
  );

  await waitFor(() => {
    assert.equal(screen.getByTestId("guest-name").textContent, "Guest B");
    assert.equal(
      screen.getByTestId("has-current-scope-data").textContent,
      "true",
    );
    assert.equal(screen.getByTestId("fetching").textContent, "false");
  });

  saveA.resolve();
  await waitFor(() =>
    assert.deepEqual(savedScopes, ["event-aaaa", "event-bbbb"]),
  );
  assert.equal(screen.getByTestId("guest-name").textContent, "Guest B");
  assert.equal(
    screen.getByTestId("has-current-scope-data").textContent,
    "true",
  );
});

test("a current-scope sync runs once after the previous scope sync and keeps syncing ownership", async () => {
  const guestA = createScopedGuest("event-aaaa", "Guest A");
  const guestB = createScopedGuest("event-bbbb", "Guest B");
  const syncA = createDeferred<{
    data: [];
    error: null;
  }>();
  const syncB = createDeferred<{
    data: [];
    error: null;
  }>();
  const syncScopes: string[] = [];
  const dependencies = createDependencies({
    fetchGuestOperationsSnapshot: async (_date, _venueId, eventId) => ({
      data: {
        guests: [eventId === "event-aaaa" ? guestA : guestB],
        users: [],
        externalLinks: [],
        failedSections: [],
      },
      error: null,
    }),
    listOfflineDoorMutations: async (scope) => [
      createScopedMutation(
        scope.eventId,
        scope.eventId === "event-aaaa" ? guestA.id : guestB.id,
      ),
    ],
    syncOfflineDoorMutations: async (params) => {
      syncScopes.push(params.eventId);
      return params.eventId === "event-aaaa" ? syncA.promise : syncB.promise;
    },
  });
  const view = render(
    <DoorRosterHarness dependencies={dependencies} selectedEventId="event-aaaa" />,
  );

  await waitFor(() => {
    assert.deepEqual(syncScopes, ["event-aaaa"]);
    assert.equal(screen.getByTestId("offline-syncing").textContent, "true");
  });
  view.rerender(
    <DoorRosterHarness dependencies={dependencies} selectedEventId="event-bbbb" />,
  );
  await waitFor(() => {
    assert.equal(screen.getByTestId("guest-name").textContent, "Guest B");
  });

  syncA.resolve({ data: [], error: null });
  await waitFor(() => {
    assert.deepEqual(syncScopes, ["event-aaaa", "event-bbbb"]);
    assert.equal(screen.getByTestId("offline-syncing").textContent, "true");
  });

  syncB.resolve({ data: [], error: null });
  await waitFor(() => {
    assert.equal(screen.getByTestId("offline-syncing").textContent, "false");
  });
  assert.deepEqual(syncScopes, ["event-aaaa", "event-bbbb"]);
});

test("a stale cached fallback cannot overwrite the authoritative current-scope roster state", async () => {
  const guestA = createScopedGuest("event-aaaa", "Cached Guest A");
  const guestB = createScopedGuest("event-bbbb", "Authoritative Guest B");
  const loadA = createDeferred<OfflineDoorRosterSnapshot | null>();
  let didStartLoadA = false;
  const mutationA = createScopedMutation("event-aaaa", guestA.id);
  const mutationB = createScopedMutation("event-bbbb", guestB.id);
  const dependencies = createDependencies({
    fetchGuestOperationsSnapshot: async (_date, _venueId, eventId) =>
      eventId === "event-aaaa"
        ? { data: null, error: "LOAD_FAILED" }
        : {
            data: {
              guests: [guestB],
              users: [],
              externalLinks: [],
              failedSections: ["users"],
            },
            error: "PARTIAL",
          },
    fetchOfflineDoorRoster: async () => ({
      data: null,
      error: "OFFLINE_DOOR_ROSTER_FAILED",
    }),
    listOfflineDoorMutations: async (scope) =>
      scope.eventId === "event-aaaa"
        ? [
            mutationA,
            {
              ...mutationA,
              idempotencyKey: "offline:device-0001:event-aaaa-2",
              sequence: 2,
            },
          ]
        : [mutationB],
    loadOfflineDoorRoster: async (scope) => {
      if (scope.eventId !== "event-aaaa") return null;
      didStartLoadA = true;
      return loadA.promise;
    },
  });
  const view = render(
    <DoorRosterHarness dependencies={dependencies} selectedEventId="event-aaaa" />,
  );

  await waitFor(() => assert.equal(didStartLoadA, true));
  view.rerender(
    <DoorRosterHarness dependencies={dependencies} selectedEventId="event-bbbb" />,
  );
  await waitFor(() => {
    assert.equal(
      screen.getByTestId("guest-name").textContent,
      "Authoritative Guest B",
    );
    assert.equal(screen.getByTestId("outcome").textContent, "partial");
    assert.equal(screen.getByTestId("offline-mode").textContent, "false");
  });

  loadA.resolve(createScopedSnapshot("event-aaaa", guestA));
  await waitFor(() => {
    assert.equal(screen.getByTestId("offline-queued").textContent, "1");
  });
  assert.equal(
    screen.getByTestId("guest-name").textContent,
    "Authoritative Guest B",
  );
  assert.equal(screen.getByTestId("outcome").textContent, "partial");
  assert.equal(screen.getByTestId("offline-mode").textContent, "false");
});

test("offline store tasks wait for completion and continue after a rejection", async () => {
  const guestA = createScopedGuest("event-aaaa", "Guest A");
  const guestB = createScopedGuest("event-bbbb", "Guest B");
  const saveA = createDeferred<void>();
  const storeEvents: string[] = [];
  let activeStoreTasks = 0;
  let maxActiveStoreTasks = 0;

  async function trackStoreTask<T>(name: string, task: () => Promise<T>) {
    storeEvents.push(`start:${name}`);
    activeStoreTasks += 1;
    maxActiveStoreTasks = Math.max(maxActiveStoreTasks, activeStoreTasks);
    try {
      return await task();
    } finally {
      activeStoreTasks -= 1;
      storeEvents.push(`end:${name}`);
    }
  }

  const dependencies = createDependencies({
    fetchGuestOperationsSnapshot: async (_date, _venueId, eventId) => ({
      data: {
        guests: [eventId === "event-aaaa" ? guestA : guestB],
        users: [],
        externalLinks: [],
        failedSections: [],
      },
      error: null,
    }),
    fetchOfflineDoorRoster: async (scope) => ({
      data: [
        {
          id: scope.eventId === "event-aaaa" ? guestA.id : guestB.id,
          name: scope.eventId === "event-aaaa" ? guestA.name : guestB.name,
          status: "pending",
          checkInTime: null,
        },
      ],
      error: null,
    }),
    listOfflineDoorMutations: async (scope) =>
      trackStoreTask(`list:${scope.eventId}`, async () => []),
    saveOfflineDoorRoster: async (snapshot) =>
      trackStoreTask(`save:${snapshot.scope.eventId}`, async () => {
        if (snapshot.scope.eventId === "event-aaaa") await saveA.promise;
      }),
  });
  const view = render(
    <DoorRosterHarness dependencies={dependencies} selectedEventId="event-aaaa" />,
  );

  await waitFor(() =>
    assert.ok(storeEvents.includes("start:save:event-aaaa")),
  );
  view.rerender(
    <DoorRosterHarness dependencies={dependencies} selectedEventId="event-bbbb" />,
  );
  await waitFor(() => {
    assert.equal(screen.getByTestId("guest-name").textContent, "Guest B");
    assert.equal(screen.getByTestId("fetching").textContent, "false");
  });
  assert.equal(
    storeEvents.some((event) => event.includes("event-bbbb")),
    false,
  );

  saveA.reject(new Error("OFFLINE_STORAGE_FAILED"));
  await waitFor(() =>
    assert.ok(storeEvents.includes("end:save:event-bbbb")),
  );
  assert.equal(maxActiveStoreTasks, 1);
  assert.equal(screen.getByTestId("guest-name").textContent, "Guest B");
  assert.equal(
    screen.getByTestId("has-current-scope-data").textContent,
    "true",
  );
});


test("deleting a guest requires management access and never queues an offline deletion", async () => {
  for (const [allowed, online, pending] of [[false, true, false], [true, false, false], [true, true, true]] as const) {
    setOnline(online);
    let deletions = 0;
    let queued = 0;
    const dependencies = createDependencies({
      deleteGuest: async () => { deletions += 1; return { data: { ...GUEST, status: "deleted" }, error: null }; },
      enqueueOfflineDoorMutation: async () => { queued += 1; throw new Error("Deletion must not queue"); },
      listOfflineDoorMutations: async () => pending ? [createScopedMutation("event-0001", GUEST.id)] : [],
    });
    render(<DoorRosterHarness dependencies={dependencies} canDeleteGuests={allowed} selectedEventId="event-0001" />);
    await waitFor(() => assert.equal(screen.getByTestId("fetching").textContent, "false"));
    if (pending) await waitFor(() => assert.equal(screen.getByTestId("offline-queued").textContent, "1"));
    fireEvent.click(screen.getByRole("button", { name: "Delete guest" }));
    await act(async () => {});
    assert.equal(deletions, 0);
    assert.equal(queued, 0);
    assert.equal(screen.getByTestId("guest-count").textContent, "1");
    cleanup();
  }
});

test("confirmed deletion removes the visible guest and invalidates its offline snapshot even when refresh fails", async () => {
  let deleted = false;
  let invalidated = 0;
  const dependencies = createDependencies({
    deleteGuest: async () => { deleted = true; return { data: { ...GUEST, status: "deleted" }, error: null }; },
    removeOfflineDoorRoster: async () => { invalidated += 1; },
    fetchGuestOperationsSnapshot: async () => deleted ? { data: null, error: "UNAVAILABLE" } : { data: OPERATIONS_SNAPSHOT, error: null },
  });
  render(<DoorRosterHarness dependencies={dependencies} canDeleteGuests selectedEventId="event-0001" />);
  await waitFor(() => assert.equal(screen.getByTestId("fetching").textContent, "false"));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Delete guest" }));
  await waitFor(() => assert.equal(screen.getByTestId("busy").textContent, "false"));
  assert.equal(deleted, true);
  assert.equal(invalidated, 1);
  assert.equal(screen.getByTestId("guest-count").textContent, "0");
  assert.equal(screen.getByTestId("offline-queued").textContent, "0");
});


test("a late deletion invalidates only its original offline scope without changing the new roster", async () => {
  const deletion = createDeferred<Awaited<ReturnType<DoorRosterDependencies["deleteGuest"]>>>();
  const invalidated: string[] = [];
  const dependencies = createDependencies({
    deleteGuest: () => deletion.promise,
    removeOfflineDoorRoster: async (scope) => { invalidated.push(scope.eventId); },
  });
  const view = render(<DoorRosterHarness dependencies={dependencies} canDeleteGuests selectedEventId="event-0001" />);
  await waitFor(() => assert.equal(screen.getByTestId("fetching").textContent, "false"));
  fireEvent.click(screen.getByRole("button", { name: "Delete guest" }));
  view.rerender(<DoorRosterHarness dependencies={dependencies} canDeleteGuests selectedEventId="event-0002" />);
  await waitFor(() => assert.equal(screen.getByTestId("fetching").textContent, "false"));
  await act(async () => deletion.resolve({ data: { ...GUEST, status: "deleted" }, error: null }));
  assert.deepEqual(invalidated, ["event-0001"]);
  assert.equal(screen.getByTestId("guest-count").textContent, "1");
});
