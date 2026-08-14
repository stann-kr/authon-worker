import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const eventMigration = readFileSync(
  new URL("../../migrations/0017_events_and_guest_activity_ledger.sql", import.meta.url),
  "utf8",
);
const closeoutMigration = readFileSync(
  new URL("../../migrations/0018_event_closeouts_and_templates.sql", import.meta.url),
  "utf8",
);

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (id TEXT PRIMARY KEY);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE external_dj_links (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      date TEXT
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE guest_limit_requests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL
    );
    INSERT INTO venues VALUES ('venue-a');
    INSERT INTO users VALUES ('admin-a'), ('dj-a');
  `);
  database.exec(eventMigration);
  database.exec(closeoutMigration);
  return database;
}

test("existing events gain nullable preparation timing without a data rewrite", () => {
  const database = createDatabase();
  database.prepare(`
    INSERT INTO events (
      id, venue_id, business_date, name, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "event-a",
    "venue-a",
    "2026-08-13",
    "Night",
    "closed",
    "2026-08-10T00:00:00.000Z",
    "2026-08-14T00:00:00.000Z",
  );
  assert.equal(
    database.prepare("SELECT opened_at FROM events WHERE id = 'event-a'").get().opened_at,
    null,
  );
});

test("contributor limits are event scoped and closeout confirmations are immutable", () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO events (
      id, venue_id, business_date, name, state, created_at, updated_at
    ) VALUES (
      'event-a', 'venue-a', '2026-08-13', 'Night', 'closed',
      '2026-08-10T00:00:00.000Z', '2026-08-14T00:00:00.000Z'
    );
  `);
  database.prepare(`
    INSERT INTO event_contributor_limits (
      event_id, venue_id, user_id, guest_limit, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run("event-a", "venue-a", "dj-a", 12, "2026-08-10T00:00:00.000Z");
  assert.throws(
    () => database.prepare(`
      INSERT INTO event_contributor_limits (
        event_id, venue_id, user_id, guest_limit, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run("event-a", "venue-a", "dj-a", 14, "2026-08-10T00:00:00.000Z"),
    /UNIQUE/,
  );

  database.prepare(`
    INSERT INTO event_closeouts (
      event_id, venue_id, confirmed_by_user_id, confirmed_at,
      report_hash, registered_count, checked_in_count, source_activity_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "event-a",
    "venue-a",
    "admin-a",
    "2026-08-14T00:05:00.000Z",
    "a".repeat(64),
    10,
    8,
    20,
  );
  assert.throws(
    () => database.exec("UPDATE event_closeouts SET registered_count = 11"),
    /immutable/,
  );
  assert.throws(
    () => database.exec("DELETE FROM event_closeouts"),
    /immutable/,
  );
});
