import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationSql = readFileSync(
  new URL("../../migrations/0017_events_and_guest_activity_ledger.sql", import.meta.url),
  "utf8",
);

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (id TEXT PRIMARY KEY);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE external_dj_links (id TEXT PRIMARY KEY);
    CREATE TABLE guests (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE guest_limit_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      date TEXT,
      status TEXT
    );
    INSERT INTO venues VALUES ('venue-a');
    INSERT INTO users VALUES ('user-a');
  `);
  database.exec(migrationSql);
  return database;
}

test("one business date can contain multiple independently identified events", () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO events (
      id, venue_id, business_date, name, state,
      created_by_user_id, created_at, updated_at
    ) VALUES
      ('event-a', 'venue-a', '2026-08-13', 'EARLY', 'open', 'user-a', 'now', 'now'),
      ('event-b', 'venue-a', '2026-08-13', 'LATE', 'draft', 'user-a', 'now', 'now');
  `);
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM events WHERE venue_id = ? AND business_date = ?",
    ).get("venue-a", "2026-08-13").count,
    2,
  );
  assert.throws(() =>
    database.exec(`
      INSERT INTO events (
        id, venue_id, business_date, name, state, created_at, updated_at
      ) VALUES ('bad', 'venue-a', '2026-08-13', 'BAD', 'unknown', 'now', 'now');
    `),
  );
});

test("legacy rows can link to one event without forcing an in-migration backfill", () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO events (
      id, venue_id, business_date, name, state, compatibility_key, created_at, updated_at
    ) VALUES (
      'event-a', 'venue-a', '2026-08-13', 'LEGACY', 'open',
      'legacy:venue-a:2026-08-13', 'now', 'now'
    );
    INSERT INTO guests (id, event_id) VALUES ('guest-a', 'event-a');
    INSERT INTO external_dj_links (id, event_id) VALUES ('link-a', 'event-a');
    INSERT INTO guest_limit_requests (id, event_id) VALUES ('limit-a', 'event-a');
  `);
  assert.equal(database.prepare("SELECT event_id AS eventId FROM guests").get().eventId, "event-a");
  assert.throws(() =>
    database.exec(`
      INSERT INTO events (
        id, venue_id, business_date, name, state, compatibility_key, created_at, updated_at
      ) VALUES (
        'event-b', 'venue-a', '2026-08-13', 'DUPLICATE', 'open',
        'legacy:venue-a:2026-08-13', 'now', 'now'
      );
    `),
  );
});

test("guest activity rows are append-only and contain no copied guest identity", () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO guest_activity_ledger (
      id, venue_id, guest_id, action, actor_user_id, actor_type, channel,
      request_id, idempotency_key, payload_hash, outcome,
      previous_status, next_status, occurred_at
    ) VALUES (
      'activity-a', 'venue-a', 'guest-a', 'check_in', 'user-a', 'user', 'door',
      'request-a', 'key-a', 'hash-a', 'applied', 'pending', 'checked', 'now'
    );
  `);
  assert.throws(() =>
    database.exec("UPDATE guest_activity_ledger SET outcome = 'rejected' WHERE id = 'activity-a'"),
  );
  assert.throws(() =>
    database.exec("DELETE FROM guest_activity_ledger WHERE id = 'activity-a'"),
  );

  const columns = database
    .prepare("PRAGMA table_info(guest_activity_ledger)")
    .all()
    .map((column) => String(column.name));
  for (const forbidden of ["name", "email", "instagram", "registered_by_name"]) {
    assert.equal(columns.includes(forbidden), false);
  }
});
