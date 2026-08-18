import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = await readFile(
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
      business_date TEXT NOT NULL
      ,compatibility_key TEXT
      ,state TEXT NOT NULL
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY NOT NULL,
      venue_id TEXT NOT NULL,
      date TEXT NOT NULL,
      event_id TEXT,
      status TEXT NOT NULL,
      check_in_time TEXT
    );
  `);
  database.exec(migration);
  database.exec(`
    INSERT INTO venues VALUES ('venue-a');
    INSERT INTO users VALUES ('user-a');
    INSERT INTO events VALUES ('event-a', 'venue-a', '2026-08-16', NULL, 'closed');
  `);
  database.exec(closeoutMigration);
  return database;
}

function insertWalkIn(database, overrides = {}) {
  const row = {
    id: "activity-a",
    venueId: "venue-a",
    businessDate: "2026-08-16",
    eventId: null,
    action: "walk_in",
    delta: 1,
    reversesActivityId: null,
    adjustmentReason: null,
    actorUserId: "user-a",
    channel: "door",
    requestId: "request-a",
    idempotencyKey: "attendance:device-a:1",
    payloadHash: "hash-a",
    deviceKeyHash: "device-hash",
    deviceSequence: 1,
    occurredAt: "2026-08-16T12:00:00.000Z",
    createdAt: "2026-08-16T12:00:00.000Z",
    ...overrides,
  };
  database.prepare(`
    INSERT INTO attendance_activity_ledger (
      id, venue_id, business_date, event_id, action, delta,
      reverses_activity_id, adjustment_reason, actor_user_id, channel,
      request_id, idempotency_key, payload_hash, device_key_hash,
      device_sequence, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...Object.values(row));
}

test("attendance migration creates scoped indexes and immutable triggers", () => {
  const database = createDatabase();
  const indexes = database.prepare("PRAGMA index_list(attendance_activity_ledger)").all();
  assert.equal(
    indexes.some((index) => index.name === "idx_attendance_activity_venue_idempotency" && index.unique === 1),
    true,
  );
  assert.equal(
    indexes.some((index) => index.name === "idx_attendance_activity_reversal_once" && index.unique === 1),
    true,
  );
  assert.equal(
    indexes.some((index) => index.name === "idx_attendance_activity_device_sequence" && index.unique === 1),
    true,
  );
  insertWalkIn(database);
  assert.throws(
    () => database.exec("UPDATE attendance_activity_ledger SET delta = 2 WHERE id = 'activity-a'"),
    /immutable/,
  );
  assert.throws(
    () => database.exec("DELETE FROM attendance_activity_ledger WHERE id = 'activity-a'"),
    /immutable/,
  );
  database.close();
});

test("attendance migration rejects duplicate requests, duplicate reversals, and malformed actions", () => {
  const database = createDatabase();
  insertWalkIn(database);
  assert.throws(
    () => insertWalkIn(database, { id: "activity-b" }),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO attendance_activity_ledger (
        id, venue_id, business_date, event_id, action, delta,
        reverses_activity_id, adjustment_reason, actor_user_id, channel,
        request_id, idempotency_key, payload_hash, device_key_hash,
        device_sequence, occurred_at, created_at
      ) VALUES (
        'wrong-device-reversal', 'venue-a', '2026-08-16', NULL,
        'reversal', -1, 'activity-a', NULL, 'user-a', 'door',
        'request-wrong-device', 'attendance:device-b:1',
        'hash-wrong-device', 'different-device-hash',
        1,
        '2026-08-16T12:00:30.000Z', '2026-08-16T12:00:30.000Z'
      )
    `).run(),
    /reversal target is invalid/,
  );
  const reversal = database.prepare(`
    INSERT INTO attendance_activity_ledger (
      id, venue_id, business_date, event_id, action, delta,
      reverses_activity_id, adjustment_reason, actor_user_id, channel,
      request_id, idempotency_key, payload_hash, device_key_hash,
      device_sequence, occurred_at, created_at
    ) VALUES (?, 'venue-a', '2026-08-16', NULL, 'reversal', -1,
      'activity-a', NULL, 'user-a', 'door', ?, ?, ?, 'device-hash', ?, ?, ?)
  `);
  reversal.run(
    "reversal-a",
    "request-reversal-a",
    "attendance:device-a:2",
    "hash-reversal-a",
    2,
    "2026-08-16T12:01:00.000Z",
    "2026-08-16T12:01:00.000Z",
  );
  insertWalkIn(database, {
    id: "activity-b",
    requestId: "request-b",
    idempotencyKey: "attendance:device-a:3",
    payloadHash: "hash-b",
    deviceSequence: 3,
    occurredAt: "2026-08-16T12:01:30.000Z",
    createdAt: "2026-08-16T12:01:30.000Z",
  });
  assert.throws(
    () => reversal.run(
      "reversal-b",
      "request-reversal-b",
      "attendance:device-a:4",
      "hash-reversal-b",
      4,
      "2026-08-16T12:02:00.000Z",
      "2026-08-16T12:02:00.000Z",
    ),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => insertWalkIn(database, {
      id: "malformed",
      idempotencyKey: "attendance:device-a:5",
      deviceSequence: 5,
      action: "walk_in",
      delta: 2,
    }),
    /CHECK constraint failed/,
  );
  database.close();
});

test("attendance migration rejects invalid Event scopes and negative totals", () => {
  const database = createDatabase();
  assert.throws(
    () => insertWalkIn(database, {
      eventId: "event-a",
      businessDate: "2026-08-17",
    }),
    /event scope is invalid/,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO attendance_activity_ledger (
        id, venue_id, business_date, event_id, action, delta,
        reverses_activity_id, adjustment_reason, actor_user_id, channel,
        request_id, idempotency_key, payload_hash, device_key_hash,
        device_sequence, occurred_at, created_at
      ) VALUES (
        'negative-adjustment', 'venue-a', '2026-08-16', NULL,
        'manual_adjustment', -1, NULL, 'overcount correction', 'user-a',
        'admin', 'request-negative', 'admin-adjustment:negative',
        'hash-negative', NULL, NULL, '2026-08-16T12:00:00.000Z',
        '2026-08-16T12:00:00.000Z'
      )
    `).run(),
    /attendance total cannot be negative/,
  );
  database.close();
});

test("attendance closeout schema uses exact partial scopes and freezes guest check-in changes", () => {
  const database = createDatabase();
  const indexes = database.prepare("PRAGMA index_list(attendance_closeouts)").all();
  assert.equal(indexes.some((index) => index.name === "idx_attendance_closeouts_named_scope" && index.unique === 1), true);
  assert.equal(indexes.some((index) => index.name === "idx_attendance_closeouts_general_scope" && index.unique === 1), true);
  database.exec(`
    INSERT INTO guests VALUES ('guest-a', 'venue-a', '2026-08-16', NULL, 'pending', NULL);
    INSERT INTO attendance_closeouts (
      id, venue_id, business_date, event_id,
      target_total_attendance, checked_in_guests, pre_adjustment_walk_ins,
      final_walk_ins, adjustment_delta, source_activity_count,
      adjustment_activity_id, adjustment_reason, actor_user_id, request_id,
      idempotency_key, payload_hash, report_hash, finalized_at, created_at
    ) VALUES (
      'closeout-a', 'venue-a', '2026-08-16', NULL,
      0, 0, 0, 0, 0, 0,
      NULL, 'manual count', 'user-a', 'request-closeout',
      'closeout-key', 'payload-closeout', 'report-closeout',
      '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z'
    );
  `);
  assert.throws(
    () => database.exec("UPDATE guests SET status = 'checked', check_in_time = '2026-08-16T12:01:00.000Z' WHERE id = 'guest-a'"),
    /scope is closed/,
  );
  database.exec("UPDATE guests SET status = 'deleted' WHERE id = 'guest-a'");
  database.close();
});

test("attendance closeout freezes checked guests across source and destination scopes", () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO events VALUES (
      'event-open', 'venue-a', '2026-08-16', NULL, 'open'
    );
    INSERT INTO guests VALUES (
      'guest-source', 'venue-a', '2026-08-16', 'event-a',
      'checked', '2026-08-16T11:00:00.000Z'
    );
    INSERT INTO guests VALUES (
      'guest-destination', 'venue-a', '2026-08-16', 'event-open',
      'checked', '2026-08-16T11:00:00.000Z'
    );
    INSERT INTO attendance_closeouts (
      id, venue_id, business_date, event_id,
      target_total_attendance, checked_in_guests, pre_adjustment_walk_ins,
      final_walk_ins, adjustment_delta, source_activity_count,
      adjustment_activity_id, adjustment_reason, actor_user_id, request_id,
      idempotency_key, payload_hash, report_hash, finalized_at, created_at
    ) VALUES (
      'closeout-event-a', 'venue-a', '2026-08-16', 'event-a',
      1, 1, 0, 0, 0, 0,
      NULL, 'manual count', 'user-a', 'request-event-a',
      'closeout-event-a-key', 'payload-event-a', 'report-event-a',
      '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z'
    );
  `);
  assert.throws(
    () => database.exec(
      "UPDATE guests SET event_id = 'event-open' WHERE id = 'guest-source'",
    ),
    /scope is closed/,
  );
  assert.throws(
    () => database.exec(
      "UPDATE guests SET event_id = 'event-a' WHERE id = 'guest-destination'",
    ),
    /scope is closed/,
  );
  assert.throws(
    () => database.exec(`
      INSERT INTO guests VALUES (
        'guest-insert', 'venue-a', '2026-08-16', 'event-a',
        'checked', '2026-08-16T12:01:00.000Z'
      )
    `),
    /scope is closed/,
  );
  database.close();
});
