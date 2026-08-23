import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createExternalLinkPublicPersistence } from "./public-persistence.ts";
import {
  createPublicGuestsViaExternalLink,
  createPublicSelfRsvpGuest,
  deletePublicGuestViaExternalLink,
  updatePublicGuestViaExternalLink,
  validatePublicExternalToken,
} from "./public-service.ts";

const NOW = "2026-08-20T12:00:00.000Z";
const DATE = "2026-08-21";
const OWNER_A = "a".repeat(32);
const OWNER_B = "b".repeat(32);
const OWNER_A_HASH = "a".repeat(64);
const OWNER_B_HASH = "b".repeat(64);

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
      results: this.database
        .prepare(this.sql)
        .all(...this.args)
        .map((row) => ({ ...row })),
    };
  }
}

class SqliteD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements) {
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
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      address TEXT,
      description TEXT,
      brand_name TEXT,
      brand_tagline TEXT,
      brand_description TEXT,
      brand_footer TEXT,
      timezone TEXT NOT NULL,
      opening_time TEXT NOT NULL,
      closing_time TEXT NOT NULL,
      active INTEGER NOT NULL
    );
    CREATE TABLE external_dj_links (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      token TEXT NOT NULL UNIQUE,
      dj_name TEXT NOT NULL,
      contributor_id TEXT,
      event TEXT,
      date TEXT,
      event_id TEXT,
      max_guests INTEGER NOT NULL,
      used_guests INTEGER NOT NULL,
      active INTEGER NOT NULL,
      expires_at TEXT,
      created_by TEXT,
      locale_mode TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      name TEXT NOT NULL,
      email TEXT,
      instagram TEXT,
      external_link_id TEXT REFERENCES external_dj_links(id),
      created_by_user_id TEXT,
      registered_by_name TEXT,
      terminal_request_id TEXT,
      event_id TEXT,
      source TEXT NOT NULL DEFAULT 'authon',
      status TEXT NOT NULL,
      check_in_time TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE external_guest_owners (
      guest_id TEXT PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
      external_link_id TEXT NOT NULL REFERENCES external_dj_links(id),
      owner_key_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE UNIQUE INDEX idx_public_owner_active
      ON external_guest_owners(external_link_id, owner_key_hash)
      WHERE released_at IS NULL;
    CREATE TABLE guest_activity_ledger (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      event_id TEXT,
      guest_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_user_id TEXT,
      actor_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      request_id TEXT NOT NULL,
      idempotency_key TEXT,
      payload_hash TEXT,
      outcome TEXT NOT NULL,
      previous_status TEXT,
      next_status TEXT,
      device_key_hash TEXT,
      session_key_hash TEXT,
      occurred_at TEXT NOT NULL
    );
    CREATE TRIGGER release_public_owner_after_guest_delete
    AFTER UPDATE OF status ON guests
    WHEN NEW.status = 'deleted' AND OLD.status != 'deleted'
    BEGIN
      UPDATE external_guest_owners
      SET released_at = NEW.updated_at
      WHERE guest_id = NEW.id AND released_at IS NULL;
    END;
    INSERT INTO venues VALUES
      (
        'venue-a', 'Venue A', 'club', 'Address A', 'Description A',
        'Brand A', 'Tagline A', 'Brand description A', 'Footer A',
        'Asia/Seoul', '22:00', '06:00', 1
      ),
      (
        'venue-b', 'Venue B', 'bar', NULL, NULL,
        NULL, NULL, NULL, NULL,
        'Asia/Seoul', '20:00', '04:00', 1
      ),
      (
        'venue-inactive', 'Inactive', 'club', NULL, NULL,
        NULL, NULL, NULL, NULL,
        'Asia/Seoul', '22:00', '06:00', 0
      );
    INSERT INTO events VALUES ('event-a', 'venue-a', '${DATE}', 'open');
  `);
  return database;
}

function insertLink(database, {
  id,
  venueId = "venue-a",
  token = `token-${id}`,
  kind = "contributor",
  contributorId = kind === "contributor" ? `contributor-${id}` : null,
  date = DATE,
  eventId = "event-a",
  maxGuests = 5,
  usedGuests = 0,
  active = 1,
  expiresAt = "2026-08-22T23:59:59.999Z",
  deletedAt = null,
} = {}) {
  database.prepare(`
    INSERT INTO external_dj_links (
      id, venue_id, token, dj_name, contributor_id, event, date, event_id,
      max_guests, used_guests, active, expires_at, created_by, locale_mode,
      kind, created_at, deleted_at, deleted_by
    ) VALUES (?, ?, ?, ?, ?, 'Friday', ?, ?, ?, ?, ?, ?,
      'admin-a', 'auto', ?, ?, ?, NULL)
  `).run(
    id,
    venueId,
    token,
    `DJ ${id}`,
    contributorId,
    date,
    eventId,
    maxGuests,
    usedGuests,
    active,
    expiresAt,
    kind,
    NOW,
    deletedAt,
  );
}

function insertGuest(database, {
  id,
  linkId,
  venueId = "venue-a",
  name = `GUEST ${id}`,
  status = "pending",
  eventId = "event-a",
  terminalRequestId = null,
  source = "authon",
} = {}) {
  database.prepare(`
    INSERT INTO guests (
      id, venue_id, name, email, instagram, external_link_id,
      created_by_user_id, registered_by_name, terminal_request_id,
      event_id, source, status, check_in_time, date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    id,
    venueId,
    name,
    `${id}@example.com`,
    `@${id}`,
    linkId,
    terminalRequestId,
    eventId,
    source,
    status,
    DATE,
    NOW,
    NOW,
  );
}

function insertOwner(database, {
  guestId,
  linkId,
  ownerKeyHash,
  releasedAt = null,
}) {
  database.prepare(`
    INSERT INTO external_guest_owners (
      guest_id, external_link_id, owner_key_hash, created_at, released_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(guestId, linkId, ownerKeyHash, NOW, releasedAt);
}

let dependencyNumber = 0;

function createDependencies(database, overrides = {}) {
  dependencyNumber += 1;
  const prefix = `generated-${dependencyNumber}`;
  let idNumber = 0;
  return {
    persistence: createExternalLinkPublicPersistence(
      new SqliteD1Database(database),
    ),
    async getTenantContext() {
      return { scope: "platform", venueId: null, resolved: true };
    },
    async getRequestIp() {
      return "203.0.113.10";
    },
    async consumeRateLimit() {
      return { allowed: true };
    },
    async onRateLimitUnavailable() {},
    async resolveEventForRosterWrite() {
      return { id: "event-a" };
    },
    async hashOwnerKey(ownerKey) {
      return ownerKey === OWNER_A ? OWNER_A_HASH : OWNER_B_HASH;
    },
    createId() {
      idNumber += 1;
      return `${prefix}-${idNumber}`;
    },
    now() {
      return new Date(NOW);
    },
    ...overrides,
  };
}

function scalar(database, sql) {
  return database.prepare(sql).get();
}

test("public validation preserves token, tenant, active venue, and owner-scoped roster behavior", async () => {
  const database = createDatabase();
  insertLink(database, { id: "contributor", usedGuests: 3 });
  insertGuest(database, {
    id: "pending",
    linkId: "contributor",
    terminalRequestId: "internal-request-id",
    source: "terminal",
  });
  insertGuest(database, {
    id: "checked",
    linkId: "contributor",
    status: "checked",
  });
  insertGuest(database, {
    id: "deleted",
    linkId: "contributor",
    status: "deleted",
  });

  const dependencies = createDependencies(database);
  const contributor = await validatePublicExternalToken(
    { token: "token-contributor" },
    dependencies,
  );
  assert.equal(contributor.error, null);
  assert.equal(contributor.data.link.token, "token-contributor");
  assert.equal(contributor.data.link.usedGuests, 3);
  assert.equal(Object.hasOwn(contributor.data.link, "contributorId"), false);
  assert.equal(contributor.data.venue.name, "Venue A");
  assert.deepEqual(
    contributor.data.guests.map((guest) => guest.id).sort(),
    ["checked", "pending"],
  );
  const pending = contributor.data.guests.find((guest) => guest.id === "pending");
  assert.deepEqual(Object.keys(pending).sort(), [
    "checkInTime",
    "createdAt",
    "id",
    "name",
    "status",
  ]);
  assert.equal(Object.hasOwn(pending, "email"), false);
  assert.equal(Object.hasOwn(pending, "instagram"), false);
  assert.equal(Object.hasOwn(pending, "externalLinkId"), false);
  assert.equal(Object.hasOwn(pending, "terminalRequestId"), false);
  assert.equal(Object.hasOwn(pending, "source"), false);

  insertLink(database, {
    id: "self",
    kind: "self_rsvp",
    usedGuests: 2,
  });
  insertGuest(database, { id: "self-a", linkId: "self" });
  insertGuest(database, { id: "self-b", linkId: "self" });
  insertOwner(database, {
    guestId: "self-a",
    linkId: "self",
    ownerKeyHash: OWNER_A_HASH,
  });
  insertOwner(database, {
    guestId: "self-b",
    linkId: "self",
    ownerKeyHash: OWNER_B_HASH,
  });
  const owned = await validatePublicExternalToken(
    { token: "token-self", ownerKey: OWNER_A },
    dependencies,
  );
  assert.equal(owned.error, null);
  assert.deepEqual(owned.data.guests.map((guest) => guest.id), ["self-a"]);
  assert.equal(owned.data.link.usedGuests, 1);

  const anonymous = await validatePublicExternalToken(
    { token: "token-self" },
    dependencies,
  );
  assert.equal(anonymous.error, null);
  assert.deepEqual(anonymous.data.guests, []);
  assert.equal(anonymous.data.link.usedGuests, 0);

  const mismatchedTenant = await validatePublicExternalToken(
    { token: "token-contributor" },
    createDependencies(database, {
      async getTenantContext() {
        return { scope: "venue", venueId: "venue-b", resolved: true };
      },
    }),
  );
  assert.equal(mismatchedTenant.error, "INVALID_EXTERNAL_LINK");

  insertLink(database, { id: "inactive", venueId: "venue-inactive" });
  const inactive = await validatePublicExternalToken(
    { token: "token-inactive" },
    dependencies,
  );
  assert.equal(inactive.error, "INVALID_EXTERNAL_LINK");
});

test("public bulk and self RSVP reservations recheck the exact writable event", async () => {
  const cases = [
    ["normal", () => {}, true, "event-a"],
    ["legacy", () => {}, true, null],
    ["closed", (db) => db.prepare("UPDATE events SET state = 'closed' WHERE id = 'event-a'").run(), false, "event-a"],
    ["date", (db) => db.prepare("UPDATE events SET business_date = '2026-08-22' WHERE id = 'event-a'").run(), false, "event-a"],
    ["venue", (db) => db.prepare("UPDATE events SET venue_id = 'venue-b' WHERE id = 'event-a'").run(), false, "event-a"],
  ];
  for (const [label, mutateEvent, writable, eventId] of cases) {
    const database = createDatabase();
    insertLink(database, { id: `bulk-${label}`, eventId });
    insertLink(database, { id: `self-${label}`, kind: "self_rsvp", eventId });
    mutateEvent(database);
    const persistence = createExternalLinkPublicPersistence(
      new SqliteD1Database(database),
    );
    const bulk = await persistence.reserveBulkGuests({
      linkId: `bulk-${label}`,
      venueId: "venue-a",
      eventId: "event-a",
      date: DATE,
      occurredAt: NOW,
      guardedNames: [`BULK ${label}`],
      guests: [{
        id: `bulk-guest-${label}`,
        name: `BULK ${label}`,
        activityId: `bulk-activity-${label}`,
        requestId: `bulk-request-${label}`,
      }],
    });
    const selfLink = await persistence.loadLinkById(`self-${label}`);
    const self = await persistence.reserveSelfRsvpGuest({
      link: selfLink,
      ownerKeyHash: `${label}`.padEnd(64, "a"),
      guestId: `self-guest-${label}`,
      guestName: `SELF ${label}`,
      eventId: "event-a",
      activityId: `self-activity-${label}`,
      requestId: `self-request-${label}`,
      occurredAt: NOW,
    });

    assert.equal(bulk.reserved, writable, label);
    assert.equal(bulk.insertedGuestIds.length, writable ? 1 : 0, label);
    assert.equal(self.reserved, writable, label);
    assert.equal(self.guestInserted, writable, label);
    assert.equal(
      scalar(
        database,
        "SELECT count(*) AS value FROM guests",
      ).value,
      writable ? 2 : 0,
      label,
    );
    assert.equal(
      scalar(
        database,
        "SELECT count(*) AS value FROM guest_activity_ledger",
      ).value,
      writable ? 2 : 0,
      label,
    );
    assert.equal(
      scalar(
        database,
        "SELECT sum(used_guests) AS value FROM external_dj_links",
      ).value,
      writable ? 2 : 0,
      label,
    );
  }
});

test("public self RSVP rename rechecks its current link, guest, and writable event", async () => {
  const cases = [
    ["normal", () => {}, true],
    ["link-venue", (db) => db.prepare("UPDATE external_dj_links SET venue_id = 'venue-b' WHERE id = 'self-update'").run(), false],
    ["link-date", (db) => db.prepare("UPDATE external_dj_links SET date = '2026-08-22' WHERE id = 'self-update'").run(), false],
    ["event-closed", (db) => db.prepare("UPDATE events SET state = 'closed' WHERE id = 'event-a'").run(), false],
    ["event-date", (db) => db.prepare("UPDATE events SET business_date = '2026-08-22' WHERE id = 'event-a'").run(), false],
    ["event-venue", (db) => db.prepare("UPDATE events SET venue_id = 'venue-b' WHERE id = 'event-a'").run(), false],
  ];
  for (const [label, mutate, writable] of cases) {
    const database = createDatabase();
    insertLink(database, { id: "self-update", kind: "self_rsvp" });
    insertGuest(database, { id: "self-update-guest", linkId: "self-update", name: "ORIGINAL" });
    insertOwner(database, {
      guestId: "self-update-guest",
      linkId: "self-update",
      ownerKeyHash: OWNER_A_HASH,
    });
    mutate(database);
    const persistence = createExternalLinkPublicPersistence(
      new SqliteD1Database(database),
    );
    const link = await persistence.loadLinkById("self-update");
    const guest = await persistence.findOwnedGuest({
      linkId: "self-update",
      ownerKeyHash: OWNER_A_HASH,
    });
    const updated = await persistence.updateSelfRsvpGuest({
      link,
      guest,
      eventId: "event-a",
      ownerKeyHash: OWNER_A_HASH,
      guestName: "RENAMED",
      activityId: `rename-activity-${label}`,
      requestId: `rename-request-${label}`,
      occurredAt: NOW,
    });

    assert.equal(updated, writable, label);
    assert.equal(
      scalar(
        database,
        "SELECT name AS value FROM guests WHERE id = 'self-update-guest'",
      ).value,
      writable ? "RENAMED" : "ORIGINAL",
      label,
    );
    assert.equal(
      scalar(database, "SELECT count(*) AS value FROM guest_activity_ledger").value,
      writable ? 1 : 0,
      label,
    );
  }
});

test("public contributor bulk create preserves duplicate, quota, retry, and rate-limit outcomes", async () => {
  const database = createDatabase();
  insertLink(database, {
    id: "bulk",
    maxGuests: 2,
    usedGuests: 1,
  });
  insertGuest(database, {
    id: "existing-alice",
    linkId: "bulk",
    name: "ALICE",
  });
  const dependencies = createDependencies(database);

  const created = await createPublicGuestsViaExternalLink(
    {
      token: "token-bulk",
      date: DATE,
      items: [
        { name: " " },
        { name: "alice" },
        { name: "  Bob  " },
      ],
    },
    dependencies,
  );
  assert.equal(created.error, null);
  assert.deepEqual(
    created.data.items.map((item) => item.status),
    ["invalid_name", "duplicate_requires_confirmation", "created"],
  );
  assert.equal(created.data.items[2].guest.name, "BOB");
  assert.deepEqual(Object.keys(created.data.items[2].guest).sort(), [
    "checkInTime",
    "createdAt",
    "id",
    "name",
    "status",
  ]);
  assert.equal(
    scalar(database, "SELECT used_guests AS value FROM external_dj_links WHERE id = 'bulk'").value,
    2,
  );
  assert.equal(
    scalar(database, "SELECT count(*) AS value FROM guest_activity_ledger").value,
    1,
  );

  const retry = await createPublicGuestsViaExternalLink(
    {
      token: "token-bulk",
      date: DATE,
      items: [{ name: "bob" }],
    },
    dependencies,
  );
  assert.equal(retry.error, null);
  assert.equal(retry.data.items[0].status, "duplicate_requires_confirmation");

  const full = await createPublicGuestsViaExternalLink(
    {
      token: "token-bulk",
      date: DATE,
      items: [{ name: "Carol" }],
    },
    dependencies,
  );
  assert.equal(full.error, null);
  assert.equal(full.data.items[0].status, "limit_reached");

  insertLink(database, { id: "rate-limited" });
  const limited = await createPublicGuestsViaExternalLink(
    {
      token: "token-rate-limited",
      date: DATE,
      items: [{ name: "Guest" }],
    },
    createDependencies(database, {
      async consumeRateLimit() {
        return { allowed: false };
      },
    }),
  );
  assert.equal(limited.error, "RATE_LIMITED");
  assert.equal(
    scalar(database, "SELECT count(*) AS value FROM guests WHERE external_link_id = 'rate-limited'").value,
    0,
  );
});

test("public guest mutations reject tenant mismatch and inactive venues before writes", async () => {
  const database = createDatabase();
  insertLink(database, { id: "tenant-contributor" });
  insertLink(database, { id: "tenant-self", kind: "self_rsvp", usedGuests: 1 });
  insertLink(database, { id: "inactive-write", venueId: "venue-inactive" });
  insertGuest(database, { id: "tenant-owned", linkId: "tenant-self" });
  insertOwner(database, {
    guestId: "tenant-owned",
    linkId: "tenant-self",
    ownerKeyHash: OWNER_A_HASH,
  });
  const mismatchedTenant = createDependencies(database, {
    async getTenantContext() {
      return { scope: "venue", venueId: "venue-b", resolved: true };
    },
  });

  const bulk = await createPublicGuestsViaExternalLink(
    {
      token: "token-tenant-contributor",
      date: DATE,
      items: [{ name: "Denied Guest" }],
    },
    mismatchedTenant,
  );
  assert.equal(bulk.error, "Link is invalid, expired, or inactive.");

  const selfCreate = await createPublicSelfRsvpGuest(
    {
      token: "token-tenant-self",
      ownerKey: OWNER_B,
      guestName: "Denied RSVP",
      date: DATE,
    },
    mismatchedTenant,
  );
  assert.equal(selfCreate.error, "Link is invalid, expired, or inactive.");

  const update = await updatePublicGuestViaExternalLink(
    {
      token: "token-tenant-self",
      ownerKey: OWNER_A,
      guestId: "tenant-owned",
      guestName: "Denied Update",
    },
    mismatchedTenant,
  );
  assert.equal(update.error, "Link is invalid, expired, or inactive.");

  const deletion = await deletePublicGuestViaExternalLink(
    {
      token: "token-tenant-self",
      ownerKey: OWNER_A,
      guestId: "tenant-owned",
    },
    mismatchedTenant,
  );
  assert.equal(deletion.error, "Link is invalid, expired, or inactive.");

  const inactive = await createPublicGuestsViaExternalLink(
    {
      token: "token-inactive-write",
      date: DATE,
      items: [{ name: "Inactive Venue Guest" }],
    },
    createDependencies(database),
  );
  assert.equal(inactive.error, "Link is invalid, expired, or inactive.");
  assert.equal(
    scalar(database, "SELECT count(*) AS value FROM guests WHERE name LIKE 'DENIED%'").value,
    0,
  );
  assert.equal(
    scalar(database, "SELECT name AS value FROM guests WHERE id = 'tenant-owned'").value,
    "GUEST tenant-owned",
  );
  assert.equal(
    scalar(database, "SELECT status AS value FROM guests WHERE id = 'tenant-owned'").value,
    "pending",
  );
});

test("public contributor batch rolls back reservation, guest, and ledger together", async () => {
  const database = createDatabase();
  insertLink(database, { id: "atomic" });
  database.exec(`
    CREATE TRIGGER fail_public_guest_activity
    BEFORE INSERT ON guest_activity_ledger
    BEGIN
      SELECT RAISE(ABORT, 'forced public activity failure');
    END;
  `);
  await assert.rejects(
    createPublicGuestsViaExternalLink(
      {
        token: "token-atomic",
        date: DATE,
        items: [{ name: "Atomic Guest" }],
      },
      createDependencies(database),
    ),
    /forced public activity failure/,
  );
  assert.equal(
    scalar(database, "SELECT used_guests AS value FROM external_dj_links WHERE id = 'atomic'").value,
    0,
  );
  assert.equal(
    scalar(database, "SELECT count(*) AS value FROM guests WHERE external_link_id = 'atomic'").value,
    0,
  );
  assert.equal(
    scalar(database, "SELECT count(*) AS value FROM guest_activity_ledger").value,
    0,
  );
});

test("public rate limiting fails open only for the availability-sensitive KV consume", async () => {
  const database = createDatabase();
  insertLink(database, { id: "kv-unavailable" });
  insertLink(database, { id: "headers-unavailable" });
  let unavailableReports = 0;
  const failOpen = await createPublicGuestsViaExternalLink(
    {
      token: "token-kv-unavailable",
      date: DATE,
      items: [{ name: "Fail Open Guest" }],
    },
    createDependencies(database, {
      async consumeRateLimit() {
        throw new Error("KV unavailable");
      },
      async onRateLimitUnavailable() {
        unavailableReports += 1;
      },
    }),
  );
  assert.equal(failOpen.error, null);
  assert.equal(failOpen.data.items[0].status, "created");
  assert.equal(unavailableReports, 1);

  await assert.rejects(
    createPublicGuestsViaExternalLink(
      {
        token: "token-headers-unavailable",
        date: DATE,
        items: [{ name: "Header Failure" }],
      },
      createDependencies(database, {
        async getRequestIp() {
          throw new Error("headers unavailable");
        },
        async onRateLimitUnavailable() {
          unavailableReports += 1;
        },
      }),
    ),
    /headers unavailable/,
  );
  assert.equal(unavailableReports, 1);
  assert.equal(
    scalar(database, "SELECT count(*) AS value FROM guests WHERE external_link_id = 'headers-unavailable'").value,
    0,
  );
});

test("Self-RSVP create is owner-idempotent and keeps quota reservation atomic", async () => {
  const database = createDatabase();
  insertLink(database, {
    id: "self-create",
    kind: "self_rsvp",
    maxGuests: 1,
  });
  let rateLimitCalls = 0;
  const dependencies = createDependencies(database, {
    async consumeRateLimit() {
      rateLimitCalls += 1;
      return { allowed: true };
    },
  });

  const first = await createPublicSelfRsvpGuest(
    {
      token: "token-self-create",
      ownerKey: OWNER_A,
      guestName: "  First Guest ",
      date: DATE,
    },
    dependencies,
  );
  assert.equal(first.error, null);
  assert.equal(first.data.name, "FIRST GUEST");
  assert.deepEqual(Object.keys(first.data).sort(), [
    "checkInTime",
    "createdAt",
    "id",
    "name",
    "status",
  ]);
  assert.equal(
    scalar(database, "SELECT used_guests AS value FROM external_dj_links WHERE id = 'self-create'").value,
    1,
  );
  assert.equal(
    scalar(database, "SELECT count(*) AS value FROM external_guest_owners").value,
    1,
  );

  const retry = await createPublicSelfRsvpGuest(
    {
      token: "token-self-create",
      ownerKey: OWNER_A,
      guestName: "Changed on retry",
      date: DATE,
    },
    dependencies,
  );
  assert.equal(retry.error, null);
  assert.equal(retry.data.id, first.data.id);
  assert.equal(retry.data.name, "FIRST GUEST");
  assert.equal(rateLimitCalls, 1);

  const full = await createPublicSelfRsvpGuest(
    {
      token: "token-self-create",
      ownerKey: OWNER_B,
      guestName: "Second Guest",
      date: DATE,
    },
    dependencies,
  );
  assert.equal(full.error, "Guest limit reached for this link.");
  assert.equal(rateLimitCalls, 2);
  assert.equal(
    scalar(database, "SELECT count(*) AS value FROM guests WHERE external_link_id = 'self-create'").value,
    1,
  );
});

test("Self-RSVP update and delete require the exact pending owner capability", async () => {
  const database = createDatabase();
  insertLink(database, {
    id: "self-mutate",
    kind: "self_rsvp",
    maxGuests: 2,
  });
  const dependencies = createDependencies(database);
  const created = await createPublicSelfRsvpGuest(
    {
      token: "token-self-mutate",
      ownerKey: OWNER_A,
      guestName: "Original",
      date: DATE,
    },
    dependencies,
  );
  assert.equal(created.error, null);

  const deniedUpdate = await updatePublicGuestViaExternalLink(
    {
      token: "token-self-mutate",
      ownerKey: OWNER_B,
      guestId: created.data.id,
      guestName: "Wrong",
    },
    dependencies,
  );
  assert.equal(deniedUpdate.error, "Unable to update this RSVP.");

  const updated = await updatePublicGuestViaExternalLink(
    {
      token: "token-self-mutate",
      ownerKey: OWNER_A,
      guestId: created.data.id,
      guestName: "  Updated Name ",
    },
    dependencies,
  );
  assert.equal(updated.error, null);
  assert.equal(updated.data.name, "UPDATED NAME");
  assert.deepEqual(Object.keys(updated.data).sort(), [
    "checkInTime",
    "createdAt",
    "id",
    "name",
    "status",
  ]);

  const deniedDelete = await deletePublicGuestViaExternalLink(
    {
      token: "token-self-mutate",
      ownerKey: OWNER_B,
      guestId: created.data.id,
    },
    dependencies,
  );
  assert.equal(
    deniedDelete.error,
    "Unable to delete this guest from this link.",
  );

  const deleted = await deletePublicGuestViaExternalLink(
    {
      token: "token-self-mutate",
      ownerKey: OWNER_A,
      guestId: created.data.id,
    },
    dependencies,
  );
  assert.equal(deleted.error, null);
  assert.equal(
    scalar(database, `SELECT status AS value FROM guests WHERE id = '${created.data.id}'`).value,
    "deleted",
  );
  assert.equal(
    scalar(database, "SELECT used_guests AS value FROM external_dj_links WHERE id = 'self-mutate'").value,
    0,
  );
  assert.equal(
    scalar(database, `SELECT released_at AS value FROM external_guest_owners WHERE guest_id = '${created.data.id}'`).value,
    NOW,
  );
  assert.deepEqual(
    database
      .prepare("SELECT action FROM guest_activity_ledger ORDER BY rowid")
      .all()
      .map((row) => row.action),
    ["add", "update", "delete"],
  );
});

test("contributor guest delete remains scoped to the exact token and pending row", async () => {
  const database = createDatabase();
  insertLink(database, { id: "delete-a", usedGuests: 1 });
  insertLink(database, { id: "delete-b", usedGuests: 1 });
  insertGuest(database, { id: "guest-a", linkId: "delete-a" });
  insertGuest(database, { id: "guest-b", linkId: "delete-b" });
  const dependencies = createDependencies(database);

  const crossLink = await deletePublicGuestViaExternalLink(
    { token: "token-delete-a", guestId: "guest-b" },
    dependencies,
  );
  assert.equal(
    crossLink.error,
    "Unable to delete this guest from this link.",
  );

  const deleted = await deletePublicGuestViaExternalLink(
    { token: "token-delete-a", guestId: "guest-a" },
    dependencies,
  );
  assert.equal(deleted.error, null);
  assert.equal(
    scalar(database, "SELECT status AS value FROM guests WHERE id = 'guest-a'").value,
    "deleted",
  );
  assert.equal(
    scalar(database, "SELECT used_guests AS value FROM external_dj_links WHERE id = 'delete-a'").value,
    0,
  );
  assert.equal(
    scalar(database, "SELECT status AS value FROM guests WHERE id = 'guest-b'").value,
    "pending",
  );
});
