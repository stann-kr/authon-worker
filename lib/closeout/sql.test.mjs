import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { CONFIRM_EVENT_CLOSEOUT_SQL } from "./sql.ts";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE event_closeouts (
      event_id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      confirmed_by_user_id TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      report_hash TEXT NOT NULL,
      registered_count INTEGER NOT NULL,
      checked_in_count INTEGER NOT NULL,
      source_activity_count INTEGER NOT NULL
    );
    INSERT INTO events VALUES
      ('closed-a', 'venue-a', 'closed'),
      ('open-a', 'venue-a', 'open'),
      ('closed-b', 'venue-b', 'closed');
  `);
  return database;
}

function bind(statement, eventId, venueId) {
  return statement.get(
    eventId,
    venueId,
    "admin-a",
    "2026-08-14T03:05:00.000Z",
    "a".repeat(64),
    10,
    8,
    20,
    eventId,
    venueId,
  );
}

test("closeout confirmation is a one-winner CAS for an exact closed event", () => {
  const database = createDatabase();
  const confirm = database.prepare(CONFIRM_EVENT_CLOSEOUT_SQL);
  assert.equal(bind(confirm, "closed-a", "venue-a").eventId, "closed-a");
  assert.equal(bind(confirm, "closed-a", "venue-a"), undefined);
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM event_closeouts").get().count,
    1,
  );
});

test("open and cross-venue events cannot be confirmed", () => {
  const database = createDatabase();
  const confirm = database.prepare(CONFIRM_EVENT_CLOSEOUT_SQL);
  assert.equal(bind(confirm, "open-a", "venue-a"), undefined);
  assert.equal(bind(confirm, "closed-b", "venue-a"), undefined);
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM event_closeouts").get().count,
    0,
  );
});
