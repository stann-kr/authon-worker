import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createExternalLinkLifecyclePersistence } from "./persistence.ts";
import {
  activateAdminExternalLink,
  deactivateAdminExternalLink,
  deleteAdminExternalLink,
  ExternalLinkLifecycleError,
} from "./service.ts";

const NOW = "2026-08-20T12:00:00.000Z";
const serviceDependencies = (database) => ({
  persistence: createExternalLinkLifecyclePersistence(asD1(database)),
  now: () => new Date(NOW),
});

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
    CREATE TABLE external_dj_links (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      date TEXT,
      expires_at TEXT,
      active INTEGER NOT NULL,
      deleted_at TEXT,
      deleted_by TEXT REFERENCES users(id)
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      external_link_id TEXT REFERENCES external_dj_links(id),
      status TEXT NOT NULL
    );
    INSERT INTO venues (id, active) VALUES ('venue-a', 1), ('venue-b', 1), ('venue-inactive', 0);
    INSERT INTO users (
      id, role, account_kind, venue_id, session_version, active, deleted_at
    ) VALUES
      ('super-admin', 'super_admin', 'personal', NULL, 7, 1, NULL),
      ('venue-admin-a', 'venue_admin', 'personal', 'venue-a', 7, 1, NULL),
      ('venue-admin-b', 'venue_admin', 'personal', 'venue-b', 7, 1, NULL);
  `);
  return database;
}

function asD1(database) {
  const d1 = {
    prepare(statement) {
      let values = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          return this;
        },
        async first() {
          return database.prepare(statement).get(...values) ?? null;
        },
        async run() {
          const rows = database.prepare(statement).all(...values);
          return { success: true, results: rows, meta: {} };
        },
      };
    },
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
  return d1;
}

function insertLink(database, {
  id,
  venueId = "venue-a",
  date = "2026-08-21",
  expiresAt = "2026-08-21T12:00:00.000Z",
  active = 1,
  deletedAt = null,
  deletedBy = null,
}) {
  database.prepare(`
    INSERT INTO external_dj_links (
      id, venue_id, date, expires_at, active, deleted_at, deleted_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, venueId, date, expiresAt, active, deletedAt, deletedBy);
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

function assertLifecycleError(expectedCode) {
  return (error) => error instanceof ExternalLinkLifecycleError && error.code === expectedCode;
}

test("venue admins cannot mutate another venue link while super admins retain global scope", async () => {
  const database = createDatabase();
  insertLink(database, { id: "link-b", venueId: "venue-b", active: 1 });
  const dependencies = serviceDependencies(database);

  await assert.rejects(
    deactivateAdminExternalLink({ linkId: "link-b", actor: actor() }, dependencies),
    assertLifecycleError("NOT_FOUND"),
  );
  await deactivateAdminExternalLink({
    linkId: "link-b",
    actor: actor({ userId: "super-admin", role: "super_admin", venueId: null }),
  }, dependencies);

  assert.equal(
    database.prepare("SELECT active FROM external_dj_links WHERE id = 'link-b'").get().active,
    0,
  );
  database.close();
});

test("inactive venues and deleted links cannot be managed", async () => {
  const database = createDatabase();
  insertLink(database, { id: "inactive-venue", venueId: "venue-inactive" });
  insertLink(database, {
    id: "deleted-link",
    deletedAt: "2026-08-19T00:00:00.000Z",
    deletedBy: "venue-admin-a",
  });
  const dependencies = serviceDependencies(database);

  await assert.rejects(
    deactivateAdminExternalLink({
      linkId: "inactive-venue",
      actor: actor({ userId: "super-admin", role: "super_admin", venueId: null }),
    }, dependencies),
    assertLifecycleError("VENUE_UNAVAILABLE"),
  );
  await assert.rejects(
    activateAdminExternalLink({ linkId: "deleted-link", actor: actor() }, dependencies),
    assertLifecycleError("NOT_FOUND"),
  );
  database.close();
});

test("deleting unused links hard-deletes, while guest history archives with its foreign key intact", async () => {
  const database = createDatabase();
  insertLink(database, { id: "unused-link" });
  insertLink(database, { id: "used-link" });
  database.prepare("INSERT INTO guests (id, external_link_id, status) VALUES (?, ?, ?)")
    .run("guest-a", "used-link", "deleted");
  const dependencies = serviceDependencies(database);

  await deleteAdminExternalLink({ linkId: "unused-link", actor: actor() }, dependencies);
  await deleteAdminExternalLink({ linkId: "used-link", actor: actor() }, dependencies);

  assert.equal(
    database.prepare("SELECT id FROM external_dj_links WHERE id = 'unused-link'").get(),
    undefined,
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT active, deleted_at AS deletedAt, deleted_by AS deletedBy
      FROM external_dj_links WHERE id = 'used-link'
    `).get() },
    { active: 0, deletedAt: NOW, deletedBy: "venue-admin-a" },
  );
  assert.equal(
    database.prepare("SELECT external_link_id AS externalLinkId FROM guests WHERE id = 'guest-a'").get().externalLinkId,
    "used-link",
  );
  database.close();
});

test("activation rejects invalid dates and expired links but permits null or malformed expiry", async () => {
  const database = createDatabase();
  insertLink(database, { id: "invalid-date", date: "2026-02-30", active: 0 });
  insertLink(database, {
    id: "expired-link",
    expiresAt: "2026-08-20T11:59:59.999Z",
    active: 0,
  });
  insertLink(database, { id: "no-expiry", expiresAt: null, active: 0 });
  insertLink(database, { id: "legacy-expiry", expiresAt: "not-a-date", active: 0 });
  const dependencies = serviceDependencies(database);

  for (const linkId of ["invalid-date", "expired-link"]) {
    await assert.rejects(
      activateAdminExternalLink({ linkId, actor: actor() }, dependencies),
      assertLifecycleError("CANNOT_ACTIVATE"),
    );
  }
  await activateAdminExternalLink({ linkId: "no-expiry", actor: actor() }, dependencies);
  await activateAdminExternalLink({ linkId: "no-expiry", actor: actor() }, dependencies);
  await activateAdminExternalLink({ linkId: "legacy-expiry", actor: actor() }, dependencies);

  assert.deepEqual(
    database.prepare(`
      SELECT id, active FROM external_dj_links
      WHERE id IN ('no-expiry', 'legacy-expiry') ORDER BY id
    `).all().map((row) => ({ ...row })),
    [{ id: "legacy-expiry", active: 1 }, { id: "no-expiry", active: 1 }],
  );
  database.close();
});

test("deactivation is repeatable, while a hard-deleted link rejects a delete retry", async () => {
  const database = createDatabase();
  insertLink(database, { id: "repeat-link", active: 1 });
  const dependencies = serviceDependencies(database);

  await deactivateAdminExternalLink({ linkId: "repeat-link", actor: actor() }, dependencies);
  await deactivateAdminExternalLink({ linkId: "repeat-link", actor: actor() }, dependencies);
  assert.equal(
    database.prepare("SELECT active FROM external_dj_links WHERE id = 'repeat-link'").get().active,
    0,
  );
  await deleteAdminExternalLink({ linkId: "repeat-link", actor: actor() }, dependencies);
  await assert.rejects(
    deleteAdminExternalLink({ linkId: "repeat-link", actor: actor() }, dependencies),
    assertLifecycleError("NOT_FOUND"),
  );
  database.close();
});

test("activation rejects a target deleted after the authorization read", async () => {
  const database = createDatabase();
  insertLink(database, { id: "stale-link", active: 0 });
  const persistence = createExternalLinkLifecyclePersistence(asD1(database));
  const loadUndeletedTarget = persistence.loadUndeletedTarget.bind(persistence);
  let shouldDeleteAfterRead = true;
  persistence.loadUndeletedTarget = async (input) => {
    const target = await loadUndeletedTarget(input);
    if (target && shouldDeleteAfterRead) {
      shouldDeleteAfterRead = false;
      database.prepare(`
        UPDATE external_dj_links
        SET deleted_at = ?, deleted_by = ?
        WHERE id = ?
      `).run(NOW, "venue-admin-a", input.linkId);
    }
    return target;
  };

  await assert.rejects(
    activateAdminExternalLink(
      { linkId: "stale-link", actor: actor() },
      { persistence, now: () => new Date(NOW) },
    ),
    assertLifecycleError("NOT_FOUND"),
  );

  assert.deepEqual(
    { ...database.prepare(`
      SELECT active, deleted_at AS deletedAt FROM external_dj_links WHERE id = 'stale-link'
    `).get() },
    { active: 0, deletedAt: NOW },
  );
  database.close();
});

test("activation rejects an expiry changed after the validation read", async () => {
  const database = createDatabase();
  insertLink(database, { id: "stale-expiry", active: 0 });
  const persistence = createExternalLinkLifecyclePersistence(asD1(database));
  const loadUndeletedTarget = persistence.loadUndeletedTarget.bind(persistence);
  let shouldExpireAfterRead = true;
  persistence.loadUndeletedTarget = async (input) => {
    const target = await loadUndeletedTarget(input);
    if (target && shouldExpireAfterRead) {
      shouldExpireAfterRead = false;
      database.prepare(`
        UPDATE external_dj_links
        SET expires_at = ?
        WHERE id = ?
      `).run("2026-08-20T11:59:59.999Z", input.linkId);
    }
    return target;
  };

  await assert.rejects(
    activateAdminExternalLink(
      { linkId: "stale-expiry", actor: actor() },
      { persistence, now: () => new Date(NOW) },
    ),
    assertLifecycleError("CANNOT_ACTIVATE"),
  );
  assert.equal(
    database.prepare("SELECT active FROM external_dj_links WHERE id = 'stale-expiry'").get().active,
    0,
  );
  database.close();
});

test("deactivation rejects a venue disabled after the authorization read", async () => {
  const database = createDatabase();
  insertLink(database, { id: "stale-venue", active: 1 });
  const persistence = createExternalLinkLifecyclePersistence(asD1(database));
  const isVenueActive = persistence.isVenueActive.bind(persistence);
  let shouldDisableAfterRead = true;
  persistence.isVenueActive = async (venueId) => {
    const isActive = await isVenueActive(venueId);
    if (isActive && shouldDisableAfterRead) {
      shouldDisableAfterRead = false;
      database.prepare("UPDATE venues SET active = 0 WHERE id = ?").run(venueId);
    }
    return isActive;
  };

  await assert.rejects(
    deactivateAdminExternalLink(
      { linkId: "stale-venue", actor: actor() },
      { persistence, now: () => new Date(NOW) },
    ),
    assertLifecycleError("VENUE_UNAVAILABLE"),
  );
  assert.equal(
    database.prepare("SELECT active FROM external_dj_links WHERE id = 'stale-venue'").get().active,
    1,
  );
  database.close();
});

test("activation and deactivation reject a stale actor at their final mutation", async () => {
  for (const operation of ["activate", "deactivate"]) {
    const database = createDatabase();
    const linkId = `stale-actor-${operation}`;
    const initialActive = operation === "activate" ? 0 : 1;
    insertLink(database, { id: linkId, active: initialActive });
    const persistence = createExternalLinkLifecyclePersistence(asD1(database));
    const method = operation === "activate" ? "activateManaged" : "deactivateManaged";
    const finalWrite = persistence[method].bind(persistence);
    persistence[method] = async (input) => {
      database
        .prepare("UPDATE users SET session_version = 8 WHERE id = ?")
        .run("venue-admin-a");
      return finalWrite(input);
    };

    await assert.rejects(
      operation === "activate"
        ? activateAdminExternalLink(
            { linkId, actor: actor() },
            { persistence, now: () => new Date(NOW) },
          )
        : deactivateAdminExternalLink(
            { linkId, actor: actor() },
            { persistence, now: () => new Date(NOW) },
          ),
      (error) =>
        error instanceof ExternalLinkLifecycleError &&
        (error.code === "NOT_FOUND" || error.code === "CANNOT_ACTIVATE"),
    );
    assert.equal(
      database
        .prepare("SELECT active FROM external_dj_links WHERE id = ?")
        .get(linkId).active,
      initialActive,
    );
    database.close();
  }
});

test("delete rejects a target moved after the authorization read", async () => {
  const database = createDatabase();
  insertLink(database, { id: "stale-delete-venue", active: 1 });
  const persistence = createExternalLinkLifecyclePersistence(asD1(database));
  const loadUndeletedTarget = persistence.loadUndeletedTarget.bind(persistence);
  let shouldMoveAfterRead = true;
  persistence.loadUndeletedTarget = async (input) => {
    const target = await loadUndeletedTarget(input);
    if (target && shouldMoveAfterRead) {
      shouldMoveAfterRead = false;
      database
        .prepare("UPDATE external_dj_links SET venue_id = ? WHERE id = ?")
        .run("venue-b", input.linkId);
    }
    return target;
  };

  await assert.rejects(
    deleteAdminExternalLink(
      { linkId: "stale-delete-venue", actor: actor() },
      { persistence, now: () => new Date(NOW) },
    ),
    assertLifecycleError("NOT_FOUND"),
  );
  assert.deepEqual(
    {
      ...database
        .prepare(`
          SELECT venue_id AS venueId, active, deleted_at AS deletedAt
          FROM external_dj_links WHERE id = 'stale-delete-venue'
        `)
        .get(),
    },
    { venueId: "venue-b", active: 1, deletedAt: null },
  );
  database.close();
});

test("delete rejects a venue disabled after the authorization read", async () => {
  const database = createDatabase();
  insertLink(database, { id: "stale-delete-active", active: 1 });
  const persistence = createExternalLinkLifecyclePersistence(asD1(database));
  const isVenueActive = persistence.isVenueActive.bind(persistence);
  let shouldDisableAfterRead = true;
  persistence.isVenueActive = async (venueId) => {
    const isActive = await isVenueActive(venueId);
    if (isActive && shouldDisableAfterRead) {
      shouldDisableAfterRead = false;
      database.prepare("UPDATE venues SET active = 0 WHERE id = ?").run(venueId);
    }
    return isActive;
  };

  await assert.rejects(
    deleteAdminExternalLink(
      { linkId: "stale-delete-active", actor: actor() },
      { persistence, now: () => new Date(NOW) },
    ),
    assertLifecycleError("VENUE_UNAVAILABLE"),
  );
  assert.deepEqual(
    {
      ...database
        .prepare(`
          SELECT active, deleted_at AS deletedAt
          FROM external_dj_links WHERE id = 'stale-delete-active'
        `)
        .get(),
    },
    { active: 1, deletedAt: null },
  );
  database.close();
});

test("delete rejects stale actor snapshots at the first final mutation", async (t) => {
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
      const linkId = `stale-actor-${mutation.name.replaceAll(" ", "-")}`;
      insertLink(database, { id: linkId, active: 1 });
      const persistence = createExternalLinkLifecyclePersistence(asD1(database));
      const finalWrite = persistence.deleteManaged.bind(persistence);
      persistence.deleteManaged = async (input) => {
        database.exec(mutation.sql);
        return finalWrite(input);
      };

      await assert.rejects(
        deleteAdminExternalLink(
          { linkId, actor: actor() },
          { persistence, now: () => new Date(NOW) },
        ),
        assertLifecycleError("NOT_FOUND"),
      );
      assert.deepEqual(
        {
          ...database
            .prepare(`
              SELECT active, deleted_at AS deletedAt
              FROM external_dj_links WHERE id = ?
            `)
            .get(linkId),
        },
        { active: 1, deletedAt: null },
      );
      database.close();
    });
  }
});

test("atomic delete dispositions recheck the active venue without partial deactivation", async () => {
  for (const disposition of ["archive", "hard-delete"]) {
    const database = createDatabase();
    const linkId = `stale-${disposition}`;
    insertLink(database, { id: linkId, active: 1 });
    if (disposition === "archive") {
      database
        .prepare("INSERT INTO guests (id, external_link_id, status) VALUES (?, ?, ?)")
        .run("guest-history", linkId, "deleted");
    }
    const persistence = createExternalLinkLifecyclePersistence(asD1(database));
    const finalWrite = persistence.deleteManaged.bind(persistence);
    persistence.deleteManaged = async (input) => {
      database.prepare("UPDATE venues SET active = 0 WHERE id = ?").run("venue-a");
      return finalWrite(input);
    };

    await assert.rejects(
      deleteAdminExternalLink(
        { linkId, actor: actor() },
        { persistence, now: () => new Date(NOW) },
      ),
      assertLifecycleError("VENUE_UNAVAILABLE"),
    );
    assert.deepEqual(
      {
        ...database
          .prepare(`
            SELECT active, deleted_at AS deletedAt
            FROM external_dj_links WHERE id = ?
          `)
          .get(linkId),
      },
      { active: 1, deletedAt: null },
    );
    database.close();
  }
});

test("atomic delete dispositions reject a revoked actor without partial deactivation", async () => {
  for (const disposition of ["archive", "hard-delete"]) {
    const database = createDatabase();
    const linkId = `stale-actor-${disposition}`;
    insertLink(database, { id: linkId, active: 1 });
    if (disposition === "archive") {
      database
        .prepare("INSERT INTO guests (id, external_link_id, status) VALUES (?, ?, ?)")
        .run("guest-history", linkId, "deleted");
    }
    const persistence = createExternalLinkLifecyclePersistence(asD1(database));
    const finalWrite = persistence.deleteManaged.bind(persistence);
    persistence.deleteManaged = async (input) => {
      database
        .prepare("UPDATE users SET session_version = 8 WHERE id = ?")
        .run("venue-admin-a");
      return finalWrite(input);
    };

    await assert.rejects(
      deleteAdminExternalLink(
        { linkId, actor: actor() },
        { persistence, now: () => new Date(NOW) },
      ),
      assertLifecycleError("NOT_FOUND"),
    );
    assert.deepEqual(
      {
        ...database
          .prepare(`
            SELECT active, deleted_at AS deletedAt
            FROM external_dj_links WHERE id = ?
          `)
          .get(linkId),
      },
      { active: 1, deletedAt: null },
    );
    database.close();
  }
});

test("atomic delete dispositions preserve the expected venue without partial deactivation", async () => {
  for (const disposition of ["archive", "hard-delete"]) {
    const database = createDatabase();
    const linkId = `stale-venue-${disposition}`;
    insertLink(database, { id: linkId, active: 1 });
    if (disposition === "archive") {
      database
        .prepare("INSERT INTO guests (id, external_link_id, status) VALUES (?, ?, ?)")
        .run("guest-history", linkId, "deleted");
    }
    const persistence = createExternalLinkLifecyclePersistence(asD1(database));
    const finalWrite = persistence.deleteManaged.bind(persistence);
    persistence.deleteManaged = async (input) => {
      database
        .prepare("UPDATE external_dj_links SET venue_id = ? WHERE id = ?")
        .run("venue-b", linkId);
      return finalWrite(input);
    };

    await assert.rejects(
      deleteAdminExternalLink(
        { linkId, actor: actor() },
        { persistence, now: () => new Date(NOW) },
      ),
      assertLifecycleError("NOT_FOUND"),
    );
    assert.deepEqual(
      {
        ...database
          .prepare(`
            SELECT venue_id AS venueId, active, deleted_at AS deletedAt
            FROM external_dj_links WHERE id = ?
          `)
          .get(linkId),
      },
      { venueId: "venue-b", active: 1, deletedAt: null },
    );
    database.close();
  }
});
