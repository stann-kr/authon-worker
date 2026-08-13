import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  handleTerminalGuestSyncPayload,
  parseTerminalGuestSyncPayload,
  persistTerminalGuestSync,
} from "./terminal-guest-sync.ts";

const RECEIVED_AT = "2026-08-13T03:30:00.000Z";
const migrationSql = readFileSync(
  new URL("../../migrations/0016_terminal_guest_sync_idempotency.sql", import.meta.url),
  "utf8",
);
const eventMigrationSql = readFileSync(
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
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      active INTEGER NOT NULL
    );
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE external_dj_links (id TEXT PRIMARY KEY);
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      name TEXT NOT NULL,
      email TEXT,
      instagram TEXT,
      terminal_request_id TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE guest_limit_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      date TEXT,
      status TEXT
    );
    INSERT INTO venues VALUES ('venue-a', 1), ('venue-b', 1);
    INSERT INTO guests VALUES (
      'legacy-a', 'venue-a', 'LEGACY A', NULL, NULL, 'legacy-duplicate',
      'terminal', 'pending', '2026-08-13', '${RECEIVED_AT}', '${RECEIVED_AT}'
    );
    INSERT INTO guests VALUES (
      'legacy-b', 'venue-a', 'LEGACY B', NULL, NULL, 'legacy-duplicate',
      'terminal', 'pending', '2026-08-13', '${RECEIVED_AT}', '${RECEIVED_AT}'
    );
  `);
  database.exec(migrationSql);
  database.exec(eventMigrationSql);
  return database;
}

function validPayload(overrides = {}) {
  return {
    name: "  Guest One  ",
    email: " guest@example.com ",
    instagram: " @guest ",
    terminalRequestId: " request-1 ",
    date: "2026-08-13",
    ...overrides,
  };
}

test("terminal sync requires and normalizes a bounded idempotency key", async () => {
  const db = new SqliteD1Database(createDatabase());
  assert.equal(
    parseTerminalGuestSyncPayload(validPayload({ terminalRequestId: undefined })),
    null,
  );
  assert.equal(
    parseTerminalGuestSyncPayload(validPayload({ terminalRequestId: " ".repeat(129) })),
    null,
  );

  assert.deepEqual(parseTerminalGuestSyncPayload(validPayload()), {
    name: "Guest One",
    email: "guest@example.com",
    instagram: "@guest",
    terminalRequestId: "request-1",
    date: "2026-08-13",
    createdAt: null,
  });
  assert.deepEqual(
    await handleTerminalGuestSyncPayload(db, {
      venueId: "venue-a",
      rawPayload: validPayload({ terminalRequestId: undefined }),
      receivedAt: RECEIVED_AT,
    }),
    {
      status: 400,
      body: { ok: false, error: "Invalid request payload" },
    },
  );
});

test("the additive claim migration tolerates historical duplicate terminal request ids", () => {
  const database = createDatabase();
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM guests WHERE terminal_request_id = 'legacy-duplicate'",
    ).get().count,
    2,
  );
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'terminal_guest_sync_requests'",
    ).get().count,
    1,
  );
});

test("ten concurrent replays create one guest and return the same result", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database, createBarrier(10));
  const payload = parseTerminalGuestSyncPayload(validPayload());
  assert.ok(payload);

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      persistTerminalGuestSync(db, {
        venueId: "venue-a",
        payload,
        receivedAt: `2026-08-13T03:30:0${index}.000Z`,
      }),
    ),
  );

  const guestIds = new Set(results.map((result) => result.guestId));
  assert.equal(guestIds.size, 1);
  assert.equal(results.filter((result) => result.outcome === "created").length, 1);
  assert.equal(results.filter((result) => result.outcome === "replayed").length, 9);
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM guests WHERE terminal_request_id = 'request-1'",
    ).get().count,
    1,
  );
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM terminal_guest_sync_requests WHERE request_id = 'request-1'",
    ).get().count,
    1,
  );
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM guest_activity_ledger WHERE actor_type = 'terminal' AND action = 'add'",
    ).get().count,
    1,
  );
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM guests WHERE terminal_request_id = 'request-1' AND event_id IS NOT NULL",
    ).get().count,
    1,
  );
});

test("the same key with a different normalized payload is a conflict", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  const first = await handleTerminalGuestSyncPayload(db, {
    venueId: "venue-a",
    rawPayload: validPayload(),
    receivedAt: RECEIVED_AT,
  });
  const replay = await handleTerminalGuestSyncPayload(db, {
    venueId: "venue-a",
    rawPayload: validPayload(),
    receivedAt: "2026-08-13T03:30:30.000Z",
  });
  const conflict = await handleTerminalGuestSyncPayload(db, {
    venueId: "venue-a",
    rawPayload: validPayload({ name: "Guest Two" }),
    receivedAt: "2026-08-13T03:31:00.000Z",
  });

  assert.equal(first.status, 200);
  assert.deepEqual(replay, first);
  assert.deepEqual(conflict, {
    status: 409,
    body: { ok: false, error: "Idempotency key already used with a different payload" },
  });
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM guests WHERE terminal_request_id = 'request-1'",
    ).get().count,
    1,
  );
});

test("an inactive venue cannot claim an idempotency key or create a guest", async () => {
  const database = createDatabase();
  database.exec("UPDATE venues SET active = 0 WHERE id = 'venue-a'");
  const db = new SqliteD1Database(database);

  assert.deepEqual(
    await handleTerminalGuestSyncPayload(db, {
      venueId: "venue-a",
      rawPayload: validPayload(),
      receivedAt: RECEIVED_AT,
    }),
    {
      status: 503,
      body: { ok: false, error: "Endpoint not available" },
    },
  );
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM terminal_guest_sync_requests").get().count,
    0,
  );
});
