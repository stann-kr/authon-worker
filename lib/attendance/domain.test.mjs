import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ATTENDANCE_SYNC_BATCH,
  MAX_OFFLINE_ATTENDANCE_MUTATIONS,
  canApplyAttendanceEventMutation,
  createOfflineAttendanceMutation,
  findLatestUndoableAttendanceKey,
  isAttendanceIdempotencyKey,
  pendingAttendanceDelta,
  prepareAttendanceAdjustment,
  prepareAttendanceSyncBatch,
  transitionOfflineAttendanceMutation,
} from "./domain.ts";

const scope = {
  venueId: "venue-a",
  businessDate: "2026-08-16",
  eventId: null,
};
const now = new Date("2026-08-16T12:00:00.000Z");

test("offline attendance mutations preserve scope, sequence, and reversal intent", () => {
  const walkIn = createOfflineAttendanceMutation({
    scope,
    deviceId: "device-a",
    sequence: 1,
    action: "walk_in",
    now,
  });
  const reversal = createOfflineAttendanceMutation({
    scope,
    deviceId: "device-a",
    sequence: 2,
    action: "reversal",
    reversesIdempotencyKey: walkIn.idempotencyKey,
    now: new Date(now.getTime() + 1_000),
  });
  assert.match(
    walkIn.idempotencyKey,
    /^attendance:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(walkIn.idempotencyKey.includes("device-a"), false);
  assert.equal(reversal.reversesIdempotencyKey, walkIn.idempotencyKey);
  assert.equal(pendingAttendanceDelta([walkIn]), 1);
  assert.equal(pendingAttendanceDelta([walkIn, reversal]), 0);
  assert.equal(findLatestUndoableAttendanceKey([walkIn, reversal]), null);
});

test("latest pending walk-in remains undoable until a reversal is queued", () => {
  const first = createOfflineAttendanceMutation({
    scope,
    deviceId: "device-a",
    sequence: 1,
    action: "walk_in",
    now,
  });
  const second = createOfflineAttendanceMutation({
    scope,
    deviceId: "device-a",
    sequence: 2,
    action: "walk_in",
    now,
  });
  assert.equal(findLatestUndoableAttendanceKey([first, second]), second.idempotencyKey);
  const confirmed = transitionOfflineAttendanceMutation(second, "confirmed", "applied");
  assert.equal(findLatestUndoableAttendanceKey([first, confirmed]), first.idempotencyKey);
  assert.throws(
    () => transitionOfflineAttendanceMutation(confirmed, "rejected"),
    /ATTENDANCE_MUTATION_FINAL/,
  );
});

test("sync batch is bounded, unique, ordered, and age-aware", () => {
  const items = prepareAttendanceSyncBatch({
    deviceId: "device-a",
    now,
    items: [
      {
        idempotencyKey: "attendance:device-a:2",
        sequence: 2,
        action: "reversal",
        reversesIdempotencyKey: "attendance:device-a:1",
        occurredAt: "2026-08-16T11:59:00.000Z",
      },
      {
        idempotencyKey: "attendance:device-a:1",
        sequence: 1,
        action: "walk_in",
        reversesIdempotencyKey: null,
        occurredAt: "2026-08-16T11:58:00.000Z",
      },
    ],
  });
  assert.deepEqual(items.map((item) => item.sequence), [1, 2]);
  assert.equal(items.every((item) => !item.isExpired), true);
  assert.throws(
    () => prepareAttendanceSyncBatch({ deviceId: "device-a", now, items: [] }),
    /INVALID_ATTENDANCE_BATCH/,
  );
  assert.throws(
    () => prepareAttendanceSyncBatch({
      deviceId: "device-a",
      now,
      items: [
        {
          idempotencyKey: "same",
          sequence: 1,
          action: "walk_in",
          occurredAt: now.toISOString(),
        },
        {
          idempotencyKey: "same",
          sequence: 2,
          action: "walk_in",
          occurredAt: now.toISOString(),
        },
      ],
    }),
    /INVALID_ATTENDANCE_BATCH/,
  );
});

test("the offline queue budget covers 5,000 rapid walk-in taps", () => {
  const mutations = Array.from(
    { length: MAX_OFFLINE_ATTENDANCE_MUTATIONS },
    (_, index) => createOfflineAttendanceMutation({
      scope,
      deviceId: "device-a",
      sequence: index + 1,
      action: "walk_in",
      now,
    }),
  );
  assert.equal(pendingAttendanceDelta(mutations), 5_000);
  assert.equal(MAX_ATTENDANCE_SYNC_BATCH, 100);
  assert.throws(
    () => prepareAttendanceSyncBatch({
      deviceId: "device-a",
      now,
      items: mutations.slice(0, MAX_ATTENDANCE_SYNC_BATCH + 1).map(
        (mutation) => ({
          idempotencyKey: mutation.idempotencyKey,
          sequence: mutation.sequence,
          action: mutation.action,
          occurredAt: mutation.queuedAt,
        }),
      ),
    }),
    /INVALID_ATTENDANCE_BATCH/,
  );
});

test("manual adjustment requires a bounded non-zero delta and audit reason", () => {
  assert.deepEqual(
    prepareAttendanceAdjustment({ delta: -3, reason: "  missed duplicate taps  " }),
    { delta: -3, reason: "missed duplicate taps" },
  );
  assert.throws(
    () => prepareAttendanceAdjustment({ delta: 0, reason: "none" }),
    /INVALID_ATTENDANCE_ADJUSTMENT/,
  );
  assert.throws(
    () => prepareAttendanceAdjustment({ delta: 1, reason: "" }),
    /INVALID_ATTENDANCE_ADJUSTMENT/,
  );
  assert.equal(isAttendanceIdempotencyKey("admin-adjustment:valid"), true);
  assert.equal(isAttendanceIdempotencyKey("admin-adjustment:\ninvalid"), false);
});

test("Event mutations are accepted only inside the recorded open window", () => {
  const openEvent = {
    state: "open",
    openedAt: "2026-08-16T10:00:00.000Z",
    closedAt: null,
  };
  assert.equal(
    canApplyAttendanceEventMutation(openEvent, "2026-08-16T10:01:00.000Z"),
    true,
  );
  assert.equal(
    canApplyAttendanceEventMutation(openEvent, "2026-08-16T09:59:00.000Z"),
    false,
  );
  assert.equal(
    canApplyAttendanceEventMutation(
      {
        ...openEvent,
        state: "closed",
        closedAt: "2026-08-16T12:00:00.000Z",
      },
      "2026-08-16T11:00:00.000Z",
    ),
    true,
  );
  assert.equal(
    canApplyAttendanceEventMutation(
      { state: "draft", openedAt: null, closedAt: null },
      "2026-08-16T11:00:00.000Z",
    ),
    false,
  );
});
