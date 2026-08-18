import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  hashAttendanceCloseoutReport,
  hashAttendancePayload,
  hashAttendanceReconciliationPayload,
  INSERT_ATTENDANCE_CLOSEOUT_SQL,
  INSERT_WALK_IN_ATTENDANCE_SQL,
  persistAttendanceReconciliation,
  persistDoorAttendanceMutation,
} from "./persistence.ts";

const ledgerMigration = await readFile(
  new URL("../../migrations/0022_attendance_activity_ledger.sql", import.meta.url),
  "utf8",
);
const closeoutMigration = await readFile(
  new URL("../../migrations/0023_attendance_closeouts.sql", import.meta.url),
  "utf8",
);

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE venues (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE events (
      id TEXT PRIMARY KEY NOT NULL,
      venue_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      compatibility_key TEXT,
      state TEXT NOT NULL
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY NOT NULL,
      venue_id TEXT NOT NULL,
      date TEXT NOT NULL,
      event_id TEXT,
      status TEXT NOT NULL,
      check_in_time TEXT
    );
    INSERT INTO venues VALUES ('venue-a');
    INSERT INTO users VALUES ('user-a');
    INSERT INTO events VALUES ('event-closed', 'venue-a', '2026-08-16', NULL, 'closed');
    INSERT INTO events VALUES ('event-open', 'venue-a', '2026-08-16', NULL, 'open');
    INSERT INTO events VALUES ('compat-event', 'venue-a', '2026-08-16', 'legacy:venue-a:2026-08-16', 'open');
  `);
  database.exec(ledgerMigration);
  database.exec(closeoutMigration);
  return database;
}

function asD1(database) {
  return {
    prepare(statement) {
      let values = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          return this;
        },
        async first() {
          return database.prepare(statement).get(...values) ?? null;
        },
      };
    },
  };
}

function insertWalkIn(database, {
  id = "walk-in-a",
  eventId = null,
  idempotencyKey = "attendance:device-a:1",
  deviceSequence = 1,
} = {}) {
  return database.prepare(INSERT_WALK_IN_ATTENDANCE_SQL).get(
    id, "venue-a", "2026-08-16", eventId, "user-a", `request:${id}`,
    idempotencyKey, `hash:${id}`, "device-hash-a", deviceSequence,
    "2026-08-16T12:00:00.000Z", "2026-08-16T12:00:00.000Z",
    "venue-a", "2026-08-16", eventId,
    "venue-a", idempotencyKey,
  );
}

function closeAttendance(database, {
  id = "closeout-a",
  eventId = null,
  targetTotalAttendance,
  expectedCheckedInGuests = 0,
  expectedWalkIns = 0,
  expectedSourceActivityCount = 0,
  idempotencyKey = `closeout:${id}`,
  adjustmentActivityId = `adjustment:${id}`,
} = {}) {
  return database.prepare(INSERT_ATTENDANCE_CLOSEOUT_SQL).get(
    "venue-a", "2026-08-16", eventId, eventId, eventId,
    "venue-a", "2026-08-16", "legacy:venue-a:2026-08-16",
    "venue-a", "2026-08-16", eventId,
    "venue-a", "2026-08-16", eventId,
    targetTotalAttendance,
    id, "venue-a", "2026-08-16", eventId, targetTotalAttendance,
    adjustmentActivityId, "closing manual count", "user-a", `request:${id}`,
    idempotencyKey, `payload:${id}`, `report:${id}`,
    "2026-08-16T12:00:00.000Z", "2026-08-16T12:00:00.000Z",
    expectedCheckedInGuests, expectedWalkIns, expectedSourceActivityCount,
    targetTotalAttendance, "venue-a", idempotencyKey,
    eventId, eventId, "venue-a", "2026-08-16",
  );
}

test("attendance closeout is a zero-delta immutable snapshot without a synthetic activity", () => {
  const database = createDatabase();
  database.exec("INSERT INTO guests VALUES ('guest-a', 'venue-a', '2026-08-16', NULL, 'checked', '2026-08-16T12:00:00.000Z')");
  const inserted = closeAttendance(database, {
    targetTotalAttendance: 1,
    expectedCheckedInGuests: 1,
  });
  assert.deepEqual({ ...inserted }, { id: "closeout-a", adjustmentActivityId: null });
  assert.equal(database.prepare("SELECT count(*) AS count FROM attendance_activity_ledger").get().count, 0);
  assert.throws(() => database.exec("UPDATE attendance_closeouts SET target_total_attendance = 2"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM attendance_closeouts"), /immutable/);
  database.close();
});

test("nonzero closeout atomically appends its adjustment and freezes subsequent ledger writes", () => {
  const database = createDatabase();
  const inserted = closeAttendance(database, {
    targetTotalAttendance: 3,
    expectedWalkIns: 0,
  });
  assert.deepEqual({ ...inserted }, { id: "closeout-a", adjustmentActivityId: "adjustment:closeout-a" });
  assert.deepEqual(
    { ...database.prepare("SELECT action, delta, idempotency_key AS idempotencyKey FROM attendance_activity_ledger").get() },
    { action: "manual_adjustment", delta: 3, idempotencyKey: "closeout:closeout-a" },
  );
  assert.equal(insertWalkIn(database, { id: "late-walk", idempotencyKey: "attendance:device-a:2", deviceSequence: 2 }), undefined);
  database.close();
});

test("closeout refuses an idempotency key already owned by an activity", () => {
  const database = createDatabase();
  insertWalkIn(database, { idempotencyKey: "closeout:closeout-a" });
  assert.equal(closeAttendance(database, {
    targetTotalAttendance: 2,
    expectedWalkIns: 1,
    expectedSourceActivityCount: 1,
  }), undefined);
  assert.equal(database.prepare("SELECT count(*) AS count FROM attendance_closeouts").get().count, 0);
  database.close();
});

test("closeouts compare checked guests, ledger total, and ledger source count", () => {
  const database = createDatabase();
  insertWalkIn(database);
  assert.equal(closeAttendance(database, { targetTotalAttendance: 1, expectedWalkIns: 1 }), undefined);
  assert.equal(closeAttendance(database, {
    targetTotalAttendance: 1,
    expectedWalkIns: 1,
    expectedSourceActivityCount: 1,
  }).id, "closeout-a");
  database.close();
});

test("named and general closeouts are isolated and named open or compatibility Events are refused", () => {
  const database = createDatabase();
  assert.equal(closeAttendance(database, { eventId: "event-open", targetTotalAttendance: 0 }), undefined);
  assert.equal(closeAttendance(database, { eventId: "compat-event", targetTotalAttendance: 0 }), undefined);
  assert.equal(closeAttendance(database, { targetTotalAttendance: 0 }).id, "closeout-a");
  assert.equal(closeAttendance(database, {
    id: "named-closeout",
    eventId: "event-closed",
    targetTotalAttendance: 0,
  }).id, "named-closeout");
  assert.equal(database.prepare("SELECT count(*) AS count FROM attendance_closeouts").get().count, 2);
  database.close();
});

test("attendance closeout payload and report hashes preserve separate contracts", async () => {
  const base = {
    scope: { venueId: "venue-a", businessDate: "2026-08-16", eventId: null },
    targetTotalAttendance: 12,
    expectedCheckedInGuests: 7,
    expectedWalkIns: 3,
    expectedSourceActivityCount: 4,
    reason: "closing manual count",
    actorUserId: "user-a",
  };
  assert.equal(
    await hashAttendanceReconciliationPayload(base),
    await hashAttendanceReconciliationPayload(base),
  );
  assert.notEqual(
    await hashAttendanceReconciliationPayload(base),
    await hashAttendanceReconciliationPayload({ ...base, expectedSourceActivityCount: 5 }),
  );
  const report = await hashAttendanceCloseoutReport({
    scope: base.scope,
    targetTotalAttendance: 12,
    checkedInGuests: 7,
    preAdjustmentWalkIns: 3,
    adjustmentDelta: 2,
    sourceActivityCount: 4,
    reason: base.reason,
    actorUserId: base.actorUserId,
    finalizedAt: "2026-08-16T12:00:00.000Z",
  });
  assert.notEqual(report, await hashAttendancePayload({
    scope: base.scope,
    action: "walk_in",
    delta: 1,
    actorUserId: base.actorUserId,
    deviceSequence: 1,
    occurredAt: "2026-08-16T12:00:00.000Z",
  }));
});

test("persistence returns replay, conflict, stale, and scope_closed without leaking a late ledger write", async () => {
  const database = createDatabase();
  const d1 = asD1(database);
  const scope = { venueId: "venue-a", businessDate: "2026-08-16", eventId: null };
  const closeoutParams = {
    database: d1,
    scope,
    compatibilityEventKey: "legacy:venue-a:2026-08-16",
    actorUserId: "user-a",
    idempotencyKey: "closeout:replay",
    targetTotalAttendance: 0,
    expectedCheckedInGuests: 0,
    expectedWalkIns: 0,
    expectedSourceActivityCount: 0,
    reason: "closing manual count",
    occurredAt: "2026-08-16T12:00:00.000Z",
  };
  assert.equal((await persistAttendanceReconciliation(closeoutParams)).outcome, "applied");
  assert.equal((await persistAttendanceReconciliation(closeoutParams)).outcome, "replayed");
  assert.equal((await persistAttendanceReconciliation({ ...closeoutParams, targetTotalAttendance: 1 })).outcome, "conflict");
  assert.equal((await persistDoorAttendanceMutation({
    database: d1,
    scope,
    actorUserId: "user-a",
    deviceKeyHash: "device-hash-a",
    deviceSequence: 1,
    idempotencyKey: "attendance:after-closeout",
    action: "walk_in",
    reversesIdempotencyKey: null,
    occurredAt: "2026-08-16T12:00:00.000Z",
    createdAt: "2026-08-16T12:00:00.000Z",
    canApplyNew: true,
  })).outcome, "scope_closed");
  database.close();
});

test("a zero-delta closeout owns its idempotency key across attendance scopes", async () => {
  const database = createDatabase();
  const d1 = asD1(database);
  const generalScope = {
    venueId: "venue-a",
    businessDate: "2026-08-16",
    eventId: null,
  };
  assert.equal((await persistAttendanceReconciliation({
    database: d1,
    scope: generalScope,
    compatibilityEventKey: "legacy:venue-a:2026-08-16",
    actorUserId: "user-a",
    idempotencyKey: "closeout:shared-key",
    targetTotalAttendance: 0,
    expectedCheckedInGuests: 0,
    expectedWalkIns: 0,
    expectedSourceActivityCount: 0,
    reason: "closing manual count",
    occurredAt: "2026-08-16T12:00:00.000Z",
  })).outcome, "applied");
  assert.equal((await persistDoorAttendanceMutation({
    database: d1,
    scope: {
      venueId: "venue-a",
      businessDate: "2026-08-16",
      eventId: "event-closed",
    },
    actorUserId: "user-a",
    deviceKeyHash: "device-hash-a",
    deviceSequence: 2,
    idempotencyKey: "closeout:shared-key",
    action: "walk_in",
    reversesIdempotencyKey: null,
    occurredAt: "2026-08-16T12:01:00.000Z",
    createdAt: "2026-08-16T12:01:00.000Z",
    canApplyNew: true,
  })).outcome, "conflict");
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM attendance_activity_ledger").get().count,
    0,
  );
  database.close();
});

test("persistence reports stale source activity baselines before closeout creation", async () => {
  const database = createDatabase();
  insertWalkIn(database);
  const result = await persistAttendanceReconciliation({
    database: asD1(database),
    scope: { venueId: "venue-a", businessDate: "2026-08-16", eventId: null },
    compatibilityEventKey: "legacy:venue-a:2026-08-16",
    actorUserId: "user-a",
    idempotencyKey: "closeout:stale",
    targetTotalAttendance: 1,
    expectedCheckedInGuests: 0,
    expectedWalkIns: 1,
    expectedSourceActivityCount: 0,
    reason: "closing manual count",
    occurredAt: "2026-08-16T12:00:00.000Z",
  });
  assert.equal(result.outcome, "stale");
  assert.equal(database.prepare("SELECT count(*) AS count FROM attendance_closeouts").get().count, 0);
  database.close();
});
