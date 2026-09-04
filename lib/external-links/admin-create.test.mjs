import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createExternalLinkAdminPersistence } from "./persistence.ts";
import {
  createAdminExternalLink,
  ExternalLinkAdminError,
  fetchAdminExternalDjDirectory,
  fetchAdminExternalLinkCreateSuggestions,
} from "./service.ts";

const NOW = "2026-08-20T12:00:00.000Z";

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
      deleted_at TEXT
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      business_date TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE venue_contributors (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      display_name TEXT NOT NULL,
      name_key TEXT,
      kind TEXT NOT NULL,
      active INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_contributor_name_key
      ON venue_contributors(venue_id, name_key)
      WHERE name_key IS NOT NULL;
    CREATE TABLE external_dj_links (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      token TEXT NOT NULL UNIQUE,
      dj_name TEXT NOT NULL,
      contributor_id TEXT REFERENCES venue_contributors(id),
      event TEXT,
      date TEXT,
      event_id TEXT REFERENCES events(id),
      max_guests INTEGER NOT NULL,
      used_guests INTEGER NOT NULL,
      active INTEGER NOT NULL,
      expires_at TEXT,
      created_by TEXT REFERENCES users(id),
      locale_mode TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT REFERENCES users(id)
    );
    CREATE TABLE contributor_audit_events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      contributor_id TEXT REFERENCES venue_contributors(id),
      actor_user_id TEXT REFERENCES users(id),
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER contributor_audit_scope_insert
    BEFORE INSERT ON contributor_audit_events
    WHEN
      (
        NEW.source_kind = 'contributor'
        AND NOT EXISTS (
          SELECT 1 FROM venue_contributors
          WHERE id = NEW.source_id AND venue_id = NEW.venue_id
        )
      )
      OR (
        NEW.source_kind = 'external_link'
        AND NOT EXISTS (
          SELECT 1 FROM external_dj_links
          WHERE id = NEW.source_id
            AND venue_id = NEW.venue_id
            AND contributor_id IS NEW.contributor_id
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'contributor audit scope mismatch');
    END;
    INSERT INTO venues (id, active) VALUES
      ('venue-a', 1),
      ('venue-b', 1),
      ('venue-inactive', 0);
    INSERT INTO users (
      id, role, account_kind, venue_id, session_version, active, deleted_at
    ) VALUES
      ('venue-admin-a', 'venue_admin', 'personal', 'venue-a', 7, 1, NULL),
      ('venue-admin-b', 'venue_admin', 'personal', 'venue-b', 7, 1, NULL),
      ('super-admin', 'super_admin', 'personal', NULL, 7, 1, NULL);
    INSERT INTO events (id, venue_id, business_date, state) VALUES
      ('event-a', 'venue-a', '2026-08-21', 'open'),
      ('event-b', 'venue-b', '2026-08-21', 'open');
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
      async run() {
        const result = database.prepare(statement).run(...values);
        return { success: true, results: [], meta: { changes: result.changes } };
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

function actor({
  userId = "venue-admin-a",
  role = "venue_admin",
  accountKind = "personal",
  venueId = "venue-a",
  sessionVersion = 7,
} = {}) {
  return { userId, role, accountKind, venueId, sessionVersion };
}

function draft(overrides = {}) {
  return {
    date: "2026-08-21",
    djName: "DJ New",
    contributorId: null,
    event: "Friday",
    maxGuests: 10,
    localeMode: "auto",
    kind: "contributor",
    ...overrides,
  };
}

function dependencies(database, overrides = {}) {
  const ids = ["link-created", "audit-mapped"];
  return {
    persistence: createExternalLinkAdminPersistence(asD1(database)),
    async resolveEventForRosterWrite() {
      return { id: "event-a" };
    },
    createId: () => ids.shift(),
    createToken: () => "token-created",
    createContributorId: async () => "contributor-created",
    getContributorCreatedAuditId: () => "audit-created",
    now: () => new Date(NOW),
    ...overrides,
  };
}

function mutateBeforeFinalCreate(createDependencies, mutate) {
  const createExternalLink =
    createDependencies.persistence.createExternalLink.bind(
      createDependencies.persistence,
    );
  createDependencies.persistence.createExternalLink = async (input) => {
    mutate();
    return createExternalLink(input);
  };
  return createDependencies;
}

function createWriteCounts(database) {
  return {
    contributors: database
      .prepare("SELECT count(*) AS count FROM venue_contributors")
      .get().count,
    links: database
      .prepare("SELECT count(*) AS count FROM external_dj_links")
      .get().count,
    audits: database
      .prepare("SELECT count(*) AS count FROM contributor_audit_events")
      .get().count,
  };
}

function insertContributor(database, {
  id,
  venueId = "venue-a",
  displayName,
  nameKey,
  active = 1,
}) {
  database.prepare(`
    INSERT INTO venue_contributors (
      id, venue_id, display_name, name_key, kind, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'dj', ?, ?, ?)
  `).run(id, venueId, displayName, nameKey, active, NOW, NOW);
}

function insertLink(database, {
  id,
  contributorId,
  venueId = "venue-a",
  date,
  kind = "contributor",
  event = "Event",
  deletedAt = null,
}) {
  database.prepare(`
    INSERT INTO external_dj_links (
      id, venue_id, token, dj_name, contributor_id, event, date, event_id,
      max_guests, used_guests, active, expires_at, created_by, locale_mode,
      kind, created_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 0, 1, ?, 'venue-admin-a', 'auto', ?, ?, ?)
  `).run(
    id,
    venueId,
    `token-${id}`,
    id,
    contributorId,
    event,
    date,
    venueId === "venue-a" ? "event-a" : "event-b",
    "2026-08-22T23:59:59.999Z",
    kind,
    NOW,
    deletedAt,
  );
}

function assertAdminError(expectedCode) {
  return (error) =>
    error instanceof ExternalLinkAdminError && error.code === expectedCode;
}

test("create suggestions exclude deleted links and orphaned DJ names", async () => {
  const database = createDatabase();
  insertContributor(database, {
    id: "recent",
    displayName: "Recent DJ",
    nameKey: "RECENT DJ",
  });
  insertContributor(database, {
    id: "unused",
    displayName: "A DJ",
    nameKey: "A DJ",
  });
  insertContributor(database, {
    id: "deleted-only",
    displayName: "Deleted DJ",
    nameKey: "DELETED DJ",
  });
  insertContributor(database, {
    id: "inactive",
    displayName: "Inactive DJ",
    nameKey: "INACTIVE DJ",
    active: 0,
  });
  insertContributor(database, {
    id: "legacy",
    displayName: "Legacy DJ",
    nameKey: null,
  });
  insertContributor(database, {
    id: "venue-b-dj",
    venueId: "venue-b",
    displayName: "Venue B DJ",
    nameKey: "VENUE B DJ",
  });
  insertLink(database, {
    id: "recent-link",
    contributorId: "recent",
    date: "2026-08-22",
    event: "Friday Night",
  });
  insertLink(database, {
    id: "deleted-link",
    contributorId: "deleted-only",
    date: "2026-08-24",
    event: "Deleted Event",
    deletedAt: "2026-08-25T00:00:00.000Z",
  });
  insertLink(database, {
    id: "cross-venue-link",
    contributorId: "recent",
    venueId: "venue-b",
    date: "2026-08-25",
    event: "Venue B Event",
  });
  insertLink(database, {
    id: "ignored-self-link",
    contributorId: "recent",
    date: "2026-08-23",
    kind: "self_rsvp",
    event: "Public RSVP",
  });

  const persistence = createExternalLinkAdminPersistence(asD1(database));
  const rows = await fetchAdminExternalDjDirectory(
    { actor: actor(), requestedVenueId: "venue-a" },
    { persistence },
  );
  assert.deepEqual(rows, [
    {
      contributorId: "recent",
      displayName: "Recent DJ",
      linkCount: 1,
      lastUsedDate: "2026-08-22",
    },
  ]);

  const suggestions = await fetchAdminExternalLinkCreateSuggestions(
    { actor: actor(), requestedVenueId: "venue-a" },
    { persistence },
  );
  assert.deepEqual(suggestions, {
    djs: rows,
    events: [
      { eventName: "Public RSVP", linkCount: 1, lastUsedDate: "2026-08-23" },
      { eventName: "Friday Night", linkCount: 1, lastUsedDate: "2026-08-22" },
    ],
  });

  await assert.rejects(
    fetchAdminExternalDjDirectory(
      { actor: actor(), requestedVenueId: "venue-b" },
      { persistence },
    ),
    assertAdminError("FORBIDDEN"),
  );
  await assert.rejects(
    fetchAdminExternalDjDirectory(
      {
        actor: actor({ userId: "super-admin", role: "super_admin", venueId: null }),
        requestedVenueId: "venue-inactive",
      },
      { persistence },
    ),
    assertAdminError("VENUE_UNAVAILABLE"),
  );
  database.close();
});

test("directory rejects an over-limit result without returning a partial directory", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    contributorId: `contributor-${index}`,
    displayName: `DJ ${index}`,
    linkCount: 0,
    lastUsedDate: null,
  }));
  await assert.rejects(
    fetchAdminExternalDjDirectory(
      { actor: actor(), requestedVenueId: "venue-a" },
      {
        persistence: {
          isVenueActive: async () => true,
          listContributorDirectory: async (_venueId, limit) => {
            assert.equal(limit, 501);
            return rows;
          },
        },
      },
    ),
    assertAdminError("DJ_DIRECTORY_TOO_LARGE"),
  );

  await assert.rejects(
    fetchAdminExternalLinkCreateSuggestions(
      { actor: actor(), requestedVenueId: "venue-a" },
      {
        persistence: {
          isVenueActive: async () => true,
          listContributorDirectory: async () => [],
          listEventDirectory: async (_venueId, limit) => {
            assert.equal(limit, 501);
            return Array.from({ length: 501 }, (_, index) => ({
              eventName: `Event ${index}`,
              linkCount: 1,
              lastUsedDate: "2026-08-20",
            }));
          },
        },
      },
    ),
    assertAdminError("CREATE_SUGGESTIONS_TOO_LARGE"),
  );
});

test("create reuses the exact active contributor and its canonical display name", async () => {
  const database = createDatabase();
  insertContributor(database, {
    id: "canonical",
    displayName: "DJ Canon",
    nameKey: "DJ CANON",
  });
  const eventInputs = [];
  const created = await createAdminExternalLink(
    {
      actor: actor(),
      requestedVenueId: "venue-a",
      eventId: "event-a",
      draft: draft({ djName: "dj canon", contributorId: "canonical" }),
    },
    dependencies(database, {
      async resolveEventForRosterWrite(input) {
        eventInputs.push(input);
        return { id: "event-a" };
      },
    }),
  );

  assert.equal(created.djName, "DJ Canon");
  assert.equal(created.contributorId, "canonical");
  assert.deepEqual(eventInputs, [{
    venueId: "venue-a",
    businessDate: "2026-08-21",
    eventId: "event-a",
    actorUserId: "venue-admin-a",
    actorGuard: {
      id: "venue-admin-a",
      role: "venue_admin",
      accountKind: "personal",
      venueId: "venue-a",
      sessionVersion: 7,
      allowedRoles: ["super_admin", "venue_admin"],
    },
    purpose: "register",
  }]);
  assert.deepEqual(
    database.prepare(`
      SELECT source_kind AS sourceKind, source_id AS sourceId, action
      FROM contributor_audit_events
    `).all().map((row) => ({ ...row })),
    [{ sourceKind: "external_link", sourceId: "link-created", action: "mapped" }],
  );
  database.close();
});

test("create rejects mismatched, inactive, and cross-venue selected contributors", async () => {
  const database = createDatabase();
  insertContributor(database, {
    id: "mismatch",
    displayName: "DJ Alpha",
    nameKey: "DJ ALPHA",
  });
  insertContributor(database, {
    id: "inactive",
    displayName: "DJ Inactive",
    nameKey: "DJ INACTIVE",
    active: 0,
  });
  insertContributor(database, {
    id: "venue-b-dj",
    venueId: "venue-b",
    displayName: "DJ Other Venue",
    nameKey: "DJ OTHER VENUE",
  });

  for (const [contributorId, djName] of [
    ["mismatch", "DJ Beta"],
    ["inactive", "DJ Inactive"],
    ["venue-b-dj", "DJ Other Venue"],
  ]) {
    await assert.rejects(
      createAdminExternalLink(
        {
          actor: actor(),
          requestedVenueId: "venue-a",
          draft: draft({ contributorId, djName }),
        },
        dependencies(database),
      ),
      assertAdminError("INVALID_CONTRIBUTOR"),
    );
  }
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM external_dj_links").get().count,
    0,
  );
  database.close();
});

test("create final write rejects a venue disabled after service reads without batch residue", async () => {
  const database = createDatabase();
  const createDependencies = mutateBeforeFinalCreate(
    dependencies(database),
    () => database.prepare("UPDATE venues SET active = 0 WHERE id = ?").run("venue-a"),
  );

  await assert.rejects(
    createAdminExternalLink(
      {
        actor: actor(),
        requestedVenueId: "venue-a",
        draft: draft(),
      },
      createDependencies,
    ),
    assertAdminError("VENUE_UNAVAILABLE"),
  );
  assert.deepEqual(createWriteCounts(database), {
    contributors: 0,
    links: 0,
    audits: 0,
  });
  database.close();
});

test("create final write rejects stale actor snapshots without batch residue", async (t) => {
  const mutations = [
    {
      name: "session revoked",
      sql: "UPDATE users SET session_version = 8 WHERE id = 'venue-admin-a'",
    },
    {
      name: "actor inactive",
      sql: "UPDATE users SET active = 0 WHERE id = 'venue-admin-a'",
    },
    {
      name: "actor deleted",
      sql: "UPDATE users SET deleted_at = '2026-08-20T11:00:00.000Z' WHERE id = 'venue-admin-a'",
    },
    {
      name: "role changed",
      sql: "UPDATE users SET role = 'staff' WHERE id = 'venue-admin-a'",
    },
    {
      name: "account kind changed",
      sql: "UPDATE users SET account_kind = 'shared' WHERE id = 'venue-admin-a'",
    },
    {
      name: "actor venue changed",
      sql: "UPDATE users SET venue_id = 'venue-b' WHERE id = 'venue-admin-a'",
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, async () => {
      const database = createDatabase();
      const createDependencies = mutateBeforeFinalCreate(
        dependencies(database),
        () => database.exec(mutation.sql),
      );

      await assert.rejects(
        createAdminExternalLink(
          {
            actor: actor(),
            requestedVenueId: "venue-a",
            eventId: "event-a",
            draft: draft(),
          },
          createDependencies,
        ),
      );
      assert.deepEqual(createWriteCounts(database), {
        contributors: 0,
        links: 0,
        audits: 0,
      });
      database.close();
    });
  }
});

test("create final write rejects stale event scope and state without batch residue", async () => {
  const mutations = [
    "UPDATE events SET state = 'closed' WHERE id = 'event-a'",
    "UPDATE events SET venue_id = 'venue-b' WHERE id = 'event-a'",
  ];

  for (const mutation of mutations) {
    const database = createDatabase();
    const createDependencies = mutateBeforeFinalCreate(
      dependencies(database, {
        async resolveEventForRosterWrite(input) {
          const event = database
            .prepare(`
              SELECT id, venue_id AS venueId, business_date AS businessDate, state
              FROM events WHERE id = ?
            `)
            .get(input.eventId ?? "event-a");
          if (
            !event ||
            event.venueId !== input.venueId ||
            event.businessDate !== input.businessDate ||
            (event.state !== "draft" && event.state !== "open")
          ) {
            throw new Error("EVENT_NOT_ACTIVE");
          }
          return { id: event.id };
        },
      }),
      () => database.exec(mutation),
    );

    await assert.rejects(
      createAdminExternalLink(
        {
          actor: actor(),
          requestedVenueId: "venue-a",
          eventId: "event-a",
          draft: draft(),
        },
        createDependencies,
      ),
      /EVENT_NOT_ACTIVE/,
    );
    assert.deepEqual(createWriteCounts(database), {
      contributors: 0,
      links: 0,
      audits: 0,
    });
    database.close();
  }
});

test("create final write rejects a selected contributor renamed or deactivated after service reads", async () => {
  const mutations = [
    `UPDATE venue_contributors
     SET display_name = 'DJ Renamed', name_key = 'DJ RENAMED'
     WHERE id = 'canonical'`,
    "UPDATE venue_contributors SET active = 0 WHERE id = 'canonical'",
  ];

  for (const mutation of mutations) {
    const database = createDatabase();
    insertContributor(database, {
      id: "canonical",
      displayName: "DJ Canon",
      nameKey: "DJ CANON",
    });
    const createDependencies = mutateBeforeFinalCreate(
      dependencies(database),
      () => database.exec(mutation),
    );

    await assert.rejects(
      createAdminExternalLink(
        {
          actor: actor(),
          requestedVenueId: "venue-a",
          eventId: "event-a",
          draft: draft({ djName: "DJ Canon", contributorId: "canonical" }),
        },
        createDependencies,
      ),
      assertAdminError("INVALID_CONTRIBUTOR"),
    );
    assert.deepEqual(
      {
        links: database
          .prepare("SELECT count(*) AS count FROM external_dj_links")
          .get().count,
        audits: database
          .prepare("SELECT count(*) AS count FROM contributor_audit_events")
          .get().count,
      },
      { links: 0, audits: 0 },
    );
    database.close();
  }
});

test("new contributor, created audit, link, and mapping audit commit as one batch", async () => {
  const database = createDatabase();
  const created = await createAdminExternalLink(
    {
      actor: actor(),
      requestedVenueId: "venue-a",
      draft: draft(),
    },
    dependencies(database),
  );

  assert.deepEqual(
    { ...database.prepare(`
      SELECT id, venue_id AS venueId, display_name AS displayName,
        name_key AS nameKey, active
      FROM venue_contributors
    `).get() },
    {
      id: "contributor-created",
      venueId: "venue-a",
      displayName: "DJ New",
      nameKey: "DJ NEW",
      active: 1,
    },
  );
  assert.deepEqual(
    database.prepare(`
      SELECT id, source_kind AS sourceKind, source_id AS sourceId, action
      FROM contributor_audit_events ORDER BY action
    `).all().map((row) => ({ ...row })),
    [
      {
        id: "audit-created",
        sourceKind: "contributor",
        sourceId: "contributor-created",
        action: "created",
      },
      {
        id: "audit-mapped",
        sourceKind: "external_link",
        sourceId: "link-created",
        action: "mapped",
      },
    ],
  );
  assert.deepEqual(
    {
      id: created.id,
      contributorId: created.contributorId,
      eventId: created.eventId,
      expiresAt: created.expiresAt,
      active: created.active,
      usedGuests: created.usedGuests,
    },
    {
      id: "link-created",
      contributorId: "contributor-created",
      eventId: "event-a",
      expiresAt: "2026-08-22T23:59:59.999Z",
      active: true,
      usedGuests: 0,
    },
  );
  database.close();
});

test("a failed mapping audit rolls back the new contributor and link batch", async () => {
  const database = createDatabase();
  database.exec(`
    CREATE TRIGGER reject_mapping_audit
    BEFORE INSERT ON contributor_audit_events
    WHEN NEW.action = 'mapped'
    BEGIN
      SELECT RAISE(ABORT, 'forced mapping failure');
    END;
  `);

  await assert.rejects(
    createAdminExternalLink(
      {
        actor: actor(),
        requestedVenueId: "venue-a",
        draft: draft(),
      },
      dependencies(database),
    ),
    /forced mapping failure/,
  );
  assert.deepEqual(
    {
      contributors: database.prepare("SELECT count(*) AS count FROM venue_contributors").get().count,
      links: database.prepare("SELECT count(*) AS count FROM external_dj_links").get().count,
      audits: database.prepare("SELECT count(*) AS count FROM contributor_audit_events").get().count,
    },
    { contributors: 0, links: 0, audits: 0 },
  );
  database.close();
});

test("self-RSVP create writes no contributor or contributor audit", async () => {
  const database = createDatabase();
  const created = await createAdminExternalLink(
    {
      actor: actor(),
      requestedVenueId: "venue-a",
      draft: draft({
        djName: "Self RSVP",
        kind: "self_rsvp",
        contributorId: null,
      }),
    },
    dependencies(database),
  );

  assert.equal(created.contributorId, null);
  assert.equal(created.kind, "self_rsvp");
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM venue_contributors").get().count,
    0,
  );
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM contributor_audit_events").get().count,
    0,
  );
  database.close();
});
