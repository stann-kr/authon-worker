import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  hashAttendancePayload,
  INSERT_ATTENDANCE_ADJUSTMENT_SQL,
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
      business_date TEXT NOT NULL
    );
    INSERT INTO venues VALUES ('venue-a');
    INSERT INTO users VALUES ('user-a');
    INSERT INTO events VALUES ('event-a', 'venue-a', '2026-08-16');
  `);
  database.exec(migration);
  return database;
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

test("manual adjustment statement rejects a negative net total atomically", () => {
  const database = createDatabase();
  const statement = database.prepare(INSERT_ATTENDANCE_ADJUSTMENT_SQL);
  const rejected = statement.get(
    "adjustment-a",
    "venue-a",
    "2026-08-16",
    null,
    -1,
    "correct overcount",
    "user-a",
    "request:adjustment-a",
    "admin-adjustment:a",
    "hash:adjustment-a",
    "2026-08-16T12:00:00.000Z",
    "2026-08-16T12:00:00.000Z",
    -1,
    "venue-a",
    "2026-08-16",
    null,
  );
  assert.equal(rejected, undefined);
  insertWalkIn(database);
  const applied = statement.get(
    "adjustment-b",
    "venue-a",
    "2026-08-16",
    null,
    -1,
    "correct overcount",
    "user-a",
    "request:adjustment-b",
    "admin-adjustment:b",
    "hash:adjustment-b",
    "2026-08-16T12:02:00.000Z",
    "2026-08-16T12:02:00.000Z",
    -1,
    "venue-a",
    "2026-08-16",
    null,
  );
  assert.deepEqual({ ...applied }, { id: "adjustment-b" });
  database.close();
});

test("manual adjustment idempotency ignores server-generated occurrence time", async () => {
  const base = {
    scope: {
      venueId: "venue-a",
      businessDate: "2026-08-16",
      eventId: null,
    },
    action: "manual_adjustment",
    delta: 2,
    reason: "missed entries",
    actorUserId: "user-a",
  };
  const first = await hashAttendancePayload({
    ...base,
    occurredAt: "2026-08-16T12:00:00.000Z",
  });
  const retry = await hashAttendancePayload({
    ...base,
    occurredAt: "2026-08-16T12:01:00.000Z",
  });
  assert.equal(first, retry);

  const walkInFirst = await hashAttendancePayload({
    ...base,
    action: "walk_in",
    delta: 1,
    reason: null,
    occurredAt: "2026-08-16T12:00:00.000Z",
  });
  const walkInLater = await hashAttendancePayload({
    ...base,
    action: "walk_in",
    delta: 1,
    reason: null,
    occurredAt: "2026-08-16T12:01:00.000Z",
  });
  assert.notEqual(walkInFirst, walkInLater);
});
