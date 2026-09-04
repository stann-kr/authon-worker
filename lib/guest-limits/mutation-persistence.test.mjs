import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createGuestLimitMutationPersistence } from "./persistence.ts";
import {
  INSERT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL,
  SELECT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL,
} from "./mutation-sql.ts";
import {
  createGuestLimitRequestService,
  decideGuestLimitRequestService,
} from "./service.ts";

const DATE = "2026-08-23";
const NOW = "2026-08-23T12:00:00.000Z";

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
      door_access_enabled INTEGER NOT NULL,
      venue_id TEXT REFERENCES venues(id),
      guest_limit INTEGER,
      session_version INTEGER NOT NULL,
      active INTEGER NOT NULL,
      deleted_at TEXT
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
      template_source_event_id TEXT,
      compatibility_key TEXT UNIQUE,
      created_by_user_id TEXT REFERENCES users(id),
      updated_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      opened_at TEXT,
      closed_at TEXT
    );
    CREATE TABLE event_contributor_limits (
      event_id TEXT NOT NULL REFERENCES events(id),
      venue_id TEXT NOT NULL REFERENCES venues(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      guest_limit INTEGER,
      source_event_id TEXT,
      created_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (event_id, user_id)
    );
    CREATE TABLE guest_limit_requests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      event_id TEXT REFERENCES events(id),
      requested_extra INTEGER NOT NULL,
      approved_extra INTEGER NOT NULL,
      reason TEXT,
      status TEXT NOT NULL,
      decided_by_user_id TEXT REFERENCES users(id),
      decided_at TEXT,
      decision_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX pending_event
      ON guest_limit_requests(user_id, event_id)
      WHERE status = 'pending' AND event_id IS NOT NULL;
    CREATE UNIQUE INDEX pending_legacy
      ON guest_limit_requests(user_id, date)
      WHERE status = 'pending' AND event_id IS NULL;

    INSERT INTO venues (id, active) VALUES ('venue-a', 1), ('venue-b', 1);
    INSERT INTO users (
      id, role, account_kind, door_access_enabled, venue_id, guest_limit,
      session_version, active, deleted_at
    ) VALUES
      ('staff-a', 'staff', 'personal', 0, 'venue-a', 5, 7, 1, NULL),
      ('admin-a', 'venue_admin', 'personal', 0, 'venue-a', NULL, 7, 1, NULL),
      ('super-a', 'super_admin', 'personal', 0, NULL, NULL, 7, 1, NULL);
    INSERT INTO events (
      id, venue_id, business_date, name, state, compatibility_key,
      created_by_user_id, updated_by_user_id, created_at, updated_at, opened_at
    ) VALUES
      ('event-a', 'venue-a', '${DATE}', 'Event A', 'open', NULL,
       'admin-a', 'admin-a', '${NOW}', '${NOW}', '${NOW}'),
      ('event-other', 'venue-a', '2026-08-24', 'Other', 'open', NULL,
       'admin-a', 'admin-a', '${NOW}', '${NOW}', '${NOW}');
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
      async first() {
        return database.prepare(statement).get(...values) ?? null;
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
      async run() {
        if (/\bRETURNING\b/i.test(statement) || /^\s*(?:WITH\b|SELECT\b)/i.test(statement)) {
          const results = database.prepare(statement).all(...values);
          return { success: true, results, meta: { changes: results.length } };
        }
        const result = database.prepare(statement).run(...values);
        return {
          success: true,
          results: [],
          meta: { changes: result.changes },
        };
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

function actor(id, role, venueId, guestLimit = null) {
  return {
    id,
    role,
    accountKind: "personal",
    doorAccessEnabled: false,
    venueId,
    guestLimit,
    sessionVersion: 7,
  };
}

function exactCreateInput(overrides = {}) {
  return {
    actor: actor("staff-a", "staff", "venue-a", 5),
    event: {
      kind: "exact",
      eventId: "event-a",
      venueId: "venue-a",
      businessDate: DATE,
    },
    request: {
      id: "request-new",
      requestedExtra: 2,
      reason: "More guests",
      createdAt: NOW,
    },
    ...overrides,
  };
}

function insertPendingRequest(database, id = "request-pending") {
  database.prepare(`
    INSERT INTO guest_limit_requests (
      id, venue_id, user_id, date, event_id, requested_extra, approved_extra,
      reason, status, created_at, updated_at
    ) VALUES (?, 'venue-a', 'staff-a', ?, 'event-a', 4, 0, NULL, 'pending', ?, ?)
  `).run(id, DATE, NOW, NOW);
}

function count(database, table, where = "1 = 1") {
  return database.prepare(`SELECT count(*) AS value FROM ${table} WHERE ${where}`).get().value;
}

test("guest registration snapshots the current actor limit for a new event contributor", () => {
  const database = createDatabase();
  database.prepare("UPDATE users SET guest_limit = 8 WHERE id = 'staff-a'").run();
  const currentActor = actor("staff-a", "staff", "venue-a", 5);
  const currentActorBindings = [
    currentActor.id,
    currentActor.role,
    currentActor.accountKind,
    currentActor.doorAccessEnabled ? 1 : 0,
    currentActor.venueId,
    currentActor.sessionVersion,
  ];

  const inserted = database
    .prepare(INSERT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL)
    .get(
      null,
      NOW,
      currentActor.id,
      "event-a",
      "venue-a",
      DATE,
      ...currentActorBindings,
    );

  assert.equal(inserted?.guestLimit, 8);
  const configured = database
    .prepare(SELECT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL)
    .get(
      DATE,
      "event-a",
      "venue-a",
      currentActor.id,
      ...currentActorBindings,
    );
  assert.equal(configured?.guestLimit, 8);
});

test("guarded create snapshots the current DB guest limit, including zero", async () => {
  const database = createDatabase();
  database.prepare("UPDATE users SET guest_limit = 0 WHERE id = 'staff-a'").run();
  const persistence = createGuestLimitMutationPersistence(asD1(database));

  const outcome = await persistence.createRequest(exactCreateInput());

  assert.equal(outcome.request?.id, "request-new");
  assert.equal(outcome.scopeValid, true);
  assert.equal(outcome.limitAvailable, true);
  assert.equal(
    database.prepare("SELECT guest_limit FROM event_contributor_limits").get().guest_limit,
    0,
  );
  assert.equal(count(database, "guest_limit_requests"), 1);
});

test("guarded create rejects stale actor, venue, and exact event snapshots without partial writes", async (t) => {
  const mutations = [
    ["session revoked", "UPDATE users SET session_version = 8 WHERE id = 'staff-a'"],
    ["actor inactive", "UPDATE users SET active = 0 WHERE id = 'staff-a'"],
    ["role changed", "UPDATE users SET role = 'venue_admin' WHERE id = 'staff-a'"],
    ["account changed", "UPDATE users SET account_kind = 'shared' WHERE id = 'staff-a'"],
    ["venue changed", "UPDATE users SET venue_id = 'venue-b' WHERE id = 'staff-a'"],
    ["venue inactive", "UPDATE venues SET active = 0 WHERE id = 'venue-a'"],
    ["event closed", "UPDATE events SET state = 'closed' WHERE id = 'event-a'"],
    ["event date changed", "UPDATE events SET business_date = '2026-08-24' WHERE id = 'event-a'"],
    ["event venue changed", "UPDATE events SET venue_id = 'venue-b' WHERE id = 'event-a'"],
  ];

  for (const [name, mutation] of mutations) {
    await t.test(name, async () => {
      const database = createDatabase();
      database.exec(mutation);
      const persistence = createGuestLimitMutationPersistence(asD1(database));
      const outcome = await persistence.createRequest(exactCreateInput());

      assert.equal(outcome.request, null);
      assert.equal(outcome.scopeValid, false);
      assert.equal(count(database, "event_contributor_limits"), 0);
      assert.equal(count(database, "guest_limit_requests"), 0);
    });
  }
});

test("compatibility event, contributor limit, and request commit or fail as one guarded batch", async () => {
  const target = {
    kind: "compatibility",
    proposedEventId: "compat-event",
    compatibilityKey: `compat:venue-a:${DATE}`,
    venueId: "venue-a",
    businessDate: DATE,
  };

  const successDb = createDatabase();
  const success = await createGuestLimitMutationPersistence(asD1(successDb)).createRequest(
    exactCreateInput({ event: target }),
  );
  assert.equal(success.request?.eventId, "compat-event");
  assert.equal(count(successDb, "events", "id = 'compat-event'"), 1);
  assert.equal(count(successDb, "event_contributor_limits", "event_id = 'compat-event'"), 1);
  assert.equal(count(successDb, "guest_limit_requests", "event_id = 'compat-event'"), 1);

  const revokedDb = createDatabase();
  revokedDb.prepare("UPDATE users SET session_version = 8 WHERE id = 'staff-a'").run();
  const revoked = await createGuestLimitMutationPersistence(asD1(revokedDb)).createRequest(
    exactCreateInput({ event: target }),
  );
  assert.equal(revoked.request, null);
  assert.equal(count(revokedDb, "events", "id = 'compat-event'"), 0);
  assert.equal(count(revokedDb, "event_contributor_limits"), 0);
  assert.equal(count(revokedDb, "guest_limit_requests"), 0);

  const noLimitDb = createDatabase();
  noLimitDb.prepare("UPDATE users SET guest_limit = NULL WHERE id = 'staff-a'").run();
  const noLimit = await createGuestLimitMutationPersistence(asD1(noLimitDb)).createRequest(
    exactCreateInput({
      actor: actor("staff-a", "staff", "venue-a", null),
      event: target,
    }),
  );
  assert.equal(noLimit.request, null);
  assert.equal(noLimit.limitAvailable, false);
  assert.equal(count(noLimitDb, "events", "id = 'compat-event'"), 0);
  assert.equal(count(noLimitDb, "event_contributor_limits"), 0);
  assert.equal(count(noLimitDb, "guest_limit_requests"), 0);

  const rollbackDb = createDatabase();
  insertPendingRequest(rollbackDb, "request-new");
  await assert.rejects(
    createGuestLimitMutationPersistence(asD1(rollbackDb)).createRequest(
      exactCreateInput({ event: target }),
    ),
    /UNIQUE constraint failed/,
  );
  assert.equal(count(rollbackDb, "events", "id = 'compat-event'"), 0);
  assert.equal(count(rollbackDb, "event_contributor_limits"), 0);
  assert.equal(count(rollbackDb, "guest_limit_requests"), 1);
});

test("decision CAS rejects stale request, actor, venue, and event snapshots", async (t) => {
  const mutations = [
    ["session revoked", "UPDATE users SET session_version = 8 WHERE id = 'admin-a'"],
    ["actor inactive", "UPDATE users SET active = 0 WHERE id = 'admin-a'"],
    ["role changed", "UPDATE users SET role = 'staff' WHERE id = 'admin-a'"],
    ["actor venue changed", "UPDATE users SET venue_id = 'venue-b' WHERE id = 'admin-a'"],
    ["venue inactive", "UPDATE venues SET active = 0 WHERE id = 'venue-a'"],
    ["event closed", "UPDATE events SET state = 'closed' WHERE id = 'event-a'"],
    ["event date changed", "UPDATE events SET business_date = '2026-08-24' WHERE id = 'event-a'"],
    ["request changed", "UPDATE guest_limit_requests SET requested_extra = 3 WHERE id = 'request-pending'"],
  ];

  for (const [name, mutation] of mutations) {
    await t.test(name, async () => {
      const database = createDatabase();
      insertPendingRequest(database);
      const persistence = createGuestLimitMutationPersistence(asD1(database));
      const expected = await persistence.loadRequest("request-pending");
      database.exec(mutation);

      const updated = await persistence.decideRequest({
        actor: actor("admin-a", "venue_admin", "venue-a"),
        expected,
        nextStatus: "approved",
        approvedExtra: 2,
        decisionNote: null,
        decidedAt: NOW,
      });

      assert.equal(updated, null);
      assert.equal(
        database.prepare("SELECT status FROM guest_limit_requests").get().status,
        "pending",
      );
    });
  }
});

test("services surface guarded zero-row outcomes with the existing public error codes", async () => {
  const createDb = createDatabase();
  const createPersistence = createGuestLimitMutationPersistence(asD1(createDb));
  await assert.rejects(
    createGuestLimitRequestService(
      {
        actor: actor("staff-a", "staff", "venue-a", 5),
        params: { date: DATE, eventId: "event-a", requestedExtra: 2 },
      },
      {
        persistence: {
          ...createPersistence,
          async createRequest(input) {
            createDb.prepare("UPDATE users SET session_version = 8 WHERE id = 'staff-a'").run();
            return createPersistence.createRequest(input);
          },
        },
        requireActiveVenueId: async (venueId) => venueId,
        resolveEventForRosterWrite: async () => ({
          id: "event-a",
          venueId: "venue-a",
          businessDate: DATE,
          name: "Event A",
          doorOpensAt: null,
          guestCutoffAt: null,
          capacity: null,
          targetGuests: null,
          state: "open",
          templateSourceEventId: null,
          compatibilityKey: null,
          createdByUserId: "admin-a",
          updatedByUserId: "admin-a",
          createdAt: NOW,
          updatedAt: NOW,
          openedAt: NOW,
          closedAt: null,
        }),
        findCompatibilityEvent: async () => null,
        loadEventById: async () => null,
        createId: (() => {
          const ids = ["unused-event", "request-service"];
          return () => ids.shift();
        })(),
        now: () => new Date(NOW),
      },
    ),
    (error) => error?.code === "REQUEST_FAILED",
  );
  assert.equal(count(createDb, "event_contributor_limits"), 0);
  assert.equal(count(createDb, "guest_limit_requests"), 0);

  const initialNullLimitDb = createDatabase();
  let initialNullLimitWriteCalled = false;
  await assert.rejects(
    createGuestLimitRequestService(
      {
        actor: actor("staff-a", "staff", "venue-a", null),
        params: { date: DATE, requestedExtra: 2 },
      },
      {
        persistence: {
          ...createGuestLimitMutationPersistence(asD1(initialNullLimitDb)),
          async createRequest() {
            initialNullLimitWriteCalled = true;
            throw new Error("unexpected persistence write");
          },
        },
        requireActiveVenueId: async (venueId) => venueId,
        resolveEventForRosterWrite: async () => {
          throw new Error("unexpected explicit event resolution");
        },
        findCompatibilityEvent: async () => null,
        loadEventById: async () => null,
        createId: (() => {
          const ids = ["compatibility-event", "request-stale-null"];
          return () => ids.shift();
        })(),
        now: () => new Date(NOW),
      },
    ),
    (error) => error?.code === "REQUEST_NOT_ALLOWED",
  );
  assert.equal(initialNullLimitWriteCalled, false);
  assert.equal(count(initialNullLimitDb, "events"), 2);
  assert.equal(count(initialNullLimitDb, "event_contributor_limits"), 0);
  assert.equal(count(initialNullLimitDb, "guest_limit_requests"), 0);

  const staleNullLimitDb = createDatabase();
  const staleNullLimitPersistence = createGuestLimitMutationPersistence(
    asD1(staleNullLimitDb),
  );
  await assert.rejects(
    createGuestLimitRequestService(
      {
        actor: actor("staff-a", "staff", "venue-a", 5),
        params: { date: DATE, requestedExtra: 2 },
      },
      {
        persistence: {
          ...staleNullLimitPersistence,
          async createRequest(input) {
            staleNullLimitDb
              .prepare("UPDATE users SET guest_limit = NULL WHERE id = 'staff-a'")
              .run();
            return staleNullLimitPersistence.createRequest(input);
          },
        },
        requireActiveVenueId: async (venueId) => venueId,
        resolveEventForRosterWrite: async () => {
          throw new Error("unexpected explicit event resolution");
        },
        findCompatibilityEvent: async () => null,
        loadEventById: async () => null,
        createId: (() => {
          const ids = ["compatibility-event", "request-stale-limit"];
          return () => ids.shift();
        })(),
        now: () => new Date(NOW),
      },
    ),
    (error) => error?.code === "REQUEST_FAILED",
  );
  assert.equal(count(staleNullLimitDb, "events"), 2);
  assert.equal(count(staleNullLimitDb, "event_contributor_limits"), 0);
  assert.equal(count(staleNullLimitDb, "guest_limit_requests"), 0);

  const decideDb = createDatabase();
  insertPendingRequest(decideDb);
  const decidePersistence = createGuestLimitMutationPersistence(asD1(decideDb));
  await assert.rejects(
    decideGuestLimitRequestService(
      {
        actor: actor("admin-a", "venue_admin", "venue-a"),
        params: {
          requestId: "request-pending",
          decision: "approve",
          approvedExtra: 2,
        },
      },
      {
        persistence: {
          ...decidePersistence,
          async decideRequest(input) {
            decideDb.prepare("UPDATE venues SET active = 0 WHERE id = 'venue-a'").run();
            return decidePersistence.decideRequest(input);
          },
        },
        requireActiveVenueId: async (venueId) => venueId,
        loadEventById: async () => ({
          id: "event-a",
          venueId: "venue-a",
          businessDate: DATE,
          state: "open",
        }),
        now: () => new Date(NOW),
      },
    ),
    (error) => error?.code === "REQUEST_ALREADY_DECIDED",
  );
  assert.equal(
    decideDb.prepare("SELECT status FROM guest_limit_requests").get().status,
    "pending",
  );
});
