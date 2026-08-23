import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { resolveGuardedCompatibilityEvent } from "./compatibility-persistence.ts";

const DATE = "2026-08-23";
const NOW = "2026-08-23T12:00:00.000Z";
const KEY = `legacy:venue-a:${DATE}`;

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      active INTEGER NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      account_kind TEXT NOT NULL,
      venue_id TEXT,
      session_version INTEGER NOT NULL,
      active INTEGER NOT NULL,
      deleted_at TEXT,
      door_access_enabled INTEGER NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      business_date TEXT NOT NULL,
      name TEXT NOT NULL,
      door_opens_at TEXT,
      guest_cutoff_at TEXT,
      capacity INTEGER,
      target_guests INTEGER,
      state TEXT NOT NULL,
      template_source_event_id TEXT REFERENCES events(id),
      compatibility_key TEXT UNIQUE,
      created_by_user_id TEXT REFERENCES users(id),
      updated_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      opened_at TEXT,
      closed_at TEXT
    );
    INSERT INTO venues (id, active) VALUES ('venue-a', 1), ('venue-b', 1);
    INSERT INTO users (
      id, role, account_kind, venue_id, session_version, active,
      deleted_at, door_access_enabled
    ) VALUES
      ('admin-a', 'venue_admin', 'personal', 'venue-a', 7, 1, NULL, 0),
      ('door-a', 'door_staff', 'shared', 'venue-a', 7, 1, NULL, 1),
      ('super-a', 'super_admin', 'personal', NULL, 7, 1, NULL, 0);
  `);
  return database;
}

function asD1(database) {
  function prepare(statement) {
    let values = [];
    return {
      bind(...nextValues) {
        values = nextValues;
        return this;
      },
      async run() {
        const rows = database.prepare(statement).all(...values);
        return { success: true, results: rows, meta: {} };
      },
    };
  }

  return {
    prepare,
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function guard(overrides = {}) {
  return {
    id: "admin-a",
    role: "venue_admin",
    accountKind: "personal",
    venueId: "venue-a",
    sessionVersion: 7,
    allowedRoles: ["super_admin", "venue_admin"],
    ...overrides,
  };
}

function input(actor = guard(), overrides = {}) {
  return {
    proposedId: "event-new",
    venueId: "venue-a",
    businessDate: DATE,
    compatibilityKey: KEY,
    actor,
    createdAt: NOW,
    ...overrides,
  };
}

function eventCount(database) {
  return database.prepare("SELECT count(*) AS count FROM events").get().count;
}

test("guarded compatibility creation requires the live actor and active venue snapshot", async (t) => {
  const mutations = [
    ["session revoked", "UPDATE users SET session_version = 8 WHERE id = 'admin-a'"],
    ["actor inactive", "UPDATE users SET active = 0 WHERE id = 'admin-a'"],
    ["actor deleted", "UPDATE users SET deleted_at = '2026-08-23T11:00:00.000Z' WHERE id = 'admin-a'"],
    ["role changed", "UPDATE users SET role = 'staff' WHERE id = 'admin-a'"],
    ["account changed", "UPDATE users SET account_kind = 'shared' WHERE id = 'admin-a'"],
    ["venue changed", "UPDATE users SET venue_id = 'venue-b' WHERE id = 'admin-a'"],
    ["venue inactive", "UPDATE venues SET active = 0 WHERE id = 'venue-a'"],
  ];

  for (const [name, mutation] of mutations) {
    await t.test(name, async () => {
      const database = createDatabase();
      database.exec(mutation);
      const resolved = await resolveGuardedCompatibilityEvent(
        asD1(database),
        input(),
      );
      assert.equal(resolved, null);
      assert.equal(eventCount(database), 0);
      database.close();
    });
  }
});

test("guarded compatibility creation supports fixed admin and exact door actor contracts", async () => {
  const adminDb = createDatabase();
  const adminEvent = await resolveGuardedCompatibilityEvent(
    asD1(adminDb),
    input(),
  );
  assert.equal(adminEvent?.id, "event-new");
  assert.equal(adminEvent?.createdByUserId, "admin-a");
  adminDb.close();

  const doorDb = createDatabase();
  const doorEvent = await resolveGuardedCompatibilityEvent(
    asD1(doorDb),
    input(
      guard({
        id: "door-a",
        role: "door_staff",
        accountKind: "shared",
        doorAccessEnabled: true,
        allowedRoles: ["door_staff"],
      }),
    ),
  );
  assert.equal(doorEvent?.createdByUserId, "door-a");

  const deniedDb = createDatabase();
  const denied = await resolveGuardedCompatibilityEvent(
    asD1(deniedDb),
    input(
      guard({
        id: "door-a",
        role: "door_staff",
        accountKind: "shared",
        doorAccessEnabled: false,
        allowedRoles: ["door_staff"],
      }),
    ),
  );
  assert.equal(denied, null);
  assert.equal(eventCount(deniedDb), 0);
  doorDb.close();
  deniedDb.close();
});

test("an existing compatibility event is read back only for a still-authorized actor", async () => {
  const database = createDatabase();
  database.prepare(`
    INSERT INTO events (
      id, venue_id, business_date, name, state, compatibility_key,
      created_by_user_id, updated_by_user_id, created_at, updated_at, opened_at
    ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
  `).run(
    "event-existing",
    "venue-a",
    DATE,
    DATE,
    KEY,
    "admin-a",
    "admin-a",
    NOW,
    NOW,
    NOW,
  );
  database.prepare("UPDATE users SET session_version = 8 WHERE id = ?").run("admin-a");

  const denied = await resolveGuardedCompatibilityEvent(
    asD1(database),
    input(),
  );

  assert.equal(denied, null);
  assert.equal(eventCount(database), 1);

  database.prepare("UPDATE users SET session_version = 7 WHERE id = ?").run("admin-a");
  database.prepare("UPDATE venues SET active = 0 WHERE id = ?").run("venue-a");
  const inactiveVenue = await resolveGuardedCompatibilityEvent(
    asD1(database),
    input(),
  );
  assert.equal(inactiveVenue, null);
  assert.equal(eventCount(database), 1);

  database.prepare("UPDATE venues SET active = 1 WHERE id = ?").run("venue-a");
  const resolved = await resolveGuardedCompatibilityEvent(
    asD1(database),
    input(),
  );
  assert.equal(resolved?.id, "event-existing");
  assert.equal(eventCount(database), 1);
  database.close();
});
