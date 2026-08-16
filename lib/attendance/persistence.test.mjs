import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  hashAttendancePayload,
  hashAttendanceReconciliationPayload,
  INSERT_ATTENDANCE_RECONCILIATION_SQL,
  INSERT_REVERSAL_ATTENDANCE_SQL,
  INSERT_WALK_IN_ATTENDANCE_SQL,
} from "./persistence.ts";

const migration = await readFile(
  new URL("../../migrations/0022_attendance_activity_ledger.sql", import.meta.url),
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
      compatibility_key TEXT
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY NOT NULL,
      venue_id TEXT NOT NULL,
      date TEXT NOT NULL,
      event_id TEXT,
      status TEXT NOT NULL
    );
    INSERT INTO venues VALUES ('venue-a');
    INSERT INTO users VALUES ('user-a');
    INSERT INTO events VALUES ('event-a', 'venue-a', '2026-08-16', NULL);
    INSERT INTO events VALUES (
      'compat-event',
      'venue-a',
      '2026-08-16',
      'legacy:venue-a:2026-08-16'
    );
  `);
  database.exec(migration);
  return database;
}

function reconcileAttendance(database, {
  id = "reconciliation-a",
  eventId = null,
  compatibilityEventKey = "legacy:venue-a:2026-08-16",
  targetTotalAttendance,
  expectedCheckedInGuests,
  expectedWalkIns,
}) {
  return database.prepare(INSERT_ATTENDANCE_RECONCILIATION_SQL).get(
    "venue-a",
    "2026-08-16",
    eventId,
    eventId,
    eventId,
    compatibilityEventKey,
    "venue-a",
    "2026-08-16",
    eventId,
    targetTotalAttendance,
    id,
    "venue-a",
    "2026-08-16",
    eventId,
    "closing manual count",
    "user-a",
    `request:${id}`,
    `admin-reconciliation:${id}`,
    `hash:${id}`,
    "2026-08-16T12:00:00.000Z",
    "2026-08-16T12:00:00.000Z",
    expectedCheckedInGuests,
    expectedWalkIns,
    targetTotalAttendance,
  );
}

function insertWalkIn(
  database,
  id = "walk-in-a",
  idempotencyKey = "attendance:device-a:1",
  deviceKeyHash = "device-hash-a",
  deviceSequence = 1,
) {
  return database.prepare(INSERT_WALK_IN_ATTENDANCE_SQL).get(
    id,
    "venue-a",
    "2026-08-16",
    null,
    "user-a",
    `request:${id}`,
    idempotencyKey,
    `hash:${id}`,
    deviceKeyHash,
    deviceSequence,
    "2026-08-16T12:00:00.000Z",
    "2026-08-16T12:00:01.000Z",
  );
}

test("walk-in and reversal statements append once and keep the count non-negative", () => {
  const database = createDatabase();
  assert.deepEqual({ ...insertWalkIn(database) }, { id: "walk-in-a" });
  assert.equal(insertWalkIn(database, "duplicate"), undefined);
  const reversal = database.prepare(INSERT_REVERSAL_ATTENDANCE_SQL).get(
    "reversal-a",
    "user-a",
    "request:reversal-a",
    "attendance:device-a:2",
    "hash:reversal-a",
    "device-hash-a",
    2,
    "2026-08-16T12:01:00.000Z",
    "2026-08-16T12:01:01.000Z",
    "venue-a",
    "2026-08-16",
    null,
    "attendance:device-a:1",
    "user-a",
    "device-hash-a",
  );
  assert.deepEqual({ ...reversal }, { id: "reversal-a" });
  const secondReversal = database.prepare(INSERT_REVERSAL_ATTENDANCE_SQL).get(
    "reversal-b",
    "user-a",
    "request:reversal-b",
    "attendance:device-a:3",
    "hash:reversal-b",
    "device-hash-a",
    3,
    "2026-08-16T12:02:00.000Z",
    "2026-08-16T12:02:01.000Z",
    "venue-a",
    "2026-08-16",
    null,
    "attendance:device-a:1",
    "user-a",
    "device-hash-a",
  );
  assert.equal(secondReversal, undefined);
  const total = database
    .prepare("SELECT sum(delta) AS total FROM attendance_activity_ledger")
    .get();
  assert.equal(total.total, 0);
  database.close();
});

test("two devices can append 100 entries each without losing totals", () => {
  const database = createDatabase();
  for (const device of ["a", "b"]) {
    for (let sequence = 1; sequence <= 100; sequence += 1) {
      const id = `walk-in-${device}-${sequence}`;
      const inserted = insertWalkIn(
        database,
        id,
        `attendance:device-${device}:${sequence}`,
        `device-hash-${device}`,
        sequence,
      );
      assert.deepEqual({ ...inserted }, { id });
    }
  }
  const total = database
    .prepare("SELECT sum(delta) AS total FROM attendance_activity_ledger")
    .get();
  assert.equal(total.total, 200);
  database.close();
});

test("manual reconciliation applies an absolute total and rejects stale counts", () => {
  const database = createDatabase();
  database.exec(
    "INSERT INTO guests VALUES ('guest-a', 'venue-a', '2026-08-16', NULL, 'checked')",
  );
  insertWalkIn(database);
  const applied = reconcileAttendance(database, {
    targetTotalAttendance: 4,
    expectedCheckedInGuests: 1,
    expectedWalkIns: 1,
  });
  assert.deepEqual({ ...applied }, { id: "reconciliation-a" });
  assert.equal(
    database.prepare(
      "SELECT sum(delta) AS total FROM attendance_activity_ledger",
    ).get().total,
    3,
  );
  const stale = reconcileAttendance(database, {
    id: "reconciliation-stale",
    targetTotalAttendance: 5,
    expectedCheckedInGuests: 1,
    expectedWalkIns: 1,
  });
  assert.equal(stale, undefined);
  database.close();
});

test("general-scope reconciliation includes compatibility Event guests", () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO guests VALUES
      ('guest-general', 'venue-a', '2026-08-16', NULL, 'checked'),
      ('guest-compat', 'venue-a', '2026-08-16', 'compat-event', 'checked'),
      ('guest-other-event', 'venue-a', '2026-08-16', 'event-a', 'checked');
  `);
  const applied = reconcileAttendance(database, {
    targetTotalAttendance: 3,
    expectedCheckedInGuests: 2,
    expectedWalkIns: 0,
  });
  assert.deepEqual({ ...applied }, { id: "reconciliation-a" });
  database.close();
});

test("general-scope reconciliation detects a newly created compatibility Event", () => {
  const database = createDatabase();
  database.exec(`
    DELETE FROM events WHERE id = 'compat-event';
    INSERT INTO events VALUES (
      'compat-late',
      'venue-a',
      '2026-08-16',
      'legacy:venue-a:2026-08-16'
    );
    INSERT INTO guests VALUES
      ('guest-compat-late', 'venue-a', '2026-08-16', 'compat-late', 'checked');
  `);
  const stale = reconcileAttendance(database, {
    targetTotalAttendance: 1,
    expectedCheckedInGuests: 0,
    expectedWalkIns: 0,
  });
  assert.equal(stale, undefined);
  database.close();
});

test("manual reconciliation idempotency hashes the requested baseline", async () => {
  const base = {
    scope: {
      venueId: "venue-a",
      businessDate: "2026-08-16",
      eventId: null,
    },
    targetTotalAttendance: 12,
    expectedCheckedInGuests: 7,
    expectedWalkIns: 3,
    reason: "closing manual count",
    actorUserId: "user-a",
  };
  const first = await hashAttendanceReconciliationPayload(base);
  const retry = await hashAttendanceReconciliationPayload(base);
  assert.equal(first, retry);
  assert.notEqual(
    first,
    await hashAttendanceReconciliationPayload({
      ...base,
      expectedWalkIns: 4,
    }),
  );

  const walkInFirst = await hashAttendancePayload({
    scope: base.scope,
    action: "walk_in",
    delta: 1,
    actorUserId: base.actorUserId,
    deviceSequence: 1,
    occurredAt: "2026-08-16T12:00:00.000Z",
  });
  const walkInLater = await hashAttendancePayload({
    scope: base.scope,
    action: "walk_in",
    delta: 1,
    actorUserId: base.actorUserId,
    deviceSequence: 1,
    occurredAt: "2026-08-16T12:01:00.000Z",
  });
  assert.notEqual(walkInFirst, walkInLater);
});
