import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  persistGuestStatusActivity,
  prepareGuestActivityAfterChange,
} from "./activity-ledger.ts";
import { resolveOfflineDoorSyncOutcome } from "../door/offline-sync.ts";

const NOW = "2026-08-13T15:00:00.000Z";
const migrationSql = readFileSync(
  new URL("../../migrations/0017_events_and_guest_activity_ledger.sql", import.meta.url),
  "utf8",
);

class SqliteD1Statement {
  constructor(database, sql, args = []) {
    this.database = database;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new SqliteD1Statement(this.database, this.sql, args);
  }

  async first() {
    const row = this.database.prepare(this.sql).get(...this.args);
    return row ? { ...row } : null;
  }
}

class SqliteD1Database {
  constructor(database, beforeBatch = null) {
    this.database = database;
    this.beforeBatch = beforeBatch;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements) {
    if (this.beforeBatch) await this.beforeBatch();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => ({
        results: this.database
          .prepare(statement.sql)
          .all(...statement.args)
          .map((row) => ({ ...row })),
      }));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createBarrier(target) {
  let arrivals = 0;
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === target) release();
    await released;
  };
}

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (id TEXT PRIMARY KEY, active INTEGER NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE external_dj_links (id TEXT PRIMARY KEY);
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      name TEXT NOT NULL,
      external_link_id TEXT REFERENCES external_dj_links(id),
      created_by_user_id TEXT REFERENCES users(id),
      status TEXT NOT NULL,
      check_in_time TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE guest_limit_requests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      requested_extra INTEGER NOT NULL,
      approved_extra INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_guest_limit_requests_one_pending
      ON guest_limit_requests(user_id, date) WHERE status = 'pending';
    INSERT INTO venues VALUES ('venue-a', 1), ('venue-b', 1);
    INSERT INTO users VALUES ('door-a'), ('door-b');
  `);
  database.exec(migrationSql);
  database.exec(`
    INSERT INTO events (
      id, venue_id, business_date, name, state, created_at, updated_at
    ) VALUES
      ('event-open', 'venue-a', '2026-08-13', 'Open', 'open', '${NOW}', '${NOW}'),
      ('event-closed', 'venue-a', '2026-08-13', 'Closed', 'closed', '${NOW}', '${NOW}'),
      ('event-other', 'venue-b', '2026-08-13', 'Other', 'open', '${NOW}', '${NOW}');
    INSERT INTO guests (
      id, venue_id, name, created_by_user_id, status, check_in_time,
      date, created_at, updated_at, event_id
    ) VALUES
      ('guest-a', 'venue-a', 'ALICE', 'door-a', 'pending', NULL,
       '2026-08-13', '${NOW}', '${NOW}', 'event-open'),
      ('guest-closed', 'venue-a', 'BOB', 'door-a', 'pending', NULL,
       '2026-08-13', '${NOW}', '${NOW}', 'event-closed');
  `);
  return database;
}

function mutation(overrides = {}) {
  return {
    venueId: "venue-a",
    eventId: "event-open",
    businessDate: "2026-08-13",
    guestId: "guest-a",
    action: "check_in",
    actorUserId: "door-a",
    channel: "door",
    idempotencyKey: "device-a:1",
    occurredAt: NOW,
    deviceKeyHash: "device-hash",
    sessionKeyHash: "session-hash",
    ...overrides,
  };
}

test("status and immutable ledger are applied in the same transaction", async () => {
  const database = createDatabase();
  const result = await persistGuestStatusActivity(
    new SqliteD1Database(database),
    mutation(),
  );

  assert.equal(result.outcome, "applied");
  assert.deepEqual(
    { ...database.prepare("SELECT status, check_in_time AS checkInTime FROM guests WHERE id = 'guest-a'").get() },
    { status: "checked", checkInTime: NOW },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT action, previous_status AS previousStatus,
      next_status AS nextStatus, actor_user_id AS actorUserId,
      device_key_hash AS deviceKeyHash, session_key_hash AS sessionKeyHash
      FROM guest_activity_ledger`).get() },
    {
      action: "check_in",
      previousStatus: "pending",
      nextStatus: "checked",
      actorUserId: "door-a",
      deviceKeyHash: "device-hash",
      sessionKeyHash: "session-hash",
    },
  );
});

test("an identical replay returns the original result without another ledger row", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  const first = await persistGuestStatusActivity(db, mutation());
  const replay = await persistGuestStatusActivity(
    db,
    mutation({ occurredAt: "2026-08-13T15:05:00.000Z" }),
  );

  assert.equal(first.outcome, "applied");
  assert.equal(replay.outcome, "replayed");
  assert.equal(replay.activityId, first.activityId);
  assert.equal(replay.checkInTime, NOW);
  assert.equal(database.prepare("SELECT count(*) AS count FROM guest_activity_ledger").get().count, 1);
});

test("ten overlapping replays apply one status row and one activity row", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database, createBarrier(10));
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      persistGuestStatusActivity(db, mutation()),
    ),
  );

  assert.equal(results.filter((result) => result.outcome === "applied").length, 1);
  assert.equal(results.filter((result) => result.outcome === "replayed").length, 9);
  assert.equal(database.prepare("SELECT count(*) AS count FROM guest_activity_ledger").get().count, 1);
  assert.equal(database.prepare("SELECT status FROM guests WHERE id = 'guest-a'").get().status, "checked");
});

test("two offline Door devices converge when both queued the same check-in", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  const first = await persistGuestStatusActivity(db, mutation({
    idempotencyKey: "offline:device-a:1",
    deviceKeyHash: "device-a-hash",
  }));
  const second = await persistGuestStatusActivity(db, mutation({
    idempotencyKey: "offline:device-b:1",
    deviceKeyHash: "device-b-hash",
  }));
  const current = database.prepare(
    "SELECT status, check_in_time AS checkInTime FROM guests WHERE id = 'guest-a'",
  ).get();
  const resolved = resolveOfflineDoorSyncOutcome({
    idempotencyKey: "offline:device-b:1",
    guestId: "guest-a",
    persistenceOutcome: second.outcome,
    persistedStatus: second.status,
    persistedCheckInTime: second.checkInTime,
    currentStatus: current.status,
    currentCheckInTime: current.checkInTime,
    desiredStatus: "checked",
  });

  assert.equal(first.outcome, "applied");
  assert.equal(second.outcome, "rejected");
  assert.deepEqual(resolved, {
    idempotencyKey: "offline:device-b:1",
    guestId: "guest-a",
    state: "confirmed",
    resolution: "already_applied",
    status: "checked",
    checkInTime: NOW,
  });
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM guest_activity_ledger WHERE outcome = 'applied'",
    ).get().count,
    1,
  );
});

test("the same idempotency key with a different activity conflicts", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  await persistGuestStatusActivity(db, mutation());
  const conflict = await persistGuestStatusActivity(
    db,
    mutation({ action: "cancel_check_in" }),
  );

  assert.equal(conflict.outcome, "conflict");
  assert.deepEqual(
    database.prepare("SELECT outcome FROM guest_activity_ledger ORDER BY occurred_at, outcome").all().map((row) => row.outcome).sort(),
    ["applied", "conflict"],
  );
});

test("cancel and re-entry preserve a reconstructable ordered history", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  await persistGuestStatusActivity(db, mutation());
  await persistGuestStatusActivity(db, mutation({
    action: "cancel_check_in",
    idempotencyKey: "device-a:2",
    occurredAt: "2026-08-13T15:10:00.000Z",
  }));
  await persistGuestStatusActivity(db, mutation({
    action: "re_entry",
    idempotencyKey: "device-a:3",
    occurredAt: "2026-08-13T15:20:00.000Z",
  }));

  assert.deepEqual(
    database.prepare("SELECT action FROM guest_activity_ledger ORDER BY occurred_at").all().map((row) => ({ ...row })),
    [{ action: "check_in" }, { action: "cancel_check_in" }, { action: "re_entry" }],
  );
  assert.equal(database.prepare("SELECT status FROM guests WHERE id = 'guest-a'").get().status, "checked");
});

test("tenant, event state, and stale status failures leave no ledger/read-model split", async () => {
  for (const [label, overrides] of [
    ["wrong tenant", { venueId: "venue-b", eventId: "event-other", actorUserId: "door-b" }],
    ["closed event", { guestId: "guest-closed", eventId: "event-closed" }],
    ["stale status", { action: "cancel_check_in" }],
  ]) {
    const database = createDatabase();
    const result = await persistGuestStatusActivity(
      new SqliteD1Database(database),
      mutation({ idempotencyKey: `failure:${label}`, ...overrides }),
    );
    assert.equal(result.outcome, "rejected", label);
    assert.equal(database.prepare("SELECT count(*) AS count FROM guest_activity_ledger WHERE outcome = 'applied'").get().count, 0, label);
    assert.equal(database.prepare("SELECT status FROM guests WHERE id = 'guest-a'").get().status, "pending", label);
  }
});

test("ledger immutability blocks update and delete", async () => {
  const database = createDatabase();
  await persistGuestStatusActivity(new SqliteD1Database(database), mutation());
  assert.throws(
    () => database.exec("UPDATE guest_activity_ledger SET outcome = 'rejected'"),
    /immutable/,
  );
  assert.throws(
    () => database.exec("DELETE FROM guest_activity_ledger"),
    /immutable/,
  );
});

test("non-status mutations can couple add, update, delete, restore, and permanent delete activities", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  for (const [index, action] of ["add", "update", "delete", "restore", "permanent_delete"].entries()) {
    const activityId = `activity-${action}`;
    const [, activity] = await db.batch([
      db.prepare("UPDATE guests SET updated_at = ? WHERE id = ?").bind(`${NOW}:${index}`, "guest-a"),
      prepareGuestActivityAfterChange(db, {
        activityId,
        venueId: "venue-a",
        eventId: "event-open",
        guestId: "guest-a",
        action,
        actorUserId: "door-a",
        actorType: "user",
        channel: "admin",
        requestId: `request-${action}`,
        previousStatus: "pending",
        nextStatus: action === "permanent_delete" ? null : "pending",
        occurredAt: `${NOW.slice(0, -5)}${index}.000Z`,
      }),
    ]);
    assert.equal(activity.results[0].id, activityId);
  }
  assert.deepEqual(
    database.prepare("SELECT action FROM guest_activity_ledger ORDER BY request_id").all().map((row) => row.action).sort(),
    ["add", "delete", "permanent_delete", "restore", "update"],
  );
});

test("the ledger schema stores references and hashes but no guest identity copy", () => {
  const database = createDatabase();
  const columns = database
    .prepare("PRAGMA table_info(guest_activity_ledger)")
    .all()
    .map((row) => row.name);
  assert.equal(columns.includes("name"), false);
  assert.equal(columns.includes("email"), false);
  assert.equal(columns.includes("instagram"), false);
  assert.equal(columns.includes("guest_id"), true);
  assert.equal(columns.includes("device_key_hash"), true);
  assert.equal(columns.includes("session_key_hash"), true);
});
