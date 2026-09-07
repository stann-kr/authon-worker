import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useLayoutEffect, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import useAttendanceCounterController, {
  type AttendanceCounterDependencies,
} from "@/app/door/components/useAttendanceCounterController";
import AttendanceReconciliationForm from "@/app/door/components/AttendanceReconciliationForm";
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
  scope?: AttendanceScope;
  reversesIdempotencyKey?: string | null;
  state?: OfflineAttendanceMutation["state"];
}): OfflineAttendanceMutation {
  return {
    idempotencyKey: params.idempotencyKey,
    deviceId: "device-0001",
    sequence: params.sequence,
    scope: params.scope ?? SCOPE_A,
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

interface AttendanceCounterCommit {
  scopeEventId: string | null;
  notice: string;
  canRecord: boolean;
  reconciliationTarget: string;
  adjustmentReason: string;
  isUndoing: boolean;
  isAdjusting: boolean;
  isSyncing: boolean;
  statusText: string | null;
  walkIns: number;
  failedCount: number;
  undoableKey: string | null;
}

function AttendanceCounterCommitProbe({
  commit,
  onCommit,
}: {
  commit: AttendanceCounterCommit;
  onCommit: (commit: AttendanceCounterCommit) => void;
}) {
  useLayoutEffect(() => {
    onCommit(commit);
  });
  return null;
}

function AttendanceCounterHarness({
  scope = SCOPE_A,
  dependencies,
  checkedInGuests = 0,
  onLayoutCommit,
}: {
  scope?: AttendanceScope | null;
  dependencies: AttendanceCounterDependencies;
  checkedInGuests?: number;
  onLayoutCommit?: (commit: AttendanceCounterCommit) => void;
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
      {onLayoutCommit ? (
        <AttendanceCounterCommitProbe
          commit={{
            scopeEventId: scope?.eventId ?? null,
            notice: controller.notice ?? "",
            canRecord: controller.canRecord,
            reconciliationTarget: controller.reconciliationTarget,
            adjustmentReason: controller.adjustmentReason,
            isUndoing: controller.isUndoing,
            isAdjusting: controller.isAdjusting,
            isSyncing: controller.isSyncing,
            statusText: controller.statusText,
            walkIns: controller.walkIns,
            failedCount: controller.failedMutations.length,
            undoableKey: controller.undoableKey,
          }}
          onCommit={onLayoutCommit}
        />
      ) : null}
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
      <output data-testid="syncing">{String(controller.isSyncing)}</output>
      <output data-testid="undoing">{String(controller.isUndoing)}</output>
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
      <button type="button" onClick={() => void controller.clearFailedResults()}>
        Clear failed
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
        {controller.isAdjustmentConfirmationOpen && (
          <button type="button" onClick={controller.cancelAdjustmentConfirmation}>
            Cancel reconciliation
          </button>
        )}
        <button type="submit">
          {controller.isAdjustmentConfirmationOpen ? "Finalize" : "Reconcile"}
        </button>
      </form>
    </>
  );
}

afterEach(() => {
  cleanup();
  setOnline(true);
});

function ReconciliationFocusHarness({
  saveGate,
  finalizationStatus = "finalized",
}: {
  saveGate?: Promise<void>;
  finalizationStatus?: "finalized" | "nonfinalizable";
}) {
  const [summary, setSummary] = useState(createSummary(SCOPE_A));
  const reconciliationStatusRef = useRef<HTMLParagraphElement>(null);
  const reconciliationFormHadFocusRef = useRef(false);
  const reconciliationFormWasVisibleRef = useRef(true);
  const isReconciliationFormVisible = !summary.isFinalized && summary.canFinalize;

  useLayoutEffect(() => {
    if (isReconciliationFormVisible) {
      reconciliationFormWasVisibleRef.current = true;
      return;
    }

    const shouldMoveFocus =
      reconciliationFormWasVisibleRef.current &&
      reconciliationFormHadFocusRef.current;
    reconciliationFormWasVisibleRef.current = false;
    reconciliationFormHadFocusRef.current = false;
    if (!shouldMoveFocus || document.activeElement !== document.body) return;
    reconciliationStatusRef.current?.focus({ preventScroll: true });
  }, [isReconciliationFormVisible]);

  const markReconciliationFormBlurred = (
    event: FocusEvent<HTMLFormElement>,
  ) => {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      !event.currentTarget.contains(nextTarget)
    ) {
      reconciliationFormHadFocusRef.current = false;
    }
  };
  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await saveGate;
    setSummary(
      createSummary(SCOPE_A, {
        isFinalized: finalizationStatus === "finalized",
        canFinalize: false,
        canRecord: false,
        finalizedAt:
          finalizationStatus === "finalized"
            ? "2026-08-23T11:00:00.000Z"
            : null,
      }),
    );
  };

  return (
    <>
      <button type="button">External attendance focus</button>
      <AttendanceReconciliationForm
        scope={SCOPE_A}
        scopedSummary={summary}
        serverCheckedInGuests={5}
        serverWalkIns={2}
        reconciliationTarget="10"
        reconciliationDelta={3}
        adjustmentReason="counted at door"
        hasPendingReconciliationMutations={false}
        isAdjusting={false}
        isAdjustmentConfirmationOpen
        cancelAdjustmentConfirmation={() => {}}
        adjustmentSubmitRef={null}
        adjustmentCancelRef={null}
        isReconciliationTargetInvalid={false}
        isReconciliationBelowCheckedGuests={false}
        isReconciliationDeltaOutOfRange={false}
        changeReconciliationTarget={() => {}}
        changeAdjustmentReason={() => {}}
        loadSummary={async () => {}}
        submitAdjustment={submitAdjustment}
        reconciliationStatusRef={reconciliationStatusRef}
        markReconciliationFormFocused={() => {
          reconciliationFormHadFocusRef.current = true;
        }}
        markReconciliationFormBlurred={markReconciliationFormBlurred}
        translate={(key) => key}
      />
    </>
  );
}

test("finalization moves focus from the removed reconciliation form to its status", async () => {
  render(<ReconciliationFocusHarness />);
  const details = document.querySelector("details");
  assert.ok(details);
  details.open = true;
  const submitButton = screen.getByRole("button", {
    name: "adjustment.save",
  });
  submitButton.focus();
  const form = submitButton.closest("form");
  assert.ok(form);
  fireEvent.blur(form, { relatedTarget: null });
  fireEvent.submit(form);

  await waitFor(() => {
    const status = screen.getByText("adjustment.finalized");
    assert.equal(document.activeElement === status, true);
  });
});

test("a nonfinalizable scope moves focus from the removed reconciliation form to its status", async () => {
  render(<ReconciliationFocusHarness finalizationStatus="nonfinalizable" />);
  const details = document.querySelector("details");
  assert.ok(details);
  details.open = true;
  const submitButton = screen.getByRole("button", {
    name: "adjustment.save",
  });
  submitButton.focus();
  fireEvent.submit(submitButton.closest("form")!);

  await waitFor(() => {
    const status = screen.getByText("adjustment.eventMustBeClosed");
    assert.equal(document.activeElement === status, true);
  });
});

test("finalization preserves focus moved outside while reconciliation is pending", async () => {
  const saveGate = createDeferred<void>();
  render(<ReconciliationFocusHarness saveGate={saveGate.promise} />);
  const details = document.querySelector("details");
  assert.ok(details);
  details.open = true;
  const submitButton = screen.getByRole("button", {
    name: "adjustment.save",
  });
  submitButton.focus();
  fireEvent.submit(submitButton.closest("form")!);
  const externalFocus = screen.getByRole("button", {
    name: "External attendance focus",
  });
  externalFocus.focus();

  await act(async () => {
    saveGate.resolve();
    await saveGate.promise;
  });
  assert.equal(screen.getByText("adjustment.finalized").textContent, "adjustment.finalized");
  assert.equal(document.activeElement === externalFocus, true);
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
  assert.equal(calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
  await waitFor(() => {
    assert.equal(calls.length, 1);
    assert.equal(screen.getByTestId("notice").textContent, "adjustmentFailed");
    assert.equal(screen.getByTestId("adjusting").textContent, "false");
  });
  fireEvent.submit(form);
  fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
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
  assert.equal(uuidCalls, 1);
});

test("reconciliation review is cancelled by input, summary, and scope changes", async () => {
  let checkedInGuests = 5;
  const calls: Parameters<AttendanceCounterDependencies["reconcileDoorAttendance"]>[0][] = [];
  const dependencies = createDependencies({
    fetchDoorAttendanceSummary: async ({ scope }) => ({
      data: createSummary(scope, { checkedInGuests }),
      error: null,
    }),
    reconcileDoorAttendance: async (params) => {
      calls.push(params);
      return { data: createSummary(params.scope), error: null };
    },
  });
  const view = render(<AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />);
  await waitFor(() => assert.equal(screen.getByTestId("checked-in").textContent, "5"));
  const fill = (reason: string) => {
    fireEvent.change(screen.getByRole("textbox", { name: "Target" }), { target: { value: "10" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: reason } });
  };
  const review = () => fireEvent.submit(screen.getByRole("button", { name: "Reconcile" }).closest("form")!);

  fill("counted at door");
  review();
  assert.equal(calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Cancel reconciliation" }));
  assert.equal(screen.queryByRole("button", { name: "Finalize" }), null);
  assert.equal(screen.getByTestId("target").textContent, "10");
  review();
  fill("updated count reason");
  assert.equal(screen.queryByRole("button", { name: "Finalize" }), null);
  review();

  checkedInGuests = 6;
  fireEvent(window, new Event("online"));
  await waitFor(() => assert.equal(screen.getByTestId("checked-in").textContent, "6"));
  assert.equal(screen.queryByRole("button", { name: "Finalize" }), null);
  assert.equal(calls.length, 0);
  review();
  view.rerender(<AttendanceCounterHarness scope={SCOPE_B} dependencies={dependencies} />);
  assert.equal(screen.queryByRole("button", { name: "Finalize" }), null);
  view.rerender(<AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />);
  await waitFor(() => assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_A.eventId));
  assert.equal(screen.queryByRole("button", { name: "Finalize" }), null);
  fill("confirmed current count");
  review();
  assert.equal(calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].expectedCheckedInGuests, 6);
  assert.equal(calls[0].scope.eventId, SCOPE_A.eventId);
  assert.equal(calls[0].reason, "confirmed current count");
});

test("same-tick duplicate reconciliation submits only once", async () => {
  const reconciliation = createDeferred<{
    data: DoorAttendanceSummary;
    error: null;
  }>();
  const calls: Parameters<
    AttendanceCounterDependencies["reconcileDoorAttendance"]
  >[0][] = [];
  let uuidCalls = 0;
  const dependencies = createDependencies({
    reconcileDoorAttendance: async (params) => {
      calls.push(params);
      return reconciliation.promise;
    },
    randomUUID: () => {
      uuidCalls += 1;
      return "uuid-duplicate";
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
    target: { value: "counted at door" },
  });
  const form = screen.getByRole("button", { name: "Reconcile" }).closest("form")!;

  fireEvent.submit(form);
  assert.equal(calls.length, 0);
  assert.ok(screen.getByRole("button", { name: "Finalize" }));

  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });

  assert.equal(uuidCalls, 1);
  assert.equal(calls.length, 1);

  await act(async () => {
    reconciliation.resolve({
      data: createSummary(SCOPE_A, {
        walkIns: 5,
        totalAttendance: 10,
      }),
      error: null,
    });
    await reconciliation.promise;
  });
});

test("scope adjustment ownership survives A to B to A navigation", async () => {
  const reconciliationA = createDeferred<{
    data: DoorAttendanceSummary;
    error: null;
  }>();
  const reconciliationB = createDeferred<{
    data: DoorAttendanceSummary;
    error: null;
  }>();
  const requestedEvents: Array<string | null> = [];
  const dependencies = createDependencies({
    reconcileDoorAttendance: async ({ scope }) => {
      requestedEvents.push(scope.eventId);
      return scope.eventId === SCOPE_A.eventId
        ? reconciliationA.promise
        : reconciliationB.promise;
    },
  });
  const view = render(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  await waitFor(() =>
    assert.equal(screen.getByTestId("checked-in").textContent, "5"),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Target" }), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "scope A count" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Reconcile" }).closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
  await waitFor(() => {
    assert.deepEqual(requestedEvents, [SCOPE_A.eventId]);
    assert.equal(screen.getByTestId("adjusting").textContent, "true");
  });

  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_B} dependencies={dependencies} />,
  );
  await waitFor(() => {
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_B.eventId);
    assert.equal(screen.getByTestId("target").textContent, "");
    assert.equal(screen.getByTestId("reason").textContent, "");
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Target" }), {
    target: { value: "11" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "scope B count" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Reconcile" }).closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
  await waitFor(() => {
    assert.deepEqual(requestedEvents, [SCOPE_A.eventId, SCOPE_B.eventId]);
    assert.equal(screen.getByTestId("adjusting").textContent, "true");
  });

  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  await waitFor(() => {
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_A.eventId);
    assert.equal(screen.getByTestId("adjusting").textContent, "true");
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Target" }), {
    target: { value: "12" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "duplicate scope A count" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Reconcile" }).closest("form")!);
  await act(async () => {
    await Promise.resolve();
  });
  assert.deepEqual(requestedEvents, [SCOPE_A.eventId, SCOPE_B.eventId]);

  await act(async () => {
    reconciliationB.resolve({
      data: createSummary(SCOPE_B, { totalAttendance: 11, walkIns: 6 }),
      error: null,
    });
    await reconciliationB.promise;
  });
  assert.equal(screen.getByTestId("adjusting").textContent, "true");

  await act(async () => {
    reconciliationA.resolve({
      data: createSummary(SCOPE_A, { totalAttendance: 10, walkIns: 5 }),
      error: null,
    });
    await reconciliationA.promise;
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("adjusting").textContent, "false"),
  );
});

for (const action of ["walk_in", "reversal"] as const) {
  test(`a stale ${action} queue failure cannot disable the active scope`, async () => {
    setOnline(false);
    const queueWrite = createDeferred<OfflineAttendanceMutation>();
    const dependencies = createDependencies({
      fetchDoorAttendanceSummary: async ({ scope }) => ({
        data: createSummary(scope, {
          lastUndoableIdempotencyKey: `undoable:${scope.eventId}`,
        }),
        error: null,
      }),
      enqueueAttendanceMutation: async () => queueWrite.promise,
    });
    const view = render(
      <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
    );
    const actionButton = await screen.findByRole("button", {
      name: action === "walk_in" ? "Walk in" : "Undo",
    });
    await waitFor(() => assert.equal(actionButton.hasAttribute("disabled"), false));

    fireEvent.click(actionButton);
    view.rerender(
      <AttendanceCounterHarness scope={SCOPE_B} dependencies={dependencies} />,
    );
    await waitFor(() => {
      assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_B.eventId);
      assert.equal(actionButton.hasAttribute("disabled"), false);
    });

    await act(async () => {
      queueWrite.reject(new Error("ATTENDANCE_STORAGE_UNAVAILABLE"));
      await queueWrite.promise.catch(() => {});
    });

    assert.equal(screen.getByTestId("notice").textContent, "");
    assert.equal(
      screen.getByRole("button", { name: "Walk in" }).hasAttribute("disabled"),
      false,
    );
  });
}

test("an old scope epoch cannot overwrite new same-scope local mutations", async () => {
  setOnline(false);
  const staleScopeAList = createDeferred<OfflineAttendanceMutation[]>();
  const freshScopeAMutation = createMutation({
    idempotencyKey: "fresh-scope-a",
    sequence: 2,
    action: "walk_in",
    scope: SCOPE_A,
  });
  const staleScopeAMutation = createMutation({
    idempotencyKey: "stale-scope-a",
    sequence: 1,
    action: "walk_in",
    scope: SCOPE_A,
    state: "conflict",
  });
  let scopeAListCalls = 0;
  const dependencies = createDependencies({
    listAttendanceMutations: async (scope) => {
      if (scope.eventId !== SCOPE_A.eventId) return [];
      scopeAListCalls += 1;
      return scopeAListCalls === 1
        ? staleScopeAList.promise
        : [freshScopeAMutation];
    },
  });
  const view = render(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  await waitFor(() => assert.equal(scopeAListCalls, 1));

  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_B} dependencies={dependencies} />,
  );
  await waitFor(() =>
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_B.eventId),
  );
  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  await waitFor(() => {
    assert.equal(scopeAListCalls, 2);
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_A.eventId);
    assert.equal(screen.getByTestId("walk-ins").textContent, "3");
    assert.equal(screen.getByTestId("failed-count").textContent, "0");
  });

  await act(async () => {
    staleScopeAList.resolve([staleScopeAMutation]);
    await staleScopeAList.promise;
  });
  assert.equal(screen.getByTestId("walk-ins").textContent, "3");
  assert.equal(screen.getByTestId("failed-count").textContent, "0");
});

test("an old scope epoch cannot disable or notify the new same scope", async () => {
  setOnline(false);
  const staleScopeAList = createDeferred<OfflineAttendanceMutation[]>();
  const staleScopeADevice = createDeferred<string>();
  const freshScopeAMutation = createMutation({
    idempotencyKey: "fresh-scope-a",
    sequence: 2,
    action: "walk_in",
    scope: SCOPE_A,
  });
  let scopeAListCalls = 0;
  let deviceCalls = 0;
  const dependencies = createDependencies({
    listAttendanceMutations: async (scope) => {
      if (scope.eventId !== SCOPE_A.eventId) return [];
      scopeAListCalls += 1;
      return scopeAListCalls === 1
        ? staleScopeAList.promise
        : [freshScopeAMutation];
    },
    getAttendanceDeviceId: async () => {
      deviceCalls += 1;
      return deviceCalls === 1 ? staleScopeADevice.promise : "device-0001";
    },
  });
  const view = render(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  await waitFor(() => {
    assert.equal(scopeAListCalls, 1);
    assert.equal(deviceCalls, 1);
  });

  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_B} dependencies={dependencies} />,
  );
  await waitFor(() =>
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_B.eventId),
  );
  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  const walkInButton = screen.getByRole("button", { name: "Walk in" });
  await waitFor(() => {
    assert.equal(scopeAListCalls, 2);
    assert.equal(deviceCalls, 3);
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_A.eventId);
    assert.equal(screen.getByTestId("walk-ins").textContent, "3");
    assert.equal(walkInButton.hasAttribute("disabled"), false);
  });

  await act(async () => {
    staleScopeAList.reject(new Error("ATTENDANCE_STORAGE_UNAVAILABLE"));
    staleScopeADevice.reject(new Error("ATTENDANCE_STORAGE_UNAVAILABLE"));
    await Promise.all([
      staleScopeAList.promise.catch(() => {}),
      staleScopeADevice.promise.catch(() => {}),
    ]);
  });
  assert.equal(screen.getByTestId("walk-ins").textContent, "3");
  assert.equal(screen.getByTestId("notice").textContent, "");
  assert.equal(walkInButton.hasAttribute("disabled"), false);
});

test("scope undo ownership survives A to B to A navigation", async () => {
  setOnline(false);
  const undoA = createDeferred<OfflineAttendanceMutation>();
  const undoB = createDeferred<OfflineAttendanceMutation>();
  const requestedEvents: Array<string | null> = [];
  const dependencies = createDependencies({
    fetchDoorAttendanceSummary: async ({ scope }) => ({
      data: createSummary(scope, {
        lastUndoableIdempotencyKey: `undoable:${scope.eventId}`,
      }),
      error: null,
    }),
    enqueueAttendanceMutation: async ({ scope, action }) => {
      requestedEvents.push(scope.eventId);
      assert.equal(action, "reversal");
      return scope.eventId === SCOPE_A.eventId
        ? undoA.promise
        : undoB.promise;
    },
  });
  const view = render(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  const undoButton = await screen.findByRole("button", { name: "Undo" });
  await waitFor(() => assert.equal(undoButton.hasAttribute("disabled"), false));

  fireEvent.click(undoButton);
  await waitFor(() => {
    assert.deepEqual(requestedEvents, [SCOPE_A.eventId]);
    assert.equal(screen.getByTestId("undoing").textContent, "true");
  });

  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_B} dependencies={dependencies} />,
  );
  await waitFor(() => {
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_B.eventId);
    assert.equal(undoButton.hasAttribute("disabled"), false);
  });
  fireEvent.click(undoButton);
  await waitFor(() => {
    assert.deepEqual(requestedEvents, [SCOPE_A.eventId, SCOPE_B.eventId]);
    assert.equal(screen.getByTestId("undoing").textContent, "true");
  });

  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  await waitFor(() => {
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_A.eventId);
    assert.equal(screen.getByTestId("undoing").textContent, "true");
    assert.equal(undoButton.hasAttribute("disabled"), true);
  });
  fireEvent.click(undoButton);
  assert.deepEqual(requestedEvents, [SCOPE_A.eventId, SCOPE_B.eventId]);

  await act(async () => {
    undoB.resolve(createMutation({
      idempotencyKey: "undo:b",
      sequence: 1,
      action: "reversal",
      scope: SCOPE_B,
      reversesIdempotencyKey: `undoable:${SCOPE_B.eventId}`,
    }));
    await undoB.promise;
    await Promise.resolve();
  });
  assert.equal(screen.getByTestId("undoing").textContent, "true");
  assert.equal(undoButton.hasAttribute("disabled"), true);

  await act(async () => {
    undoA.resolve(createMutation({
      idempotencyKey: "undo:a",
      sequence: 1,
      action: "reversal",
      scope: SCOPE_A,
      reversesIdempotencyKey: `undoable:${SCOPE_A.eventId}`,
    }));
    await undoA.promise;
    await Promise.resolve();
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("undoing").textContent, "false"),
  );
});

test("a pending scope sync runs once without clearing the active sync state", async () => {
  setOnline(true);
  const commits: AttendanceCounterCommit[] = [];
  const syncA = createDeferred<{
    data: { items: never[]; summary: DoorAttendanceSummary };
    error: null;
  }>();
  const pendingBList = createDeferred<OfflineAttendanceMutation[]>();
  const syncB = createDeferred<{
    data: { items: never[]; summary: DoorAttendanceSummary };
    error: null;
  }>();
  const mutationA = createMutation({
    idempotencyKey: "sync:a",
    sequence: 1,
    action: "walk_in",
    scope: SCOPE_A,
  });
  const mutationB = createMutation({
    idempotencyKey: "sync:b",
    sequence: 1,
    action: "walk_in",
    scope: SCOPE_B,
  });
  const queuedByScope = new Map([
    [SCOPE_A.eventId, [mutationA]],
    [SCOPE_B.eventId, [mutationB]],
  ]);
  const listCalls = new Map<string | null, number>();
  const syncEvents: Array<string | null> = [];
  const dependencies = createDependencies({
    listAttendanceMutations: async (scope) => {
      const calls = (listCalls.get(scope.eventId) ?? 0) + 1;
      listCalls.set(scope.eventId, calls);
      if (scope.eventId === SCOPE_B.eventId && calls === 2) {
        return pendingBList.promise;
      }
      return [...(queuedByScope.get(scope.eventId) ?? [])];
    },
    syncDoorAttendanceMutations: async ({ scope }) => {
      syncEvents.push(scope.eventId);
      return scope.eventId === SCOPE_A.eventId ? syncA.promise : syncB.promise;
    },
    removeAttendanceMutations: async (keys) => {
      for (const [eventId, mutations] of queuedByScope) {
        queuedByScope.set(
          eventId,
          mutations.filter((mutation) => !keys.includes(mutation.idempotencyKey)),
        );
      }
    },
  });
  const view = render(
    <AttendanceCounterHarness
      scope={SCOPE_A}
      dependencies={dependencies}
      onLayoutCommit={(commit) => commits.push(commit)}
    />,
  );
  await waitFor(() => {
    assert.deepEqual(syncEvents, [SCOPE_A.eventId]);
    assert.equal(screen.getByTestId("syncing").textContent, "true");
  });

  commits.length = 0;
  view.rerender(
    <AttendanceCounterHarness
      scope={SCOPE_B}
      dependencies={dependencies}
      onLayoutCommit={(commit) => commits.push(commit)}
    />,
  );
  const firstScopeBCommit = commits.find(
    (commit) => commit.scopeEventId === SCOPE_B.eventId,
  );
  await waitFor(() => {
    assert.equal(listCalls.get(SCOPE_B.eventId), 1);
    assert.equal(screen.getByTestId("walk-ins").textContent, "3");
    assert.equal(screen.getByTestId("syncing").textContent, "true");
  });
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    syncA.resolve({
      data: { items: [], summary: createSummary(SCOPE_A) },
      error: null,
    });
    await syncA.promise;
    await Promise.resolve();
  });
  await waitFor(() =>
    assert.equal(listCalls.get(SCOPE_B.eventId), 2),
  );
  assert.equal(screen.getByTestId("syncing").textContent, "true");

  await act(async () => {
    pendingBList.resolve([mutationB]);
    await pendingBList.promise;
  });
  await waitFor(() => {
    assert.deepEqual(syncEvents, [SCOPE_A.eventId, SCOPE_B.eventId]);
    assert.equal(screen.getByTestId("syncing").textContent, "true");
  });

  await act(async () => {
    syncB.resolve({
      data: { items: [], summary: createSummary(SCOPE_B) },
      error: null,
    });
    await syncB.promise;
    await Promise.resolve();
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("syncing").textContent, "false"),
  );
  assert.deepEqual(syncEvents, [SCOPE_A.eventId, SCOPE_B.eventId]);
  assert.equal(firstScopeBCommit?.isSyncing, false);
  assert.equal(firstScopeBCommit?.statusText, null);
});

test("a stale clear-failed rejection cannot publish into the active scope", async () => {
  setOnline(false);
  const clearFailed = createDeferred<void>();
  const dependencies = createDependencies({
    clearResolvedAttendanceMutations: async () => clearFailed.promise,
  });
  const view = render(
    <AttendanceCounterHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  await waitFor(() =>
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_A.eventId),
  );

  fireEvent.click(screen.getByRole("button", { name: "Clear failed" }));
  view.rerender(
    <AttendanceCounterHarness scope={SCOPE_B} dependencies={dependencies} />,
  );
  await waitFor(() =>
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_B.eventId),
  );

  await act(async () => {
    clearFailed.reject(new Error("ATTENDANCE_STORAGE_UNAVAILABLE"));
    await clearFailed.promise.catch(() => {});
  });
  assert.equal(screen.getByTestId("notice").textContent, "");
});

test("the first committed scope frame never exposes the previous scope state", async () => {
  setOnline(false);
  const reconciliationA = createDeferred<{
    data: DoorAttendanceSummary;
    error: null;
  }>();
  const undoA = createDeferred<OfflineAttendanceMutation>();
  const commits: AttendanceCounterCommit[] = [];
  const dependencies = createDependencies({
    fetchDoorAttendanceSummary: async ({ scope }) => ({
      data: createSummary(scope, {
        lastUndoableIdempotencyKey: `undoable:${scope.eventId}`,
      }),
      error: null,
    }),
    reconcileDoorAttendance: async ({ scope }) => {
      assert.equal(scope.eventId, SCOPE_A.eventId);
      return reconciliationA.promise;
    },
    enqueueAttendanceMutation: async ({ scope, action }) => {
      assert.equal(scope.eventId, SCOPE_A.eventId);
      assert.equal(action, "reversal");
      return undoA.promise;
    },
    clearResolvedAttendanceMutations: async () => {
      throw new Error("ATTENDANCE_STORAGE_UNAVAILABLE");
    },
  });
  const view = render(
    <AttendanceCounterHarness
      scope={SCOPE_A}
      dependencies={dependencies}
      onLayoutCommit={(commit) => commits.push(commit)}
    />,
  );
  await waitFor(() =>
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_A.eventId),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Target" }), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "scope A draft" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Reconcile" }).closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear failed" }));
  await waitFor(() => {
    assert.equal(screen.getByTestId("notice").textContent, "queueFailed");
    assert.equal(screen.getByTestId("target").textContent, "10");
    assert.equal(screen.getByTestId("reason").textContent, "scope A draft");
    assert.equal(screen.getByTestId("undoing").textContent, "true");
    assert.equal(screen.getByTestId("adjusting").textContent, "true");
    assert.equal(
      screen.getByRole("button", { name: "Walk in" }).hasAttribute("disabled"),
      false,
    );
  });

  commits.length = 0;
  view.rerender(
    <AttendanceCounterHarness
      scope={SCOPE_B}
      dependencies={dependencies}
      onLayoutCommit={(commit) => commits.push(commit)}
    />,
  );
  const firstScopeBCommit = commits.find(
    (commit) => commit.scopeEventId === SCOPE_B.eventId,
  );
  commits.length = 0;
  view.rerender(
    <AttendanceCounterHarness
      scope={SCOPE_A}
      dependencies={dependencies}
      onLayoutCommit={(commit) => commits.push(commit)}
    />,
  );
  const firstReturnedScopeACommit = commits.find(
    (commit) => commit.scopeEventId === SCOPE_A.eventId,
  );
  await waitFor(() => {
    assert.equal(screen.getByTestId("scope-event").textContent, SCOPE_A.eventId);
    assert.equal(screen.getByTestId("notice").textContent, "");
    assert.equal(screen.getByTestId("target").textContent, "");
    assert.equal(screen.getByTestId("reason").textContent, "");
    assert.equal(screen.getByTestId("undoing").textContent, "true");
    assert.equal(screen.getByTestId("adjusting").textContent, "true");
  });

  await act(async () => {
    reconciliationA.resolve({ data: createSummary(SCOPE_A), error: null });
    undoA.resolve(createMutation({
      idempotencyKey: "undo:scope-a",
      sequence: 1,
      action: "reversal",
      scope: SCOPE_A,
      reversesIdempotencyKey: `undoable:${SCOPE_A.eventId}`,
    }));
    await Promise.all([reconciliationA.promise, undoA.promise]);
  });
  await waitFor(() => {
    assert.equal(screen.getByTestId("undoing").textContent, "false");
    assert.equal(screen.getByTestId("adjusting").textContent, "false");
  });

  const neutralScopeCommit = (scopeEventId: string | null) => ({
    scopeEventId,
    notice: "",
    canRecord: false,
    reconciliationTarget: "",
    adjustmentReason: "",
    isUndoing: false,
    isAdjusting: false,
    isSyncing: false,
    statusText: null,
    walkIns: 0,
    failedCount: 0,
    undoableKey: null,
  });
  assert.deepEqual(firstScopeBCommit, neutralScopeCommit(SCOPE_B.eventId));
  assert.deepEqual(
    firstReturnedScopeACommit,
    neutralScopeCommit(SCOPE_A.eventId),
  );
});
