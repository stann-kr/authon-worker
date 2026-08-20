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
      id TEXT PRIMARY KEY
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
    INSERT INTO users (id) VALUES ('super-admin'), ('venue-admin-a'), ('venue-admin-b');
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
        async first() {
          return database.prepare(statement).get(...values) ?? null;
        },
        async run() {
          return database.prepare(statement).run(...values);
        },
      };
    },
  };
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
  venueId = "venue-a",
} = {}) {
  return { userId, role, venueId };
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

test("a stale lifecycle read preserves the legacy id-only activation write", async () => {
  const database = createDatabase();
  insertLink(database, { id: "stale-link", active: 0 });
  const persistence = createExternalLinkLifecyclePersistence(asD1(database));
  const loadUndeletedTarget = persistence.loadUndeletedTarget.bind(persistence);
  persistence.loadUndeletedTarget = async (input) => {
    const target = await loadUndeletedTarget(input);
    database.prepare(`
      UPDATE external_dj_links
      SET deleted_at = ?, deleted_by = ?
      WHERE id = ?
    `).run(NOW, "venue-admin-a", input.linkId);
    return target;
  };

  await activateAdminExternalLink(
    { linkId: "stale-link", actor: actor() },
    { persistence, now: () => new Date(NOW) },
  );

  assert.deepEqual(
    { ...database.prepare(`
      SELECT active, deleted_at AS deletedAt FROM external_dj_links WHERE id = 'stale-link'
    `).get() },
    { active: 1, deletedAt: NOW },
  );
  database.close();
});
