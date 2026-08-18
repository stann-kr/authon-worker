import assert from "node:assert/strict";
import test from "node:test";

import {
  groupOfflineDoorMutationsByDevice,
  prepareOfflineDoorSyncBatch,
  resolveOfflineDoorSyncOutcome,
} from "./offline-sync.ts";

test("queued mutations are grouped by their original device before sync", () => {
  assert.deepEqual(groupOfflineDoorMutationsByDevice([
    { deviceId: "device-a", sequence: 2, id: "a2" },
    { deviceId: "device-b", sequence: 1, id: "b1" },
    { deviceId: "device-a", sequence: 1, id: "a1" },
  ]), [
    {
      deviceId: "device-a",
      mutations: [
        { deviceId: "device-a", sequence: 1, id: "a1" },
        { deviceId: "device-a", sequence: 2, id: "a2" },
      ],
    },
    {
      deviceId: "device-b",
      mutations: [{ deviceId: "device-b", sequence: 1, id: "b1" }],
    },
  ]);
});

const NOW = new Date("2026-08-14T02:00:00.000Z");

test("batch derives exact device sequence keys and sorts offline operations", () => {
  const batch = prepareOfflineDoorSyncBatch({
    deviceId: "device-123",
    now: NOW,
    items: [
      {
        idempotencyKey: "offline:device-123:2",
        sequence: 2,
        guestId: "guest-222",
        action: "cancel_check_in",
        queuedAt: "2026-08-14T01:50:00.000Z",
      },
      {
        idempotencyKey: "offline:device-123:1",
        sequence: 1,
        guestId: "guest-111",
        action: "check_in",
        queuedAt: "2026-08-14T01:40:00.000Z",
      },
    ],
  });
  assert.deepEqual(batch.items.map((item) => item.sequence), [1, 2]);
  assert.equal(batch.items[0].expired, false);
});

test("key substitution, duplicate sequences and future timestamps fail closed", () => {
  const base = {
    sequence: 1,
    guestId: "guest-111",
    action: "check_in",
    queuedAt: "2026-08-14T01:40:00.000Z",
  };
  assert.throws(
    () => prepareOfflineDoorSyncBatch({
      deviceId: "device-123",
      items: [{ ...base, idempotencyKey: "offline:other:1" }],
      now: NOW,
    }),
    /KEY/,
  );
  assert.throws(
    () => prepareOfflineDoorSyncBatch({
      deviceId: "device-123",
      items: [
        { ...base, idempotencyKey: "offline:device-123:1" },
        { ...base, idempotencyKey: "offline:device-123:1" },
      ],
      now: NOW,
    }),
    /ITEM/,
  );
  assert.throws(
    () => prepareOfflineDoorSyncBatch({
      deviceId: "device-123",
      items: [{
        ...base,
        idempotencyKey: "offline:device-123:1",
        queuedAt: "2026-08-14T02:06:00.000Z",
      }],
      now: NOW,
    }),
    /TIME/,
  );
});

test("two devices converging on the same status are both confirmed", () => {
  const first = resolveOfflineDoorSyncOutcome({
    idempotencyKey: "offline:device-a:1",
    guestId: "guest-111",
    persistenceOutcome: "applied",
    persistedStatus: "checked",
    persistedCheckInTime: NOW.toISOString(),
    currentStatus: "checked",
    currentCheckInTime: NOW.toISOString(),
    desiredStatus: "checked",
  });
  const second = resolveOfflineDoorSyncOutcome({
    idempotencyKey: "offline:device-b:1",
    guestId: "guest-111",
    persistenceOutcome: "rejected",
    persistedStatus: null,
    persistedCheckInTime: null,
    currentStatus: "checked",
    currentCheckInTime: NOW.toISOString(),
    desiredStatus: "checked",
  });
  assert.equal(first.state, "confirmed");
  assert.deepEqual(
    { state: second.state, resolution: second.resolution },
    { state: "confirmed", resolution: "already_applied" },
  );
});

test("payload reuse conflicts and deleted guests reject", () => {
  const conflict = resolveOfflineDoorSyncOutcome({
    idempotencyKey: "offline:device-a:1",
    guestId: "guest-111",
    persistenceOutcome: "conflict",
    persistedStatus: null,
    persistedCheckInTime: null,
    currentStatus: "pending",
    currentCheckInTime: null,
    desiredStatus: "checked",
  });
  const rejected = resolveOfflineDoorSyncOutcome({
    idempotencyKey: "offline:device-a:2",
    guestId: "guest-222",
    persistenceOutcome: "rejected",
    persistedStatus: null,
    persistedCheckInTime: null,
    currentStatus: "deleted",
    currentCheckInTime: null,
    desiredStatus: "checked",
  });
  assert.equal(conflict.state, "conflict");
  assert.equal(rejected.state, "rejected");
});

test("a closed attendance scope is terminal and never falls back to already applied", () => {
  const result = resolveOfflineDoorSyncOutcome({
    idempotencyKey: "offline:device-a:3",
    guestId: "guest-333",
    persistenceOutcome: "scope_closed",
    persistedStatus: null,
    persistedCheckInTime: null,
    currentStatus: "checked",
    currentCheckInTime: NOW.toISOString(),
    desiredStatus: "checked",
  });

  assert.deepEqual(result, {
    idempotencyKey: "offline:device-a:3",
    guestId: "guest-333",
    state: "scope_closed",
    resolution: null,
    status: null,
    checkInTime: null,
  });
});
