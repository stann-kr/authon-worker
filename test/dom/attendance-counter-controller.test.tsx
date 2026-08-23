import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import useAttendanceCounterController, {
  type AttendanceCounterDependencies,
} from "@/app/door/components/useAttendanceCounterController";
import type {
  AttendanceScope,
  DoorAttendanceAction,
  OfflineAttendanceMutation,
} from "@/lib/attendance/domain";
import type { DoorAttendanceSummary } from "@/lib/attendance/types";

const SCOPE_A: AttendanceScope = {
  venueId: "venue-0001",
  businessDate: "2026-08-23",
  eventId: "event-aaaa",
};
const SCOPE_B: AttendanceScope = {
  venueId: "venue-0001",
  businessDate: "2026-08-23",
  eventId: "event-bbbb",
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createSummary(
  scope: AttendanceScope,
  overrides: Partial<DoorAttendanceSummary> = {},
): DoorAttendanceSummary {
  const checkedInGuests = overrides.checkedInGuests ?? 5;
  const walkIns = overrides.walkIns ?? 2;
  return {
    ...scope,
    checkedInGuests,
    walkIns,
    totalAttendance: checkedInGuests + walkIns,
    sourceActivityCount: 7,
    isFinalized: false,
    finalizedAt: null,
    canFinalize: true,
    lastUndoableIdempotencyKey: null,
    canRecord: true,
    unavailableReason: null,
    serverUpdatedAt: "2026-08-23T10:00:00.000Z",
    ...overrides,
  };
}

function createMutation(params: {
  idempotencyKey: string;
  sequence: number;
  action: DoorAttendanceAction;
  reversesIdempotencyKey?: string | null;
  state?: OfflineAttendanceMutation["state"];
}): OfflineAttendanceMutation {
  return {
    idempotencyKey: params.idempotencyKey,
    deviceId: "device-0001",
    sequence: params.sequence,
    scope: SCOPE_A,
    action: params.action,
    reversesIdempotencyKey: params.reversesIdempotencyKey ?? null,
    queuedAt: `2026-08-23T10:00:0${params.sequence}.000Z`,
    state: params.state ?? "queued",
    resolution: null,
  };
}

function groupByDevice(mutations: readonly OfflineAttendanceMutation[]) {
  const groups = new Map<string, OfflineAttendanceMutation[]>();
  for (const mutation of mutations) {
    if (mutation.state !== "queued") continue;
    const group = groups.get(mutation.deviceId) ?? [];
    group.push(mutation);
    groups.set(mutation.deviceId, group);
  }
  return [...groups].map(([deviceId, grouped]) => ({
    deviceId,
    mutations: grouped.sort((left, right) => left.sequence - right.sequence),
  }));
}

function createDependencies(
  overrides: Partial<AttendanceCounterDependencies> = {},
): AttendanceCounterDependencies {
  return {
    fetchDoorAttendanceSummary: async ({ scope }) => ({
      data: createSummary(scope),
      error: null,
    }),
    reconcileDoorAttendance: async ({ scope, targetTotalAttendance }) => ({
      data: createSummary(scope, {
        walkIns: targetTotalAttendance - 5,
        totalAttendance: targetTotalAttendance,
      }),
      error: null,
    }),
    syncDoorAttendanceMutations: async ({ scope }) => ({
      data: { items: [], summary: createSummary(scope) },
      error: null,
    }),
    clearResolvedAttendanceMutations: async () => {},
    enqueueAttendanceMutation: async ({ action, reversesIdempotencyKey }) =>
      createMutation({
        idempotencyKey: `attendance:${action}`,
        sequence: action === "walk_in" ? 1 : 2,
        action,
        reversesIdempotencyKey,
      }),
    getAttendanceDeviceId: async () => "device-0001",
    groupAttendanceMutationsByDevice: groupByDevice,
    listAttendanceMutations: async () => [],
    removeAttendanceMutations: async () => {},
    resolveAttendanceMutation: async () => {},
    confirm: () => true,
    randomUUID: () => "uuid-0001",
    ...overrides,
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

function AttendanceCounterHarness({
  scope = SCOPE_A,
  dependencies,
  checkedInGuests = 0,
}: {
  scope?: AttendanceScope | null;
  dependencies: AttendanceCounterDependencies;
  checkedInGuests?: number;
}) {
  const controller = useAttendanceCounterController({
    scope,
    currentBusinessDate: "2026-08-23",
    checkedInGuests,
    hasPendingGuestMutations: false,
    canAdjust: true,
    translate: (key, values) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
    dependencies,
  });

  return (
    <>
      <output data-testid="checked-in">
        {controller.displayedCheckedInGuests}
      </output>
      <output data-testid="walk-ins">{controller.walkIns}</output>
      <output data-testid="scope-event">
        {controller.scopedSummary?.eventId ?? "none"}
      </output>
      <output data-testid="notice">{controller.notice ?? ""}</output>
      <output data-testid="announcement">{controller.announcement}</output>
      <output data-testid="failed-count">
        {controller.failedMutations.length}
      </output>
      <output data-testid="adjusting">{String(controller.isAdjusting)}</output>
      <output data-testid="target">{controller.reconciliationTarget}</output>
      <output data-testid="reason">{controller.adjustmentReason}</output>
      <button
        type="button"
        disabled={!controller.canRecord}
        onClick={() => void controller.queueWalkIn()}
      >
        Walk in
      </button>
      <button
        type="button"
        disabled={
          !controller.canRecord ||
          !controller.undoableKey ||
          controller.isUndoing
        }
        onClick={() => void controller.queueUndo()}
      >
        Undo
      </button>
      <form onSubmit={controller.submitAdjustment}>
        <label htmlFor="test-target">Target</label>
        <input
          id="test-target"
          value={controller.reconciliationTarget}
          onChange={(event) =>
            controller.changeReconciliationTarget(event.target.value)
          }
        />
        <label htmlFor="test-reason">Reason</label>
        <input
          id="test-reason"
          value={controller.adjustmentReason}
          onChange={(event) =>
            controller.changeAdjustmentReason(event.target.value)
          }
        />
        <button type="submit">Reconcile</button>
      </form>
    </>
  );
}

afterEach(() => {
  cleanup();
  setOnline(true);
});

test("a stale scope A summary cannot replace the completed scope B summary", async () => {
  const summaryA = createDeferred<{
    data: DoorAttendanceSummary;
    error: null;
  }>();
  const summaryB = createDeferred<{
    data: DoorAttendanceSummary;
    error: null;
  }>();
  const requestedEvents: Array<string | null> = [];
  const dependencies = createDependencies({
    fetchDoorAttendanceSummary: async ({ scope }) => {
      requestedEvents.push(scope.eventId);
      return scope.eventId === SCOPE_A.eventId
        ? summaryA.promise
        : summaryB.promise;
    },
  });
  const view = render(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  await waitFor(() => assert.deepEqual(requestedEvents, [SCOPE_A.eventId]));

  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_B} dependencies={dependencies} />,
  );
  await waitFor(() =>
    assert.deepEqual(requestedEvents, [SCOPE_A.eventId, SCOPE_B.eventId]),
  );
  await act(async () => {
    summaryB.resolve({
      data: createSummary(SCOPE_B, { checkedInGuests: 22 }),
      error: null,
    });
    await summaryB.promise;
  });
  await waitFor(() => {
    assert.equal(screen.getByTestId("checked-in").textContent, "22");
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_B.eventId);
  });

  await act(async () => {
    summaryA.resolve({
      data: createSummary(SCOPE_A, { checkedInGuests: 11 }),
      error: null,
    });
    await summaryA.promise;
  });
  assert.equal(screen.getByTestId("checked-in").textContent, "22");
  assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_B.eventId);
});

test("walk-in and undo publish only after their durable queue writes", async () => {
  setOnline(false);
  const walkInWrite = createDeferred<OfflineAttendanceMutation>();
  const undoWrite = createDeferred<OfflineAttendanceMutation>();
  const mutations: OfflineAttendanceMutation[] = [];
  const events: string[] = [];
  const enqueueParams: Array<{
    action: DoorAttendanceAction;
    reversesIdempotencyKey?: string | null;
  }> = [];
  const walkIn = createMutation({
    idempotencyKey: "attendance:walk-in-0001",
    sequence: 1,
    action: "walk_in",
  });
  const undo = createMutation({
    idempotencyKey: "attendance:undo-0001",
    sequence: 2,
    action: "reversal",
    reversesIdempotencyKey: walkIn.idempotencyKey,
  });
  const dependencies = createDependencies({
    enqueueAttendanceMutation: async (params) => {
      enqueueParams.push(params);
      events.push(`enqueue:${params.action}`);
      const mutation = await (
        params.action === "walk_in" ? walkInWrite.promise : undoWrite.promise
      );
      mutations.push(mutation);
      return mutation;
    },
    listAttendanceMutations: async () => {
      events.push("list");
      return [...mutations];
    },
  });
  render(<AttendanceCounterHarness dependencies={dependencies} />);
  await waitFor(() => {
    assert.equal(screen.getByTestId("walk-ins").textContent, "2");
    assert.equal(screen.getByRole("button", { name: "Walk in" }).hasAttribute("disabled"), false);
  });

  events.length = 0;
  fireEvent.click(screen.getByRole("button", { name: "Walk in" }));
  assert.deepEqual(events, ["enqueue:walk_in"]);
  assert.equal(screen.getByTestId("walk-ins").textContent, "2");
  await act(async () => {
    walkInWrite.resolve(walkIn);
    await walkInWrite.promise;
  });
  await waitFor(() => {
    assert.equal(screen.getByTestId("walk-ins").textContent, "3");
    assert.equal(screen.getByTestId("announcement").textContent, "recordedAnnouncement");
  });
  assert.deepEqual(events.slice(0, 2), ["enqueue:walk_in", "list"]);

  events.length = 0;
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  assert.deepEqual(events, ["enqueue:reversal"]);
  assert.equal(screen.getByTestId("walk-ins").textContent, "3");
  await act(async () => {
    undoWrite.resolve(undo);
    await undoWrite.promise;
  });
  await waitFor(() => {
    assert.equal(screen.getByTestId("walk-ins").textContent, "2");
    assert.equal(screen.getByTestId("announcement").textContent, "undoneAnnouncement");
  });
  assert.equal(
    enqueueParams[1]?.reversesIdempotencyKey,
    walkIn.idempotencyKey,
  );
  assert.deepEqual(events.slice(0, 2), ["enqueue:reversal", "list"]);
});

test("a queue write failure keeps the count unchanged and disables recording", async () => {
  setOnline(false);
  const dependencies = createDependencies({
    enqueueAttendanceMutation: async () => {
      throw new Error("ATTENDANCE_STORAGE_UNAVAILABLE");
    },
  });
  render(<AttendanceCounterHarness dependencies={dependencies} />);
  const walkInButton = await screen.findByRole("button", { name: "Walk in" });
  await waitFor(() => assert.equal(walkInButton.hasAttribute("disabled"), false));

  fireEvent.click(walkInButton);

  await waitFor(() => {
    assert.equal(screen.getByTestId("notice").textContent, "queueFailed");
    assert.equal(walkInButton.hasAttribute("disabled"), true);
  });
  assert.equal(screen.getByTestId("walk-ins").textContent, "2");
  assert.equal(screen.getByTestId("announcement").textContent, "");
});

test("sync reconciles item states and its summary outranks an older read", async () => {
  setOnline(true);
  const staleRead = createDeferred<{
    data: DoorAttendanceSummary;
    error: null;
  }>();
  let mutations = [
    createMutation({
      idempotencyKey: "attendance:confirmed-0001",
      sequence: 1,
      action: "walk_in",
    }),
    createMutation({
      idempotencyKey: "attendance:conflict-0001",
      sequence: 2,
      action: "walk_in",
    }),
  ];
  const syncPayloads: unknown[] = [];
  const removed: string[][] = [];
  const resolved: unknown[] = [];
  const dependencies = createDependencies({
    fetchDoorAttendanceSummary: async () => staleRead.promise,
    listAttendanceMutations: async () => [...mutations],
    syncDoorAttendanceMutations: async (params) => {
      syncPayloads.push(params);
      return {
        data: {
          items: [
            {
              idempotencyKey: "attendance:confirmed-0001",
              state: "confirmed",
              activityId: "activity-0001",
            },
            {
              idempotencyKey: "attendance:conflict-0001",
              state: "conflict",
              activityId: null,
            },
          ],
          summary: createSummary(SCOPE_A, {
            checkedInGuests: 7,
            walkIns: 4,
            totalAttendance: 11,
          }),
        },
        error: null,
      };
    },
    removeAttendanceMutations: async (keys) => {
      removed.push([...keys]);
      mutations = mutations.filter(
        (mutation) => !keys.includes(mutation.idempotencyKey),
      );
    },
    resolveAttendanceMutation: async (params) => {
      resolved.push(params);
      mutations = mutations.map((mutation) =>
        mutation.idempotencyKey === params.idempotencyKey
          ? { ...mutation, state: params.state }
          : mutation,
      );
    },
  });
  render(<AttendanceCounterHarness dependencies={dependencies} />);

  await waitFor(() => {
    assert.equal(screen.getByTestId("checked-in").textContent, "7");
    assert.equal(screen.getByTestId("walk-ins").textContent, "4");
    assert.equal(screen.getByTestId("failed-count").textContent, "1");
  });
  assert.equal(syncPayloads.length, 1);
  assert.deepEqual(removed, [["attendance:confirmed-0001"]]);
  assert.deepEqual(resolved, [
    {
      idempotencyKey: "attendance:conflict-0001",
      state: "conflict",
    },
  ]);

  await act(async () => {
    staleRead.resolve({
      data: createSummary(SCOPE_A, { checkedInGuests: 1, walkIns: 1 }),
      error: null,
    });
    await staleRead.promise;
  });
  assert.equal(screen.getByTestId("checked-in").textContent, "7");
  assert.equal(screen.getByTestId("walk-ins").textContent, "4");
});

test("reconciliation retries the exact payload with one idempotency key", async () => {
  const calls: Parameters<
    AttendanceCounterDependencies["reconcileDoorAttendance"]
  >[0][] = [];
  const confirmations: string[] = [];
  let uuidCalls = 0;
  const dependencies = createDependencies({
    reconcileDoorAttendance: async (params) => {
      calls.push(params);
      if (calls.length === 1) {
        return { data: null, error: "ATTENDANCE_RECONCILIATION_FAILED" };
      }
      return {
        data: createSummary(SCOPE_A, {
          walkIns: 5,
          totalAttendance: 10,
          isFinalized: true,
          finalizedAt: "2026-08-23T11:00:00.000Z",
          canFinalize: false,
          canRecord: false,
          unavailableReason: "scope_closed",
        }),
        error: null,
      };
    },
    confirm: (message) => {
      confirmations.push(message);
      return true;
    },
    randomUUID: () => {
      uuidCalls += 1;
      return "uuid-0001";
    },
  });
  render(<AttendanceCounterHarness dependencies={dependencies} />);
  await waitFor(() =>
    assert.equal(screen.getByTestId("checked-in").textContent, "5"),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Target" }), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "  counted at door  " },
  });
  const form = screen.getByRole("button", { name: "Reconcile" }).closest("form")!;

  fireEvent.submit(form);
  await waitFor(() => {
    assert.equal(calls.length, 1);
    assert.equal(screen.getByTestId("notice").textContent, "adjustmentFailed");
    assert.equal(screen.getByTestId("adjusting").textContent, "false");
  });
  fireEvent.submit(form);
  await waitFor(() => {
    assert.equal(calls.length, 2);
    assert.equal(screen.getByTestId("target").textContent, "");
    assert.equal(screen.getByTestId("reason").textContent, "");
    assert.equal(screen.getByTestId("announcement").textContent, "scopeClosed");
  });

  const expectedPayload = {
    scope: SCOPE_A,
    targetTotalAttendance: 10,
    expectedCheckedInGuests: 5,
    expectedWalkIns: 2,
    expectedSourceActivityCount: 7,
    reason: "  counted at door  ",
    idempotencyKey: "admin-adjustment:uuid-0001",
  };
  assert.deepEqual(calls, [expectedPayload, expectedPayload]);
  assert.deepEqual(confirmations, ["adjustment.confirm", "adjustment.confirm"]);
  assert.equal(uuidCalls, 1);
});
