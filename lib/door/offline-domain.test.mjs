import assert from "node:assert/strict";
import test from "node:test";

import {
  applyQueuedDoorMutation,
  buildDoorGuestCode,
  createOfflineDoorMutation,
  createOfflineDoorRosterSnapshot,
  retainCurrentOfflineDoorData,
  parseDoorGuestCode,
  transitionOfflineDoorMutation,
} from "./offline-domain.ts";

test("door guest codes are opaque, scoped lookup values", () => {
  const id = "019ff8e5-ae97-7e72-afc1-ffd9e6228b34";
  assert.equal(buildDoorGuestCode(id), `AUTHON:${id}`);
  assert.equal(parseDoorGuestCode(`  AUTHON:${id}  `), id);
  assert.equal(parseDoorGuestCode("https://example.com/guest"), null);
  assert.equal(parseDoorGuestCode("AUTHON:bad id"), null);
});

const SCOPE = {
  venueId: "venue-123",
  eventId: "event-123",
  businessDate: "2026-08-13",
};
const NOW = new Date("2026-08-13T20:00:00.000Z");

test("offline queue stores only opaque scope, guest and device sequence fields", () => {
  const mutation = createOfflineDoorMutation({
    scope: SCOPE,
    deviceId: "device-123",
    sequence: 4,
    guestId: "guest-123",
    action: "check_in",
    now: NOW,
  });
  assert.equal(mutation.idempotencyKey, "offline:device-123:4");
  assert.equal(JSON.stringify(mutation).includes("name"), false);
  assert.equal(mutation.state, "queued");
  assert.equal(
    transitionOfflineDoorMutation(mutation, "confirmed", "applied").state,
    "confirmed",
  );
  assert.throws(
    () => transitionOfflineDoorMutation(
      transitionOfflineDoorMutation(mutation, "confirmed"),
      "conflict",
    ),
    /FINAL/,
  );
});

test("cached roster strips contributor and contact data", () => {
  const snapshot = createOfflineDoorRosterSnapshot({
    scope: SCOPE,
    guests: [{
      id: "guest-123",
      name: "ALICE",
      status: "pending",
      checkInTime: null,
      email: "not-copied@example.com",
      instagram: "not-copied",
      createdByUserId: "not-copied",
    }],
    now: NOW,
  });
  assert.deepEqual(snapshot.guests, [{
    id: "guest-123",
    name: "ALICE",
    status: "pending",
    checkInTime: null,
  }]);
});

test("event transition and TTL purge every non-current offline record", () => {
  const current = createOfflineDoorRosterSnapshot({
    scope: SCOPE,
    guests: [],
    now: NOW,
  });
  const other = { ...current, scope: { ...SCOPE, eventId: "event-456" } };
  const expired = { ...current, expiresAt: "2026-08-13T19:59:59.000Z" };
  const queued = createOfflineDoorMutation({
    scope: SCOPE,
    deviceId: "device-123",
    sequence: 1,
    guestId: "guest-123",
    action: "check_in",
    now: NOW,
  });
  const retained = retainCurrentOfflineDoorData({
    scope: SCOPE,
    snapshots: [current, other, expired],
    mutations: [queued, { ...queued, scope: other.scope }],
    now: new Date("2026-08-13T20:00:01.000Z"),
  });
  assert.deepEqual(retained.snapshots, [current]);
  assert.deepEqual(retained.mutations, [queued]);
});

test("queued status updates apply optimistically without adding fields", () => {
  const guests = [{ id: "guest-123", name: "ALICE", status: "pending", checkInTime: null }];
  const mutation = createOfflineDoorMutation({
    scope: SCOPE,
    deviceId: "device-123",
    sequence: 1,
    guestId: "guest-123",
    action: "check_in",
    now: NOW,
  });
  assert.deepEqual(applyQueuedDoorMutation(guests, mutation), [{
    id: "guest-123",
    name: "ALICE",
    status: "checked",
    checkInTime: NOW.toISOString(),
  }]);
});
