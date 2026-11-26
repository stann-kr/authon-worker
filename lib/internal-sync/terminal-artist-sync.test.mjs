import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  getTerminalArtistLinkId,
  handleTerminalGuestSyncPayload,
  parseTerminalGuestSyncPayload,
} from "./terminal-guest-sync.ts";

const RECEIVED_AT = "2026-11-26T03:30:00.000Z";
const DATE = "2026-11-28";
const migrationsDir = new URL("../../migrations/", import.meta.url);

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

  async all() {
    return {
      results: this.database.prepare(this.sql).all(...this.args).map((row) => ({ ...row })),
    };
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

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
  }
  database.exec(`
    INSERT INTO venues (id, name, type, active) VALUES
      ('venue-a', 'FAUST', 'club', 1),
      ('venue-b', 'OTHER', 'club', 1);
  `);
  return database;
}

function addEvent(database, { id = "event-a", venueId = "venue-a", date = DATE, state = "open", compatibilityKey = null } = {}) {
  database
    .prepare(`INSERT INTO events (id, venue_id, business_date, name, state, compatibility_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, venueId, date, `TERMINAL ${id}`, state, compatibilityKey, RECEIVED_AT, RECEIVED_AT);
}

function payload(overrides = {}) {
  return {
    name: "Guest One",
    email: null,
    instagram: "guest.one",
    terminalRequestId: "req_1",
    date: DATE,
    createdAt: RECEIVED_AT,
    artistName: "Dj Alpha",
    guestLimit: 5,
    ...overrides,
  };
}

function sync(db, rawPayload, venueId = "venue-a") {
  return handleTerminalGuestSyncPayload(db, { venueId, rawPayload, receivedAt: RECEIVED_AT });
}

function links(database) {
  return database
    .prepare(`SELECT id, contributor_id AS contributorId, event_id AS eventId, kind, used_guests AS used,
      max_guests AS max, dj_name AS djName, created_by AS createdBy FROM external_dj_links ORDER BY id`)
    .all()
    .map((row) => ({ ...row }));
}

test("artist fields are optional, bounded and normalized", () => {
  assert.equal(parseTerminalGuestSyncPayload(payload({ artistName: undefined, guestLimit: undefined })).artistName, null);
  assert.equal(parseTerminalGuestSyncPayload(payload({ artistName: "  Dj   Alpha " })).artistName, "Dj Alpha");
  assert.equal(parseTerminalGuestSyncPayload(payload({ artistName: "" })), null);
  assert.equal(parseTerminalGuestSyncPayload(payload({ artistName: "x".repeat(101) })), null);
  assert.equal(parseTerminalGuestSyncPayload(payload({ guestLimit: 0 })), null);
  assert.equal(parseTerminalGuestSyncPayload(payload({ guestLimit: 2.5 })), null);
  assert.equal(parseTerminalGuestSyncPayload(payload({ guestLimit: "5" })), null);
});

test("without a venue event for the date nothing is written and the send can be retried", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database, { id: "legacy", compatibilityKey: `legacy:venue-a:${DATE}` });

  assert.deepEqual(await sync(db, payload()), {
    status: 503,
    body: { ok: false, error: "EVENT_NOT_READY" },
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guests").get().n, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM venue_contributors").get().n, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM terminal_guest_sync_requests").get().n, 0);

  addEvent(database);
  const retried = await sync(db, payload());
  assert.equal(retried.status, 200);
});

test("two venue events on one date are refused as ambiguous", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database, { id: "event-a" });
  addEvent(database, { id: "event-b", state: "draft" });
  assert.deepEqual(await sync(db, payload()), {
    status: 503,
    body: { ok: false, error: "EVENT_AMBIGUOUS" },
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guests").get().n, 0);
});

test("a closed event is not a target", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database, { state: "closed" });
  assert.equal((await sync(db, payload())).body.error, "EVENT_NOT_READY");
});

test("the first guest creates the artist, its link and audits; later guests share the link", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database);

  const first = await sync(db, payload());
  assert.equal(first.status, 200);
  const second = await sync(db, payload({ terminalRequestId: "req_2", name: "Guest Two", instagram: "guest.two" }));
  assert.equal(second.status, 200);

  const contributors = database.prepare("SELECT id, display_name AS name, name_key AS key FROM venue_contributors").all();
  assert.equal(contributors.length, 1);
  assert.equal(contributors[0].key, "DJ ALPHA");

  const linkId = await getTerminalArtistLinkId("venue-a", "event-a", contributors[0].id);
  assert.deepEqual(links(database), [{
    id: linkId,
    contributorId: contributors[0].id,
    eventId: "event-a",
    kind: "contributor",
    used: 2,
    max: 5,
    djName: "Dj Alpha",
    createdBy: null,
  }]);

  const guests = database
    .prepare("SELECT name, external_link_id AS linkId, event_id AS eventId, source, status, date FROM guests ORDER BY name")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(guests, [
    { name: "Guest One", linkId, eventId: "event-a", source: "terminal", status: "pending", date: DATE },
    { name: "Guest Two", linkId, eventId: "event-a", source: "terminal", status: "pending", date: DATE },
  ]);

  const audits = database
    .prepare("SELECT source_kind AS kind, action FROM contributor_audit_events ORDER BY action")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(audits, [
    { kind: "contributor", action: "created" },
    { kind: "external_link", action: "mapped" },
  ]);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guest_activity_ledger").get().n, 2);
});

test("a replay returns the first guest without counting again; a changed payload conflicts", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database);

  const first = await sync(db, payload());
  const replay = await sync(db, payload({ guestLimit: 9 }));
  assert.deepEqual(replay, first);
  assert.equal(links(database)[0].used, 1);

  assert.deepEqual(await sync(db, payload({ artistName: "Dj Beta" })), {
    status: 409,
    body: { ok: false, error: "Idempotency key already used with a different payload" },
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guests").get().n, 1);
});

test("an existing artist is matched by name key, and its venue is respected", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database);
  database.exec(`
    INSERT INTO venue_contributors (id, venue_id, display_name, name_key, kind, active, created_at, updated_at)
    VALUES ('dj-existing', 'venue-a', 'DJ ALPHA', 'DJ ALPHA', 'dj', 1, '${RECEIVED_AT}', '${RECEIVED_AT}'),
           ('dj-other-venue', 'venue-b', 'Dj Beta', 'DJ BETA', 'dj', 1, '${RECEIVED_AT}', '${RECEIVED_AT}');
  `);

  assert.equal((await sync(db, payload({ artistName: "dj alpha" }))).status, 200);
  assert.equal((await sync(db, payload({ terminalRequestId: "req_2", artistName: "Dj Beta" }))).status, 200);

  const rows = links(database);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.djName === "DJ ALPHA").contributorId, "dj-existing");
  const beta = rows.find((row) => row.djName === "Dj Beta");
  assert.notEqual(beta.contributorId, "dj-other-venue");
  assert.equal(
    database.prepare("SELECT venue_id AS venueId FROM venue_contributors WHERE id = ?").get(beta.contributorId).venueId,
    "venue-a",
  );
});

test("an artist the venue turned off, or a link deleted by the venue, keeps the guest on the event without a link", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database);
  database.exec(`
    INSERT INTO venue_contributors (id, venue_id, display_name, name_key, kind, active, created_at, updated_at)
    VALUES ('dj-off', 'venue-a', 'Dj Off', 'DJ OFF', 'dj', 0, '${RECEIVED_AT}', '${RECEIVED_AT}');
  `);
  assert.equal((await sync(db, payload({ artistName: "Dj Off" }))).status, 200);
  assert.equal(links(database).length, 0);

  assert.equal((await sync(db, payload({ terminalRequestId: "req_2", artistName: "Dj Alpha" }))).status, 200);
  database.exec(`UPDATE external_dj_links SET deleted_at = '${RECEIVED_AT}', active = 0`);
  assert.equal((await sync(db, payload({ terminalRequestId: "req_3", artistName: "Dj Alpha" }))).status, 200);
  assert.equal(links(database)[0].used, 1);

  const guests = database
    .prepare("SELECT terminal_request_id AS id, external_link_id AS linkId, event_id AS eventId FROM guests ORDER BY id")
    .all();
  assert.equal(guests[0].linkId, null);
  assert.notEqual(guests[1].linkId, null);
  assert.equal(guests[2].linkId, null);
  assert.ok(guests.every((guest) => guest.eventId === "event-a"));
});

test("capacity follows terminal: it grows past usage and never refuses a synced guest", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database);
  for (let index = 1; index <= 3; index += 1) {
    const result = await sync(db, payload({ terminalRequestId: `req_${index}`, guestLimit: 2 }));
    assert.equal(result.status, 200);
  }
  assert.deepEqual([links(database)[0].used, links(database)[0].max], [3, 3]);
  await sync(db, payload({ terminalRequestId: "req_4", guestLimit: 10 }));
  assert.deepEqual([links(database)[0].used, links(database)[0].max], [4, 10]);
});

test("concurrent first guests of one artist share one link and are each counted once", async () => {
  const database = createDatabase();
  let arrivals = 0;
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const db = new SqliteD1Database(database, async () => {
    arrivals += 1;
    if (arrivals >= 5) release();
    await Promise.race([released, new Promise((resolve) => setTimeout(resolve, 50))]);
  });
  addEvent(database);

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, index) => sync(db, payload({ terminalRequestId: `req_${index}` }))),
  );
  assert.ok(results.every((result) => result.status === 200));
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM venue_contributors").get().n, 1);
  assert.equal(links(database).length, 1);
  assert.equal(links(database)[0].used, 5);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guests WHERE external_link_id IS NOT NULL").get().n, 5);
});

test("a payload without an artist keeps the compatibility-event path", async () => {
  const database = createDatabase();
  const db = new SqliteD1Database(database);
  addEvent(database);
  const result = await sync(db, payload({ artistName: undefined, guestLimit: undefined }));
  assert.equal(result.status, 200);
  const guest = database.prepare("SELECT external_link_id AS linkId, event_id AS eventId FROM guests").get();
  assert.equal(guest.linkId, null);
  assert.notEqual(guest.eventId, "event-a");
  assert.equal(links(database).length, 0);
});
