import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
}: {
  dependencies: DoorRosterDependencies;
  selectedEventId?: string | null;
}) {
  const roster = useDoorRosterController({
    venueId: "venue-0001",
    selectedDate: "2026-08-23",
    selectedEventId,
    translate: TRANSLATE,
    dependencies,
  });

  return (
    <>
      <output data-testid="outcome">{roster.loadOutcome}</output>
      <output data-testid="feedback">{roster.feedback ?? ""}</output>
      <output data-testid="guest-count">{roster.displayData.guests.length}</output>
      <output data-testid="guest-status">
        {roster.displayData.guests[0]?.status ?? "none"}
      </output>
      <output data-testid="offline-mode">{String(roster.isOfflineMode)}</output>
      <output data-testid="offline-notice">{roster.offlineNotice ?? ""}</output>
      <output data-testid="offline-queued">{roster.offlineQueueCounts.queued}</output>
      <button
        type="button"
        onClick={() =>
          void roster.handleStatusChange(GUEST.id, "checked", "check")
        }
      >
        Check in
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
    assert.equal(screen.getByTestId("offline-notice").textContent, "queued");
  });
  assert.equal(enqueueCalls, 1);
});
