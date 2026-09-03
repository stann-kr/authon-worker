import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { drizzle } from "drizzle-orm/d1";

import * as schema from "../db/schema.ts";
import { loadGuestQuotaState } from "./quota-persistence.ts";

const DATE = "2026-08-23";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      active INTEGER NOT NULL
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      created_by_user_id TEXT,
      event_id TEXT,
      status TEXT NOT NULL,
      date TEXT NOT NULL
    );
    CREATE TABLE guest_limit_requests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      event_id TEXT,
      requested_extra INTEGER NOT NULL,
      approved_extra INTEGER NOT NULL,
      reason TEXT,
      status TEXT NOT NULL,
      decided_by_user_id TEXT,
      decided_at TEXT,
      decision_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE event_contributor_limits (
      event_id TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      guest_limit INTEGER,
      PRIMARY KEY (event_id, user_id)
    );
    INSERT INTO venues (id, active) VALUES ('venue-a', 1), ('venue-b', 1);
  `);
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
        async all() {
          return { results: database.prepare(statement).all(...values) };
        },
        async raw() {
          return database
            .prepare(statement)
            .all(...values)
            .map((row) => Object.values(row));
        },
        async first() {
          return database.prepare(statement).get(...values) ?? null;
        },
        async run() {
          const result = database.prepare(statement).run(...values);
          return { success: true, meta: { changes: result.changes } };
        },
      };
    },
  };
}

function insertRequest(database, {
  id,
  venueId,
  eventId = null,
  status,
  approvedExtra = 0,
}) {
  database.prepare(`
    INSERT INTO guest_limit_requests (
      id, venue_id, user_id, date, event_id, requested_extra,
      approved_extra, status, created_at, updated_at
    ) VALUES (?, ?, 'user-a', ?, ?, 10, ?, ?, ?, ?)
  `).run(id, venueId, DATE, eventId, approvedExtra, status, DATE, DATE);
}

test("quota reads exclude another venue's legacy guests, approvals, and pending request", async () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO guests (id, venue_id, created_by_user_id, event_id, status, date)
    VALUES
      ('event-guest', 'venue-a', 'user-a', 'event-a', 'pending', '${DATE}'),
      ('legacy-guest', 'venue-a', 'user-a', NULL, 'pending', '${DATE}'),
      ('other-legacy-guest', 'venue-b', 'user-a', NULL, 'pending', '${DATE}');
    INSERT INTO event_contributor_limits (event_id, venue_id, user_id, guest_limit)
    VALUES ('event-a', 'venue-a', 'user-a', 5);
  `);
  insertRequest(database, {
    id: "approved-current",
    venueId: "venue-a",
    status: "approved",
    approvedExtra: 2,
  });
  insertRequest(database, {
    id: "approved-other",
    venueId: "venue-b",
    status: "approved",
    approvedExtra: 9,
  });
  insertRequest(database, {
    id: "pending-other",
    venueId: "venue-b",
    status: "pending",
  });

  const db = drizzle(asD1(database), { schema });
  const quota = await loadGuestQuotaState(db, {
    venueId: "venue-a",
    userId: "user-a",
    date: DATE,
    eventId: "event-a",
    includeLegacyRows: true,
  });

  assert.equal(quota.used, 2);
  assert.equal(quota.approvedExtra, 2);
  assert.equal(quota.pendingRequest, null);
  assert.equal(quota.configuredLimit, 5);

  insertRequest(database, {
    id: "pending-current",
    venueId: "venue-a",
    eventId: "event-a",
    status: "pending",
  });
  const withCurrentPending = await loadGuestQuotaState(db, {
    venueId: "venue-a",
    userId: "user-a",
    date: DATE,
    eventId: "event-a",
    includeLegacyRows: true,
  });
  assert.equal(withCurrentPending.pendingRequest?.id, "pending-current");
});

test("quota reads fail closed when the venue is deactivated after access validation", async () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO guests (id, venue_id, created_by_user_id, event_id, status, date)
    VALUES ('legacy-guest', 'venue-a', 'user-a', NULL, 'pending', '${DATE}');
    UPDATE venues SET active = 0 WHERE id = 'venue-a';
  `);
  const db = drizzle(asD1(database), { schema });

  await assert.rejects(
    loadGuestQuotaState(db, {
      venueId: "venue-a",
      userId: "user-a",
      date: DATE,
      eventId: null,
      includeLegacyRows: true,
    }),
    /INACTIVE_VENUE/,
  );
});
