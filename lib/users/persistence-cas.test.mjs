import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createUserPersistence } from "./persistence.ts";

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
      legacy_auth_user_id TEXT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      contributor_id TEXT,
      role TEXT NOT NULL,
      account_kind TEXT NOT NULL,
      door_access_enabled INTEGER NOT NULL,
      venue_id TEXT REFERENCES venues(id),
      guest_limit INTEGER,
      active INTEGER NOT NULL,
      session_version INTEGER NOT NULL,
      migration_status TEXT NOT NULL,
      migrated_at TEXT,
      password_set_at TEXT,
      preferred_locale TEXT,
      last_login_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE password_reset_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE user_audit_events (
      id TEXT PRIMARY KEY,
      venue_id TEXT,
      actor_user_id TEXT,
      target_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO venues (id, active) VALUES ('venue-a', 1), ('venue-b', 1);
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
      async all() {
        return { results: database.prepare(statement).all(...values) };
      },
      async first() {
        return database.prepare(statement).get(...values) ?? null;
      },
      async raw() {
        return database
          .prepare(statement)
          .all(...values)
          .map((row) => Object.values(row));
      },
      async run() {
        if (/\bRETURNING\b/i.test(statement)) {
          const results = database.prepare(statement).all(...values);
          return {
            success: true,
            results,
            meta: { changes: results.length },
          };
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

function insertUser(database, {
  id,
  role,
  venueId,
  active = 1,
  name = id,
}) {
  database.prepare(`
    INSERT INTO users (
      id, email, password_hash, name, role, account_kind,
      door_access_enabled, venue_id, guest_limit, active, session_version,
      migration_status, password_set_at, preferred_locale, created_at
    ) VALUES (?, ?, 'hash', ?, ?, 'personal', 0, ?, 10, ?, 3, 'active', ?, 'ko', ?)
  `).run(id, `${id}@example.com`, name, role, venueId, active, NOW, NOW);
}

function insertOpenCredentials(database, userId) {
  database.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used, created_at)
    VALUES (?, ?, ?, '2026-08-30T00:00:00.000Z', 0, ?)
  `).run(`token-${userId}`, userId, `hash-${userId}`, NOW);
  database.prepare(`
    INSERT INTO password_reset_requests (id, user_id, status, updated_at)
    VALUES (?, ?, 'pending', ?)
  `).run(`request-${userId}`, userId, NOW);
}

function actor(id, role, venueId) {
  return { id, role, venueId, sessionVersion: 3 };
}

function audit(id, action = "deactivated") {
  return {
    id,
    action,
    details: { fields: ["active"] },
    createdAt: NOW,
  };
}

test("profile CAS blocks an inactive venue and leaves audit and credentials untouched", async () => {
  const database = createDatabase();
  insertUser(database, {
    id: "admin-a",
    role: "venue_admin",
    venueId: "venue-a",
  });
  insertUser(database, { id: "staff-a", role: "staff", venueId: "venue-a" });
  insertOpenCredentials(database, "staff-a");
  const persistence = createUserPersistence(asD1(database));
  const target = await persistence.loadUser("staff-a");
  database.prepare("UPDATE venues SET active = 0 WHERE id = 'venue-a'").run();

  const updated = await persistence.updateProfile({
    target,
    actor: actor("admin-a", "venue_admin", "venue-a"),
    isSelfUpdate: false,
    values: { active: false },
    incrementsSessionVersion: true,
    invalidatesCredentials: true,
    audit: audit("audit-blocked"),
  });

  assert.equal(updated, false);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT active, session_version AS sessionVersion
      FROM users WHERE id = 'staff-a'
    `).get() },
    { active: 1, sessionVersion: 3 },
  );
  assert.equal(database.prepare("SELECT count(*) AS value FROM user_audit_events").get().value, 0);
  assert.equal(database.prepare("SELECT used FROM password_reset_tokens").get().used, 0);
  assert.equal(database.prepare("SELECT status FROM password_reset_requests").get().status, "pending");
});

test("profile CAS serializes competing super-admin deactivations without leaving zero active", async () => {
  const database = createDatabase();
  insertUser(database, { id: "super-a", role: "super_admin", venueId: null });
  insertUser(database, { id: "super-b", role: "super_admin", venueId: null });
  const persistence = createUserPersistence(asD1(database));
  const targetA = await persistence.loadUser("super-a");
  const targetB = await persistence.loadUser("super-b");

  const first = await persistence.updateProfile({
    target: targetB,
    actor: actor("super-a", "super_admin", null),
    isSelfUpdate: false,
    values: { active: false },
    incrementsSessionVersion: true,
    invalidatesCredentials: true,
    audit: audit("audit-first"),
  });
  const second = await persistence.updateProfile({
    target: targetA,
    actor: actor("super-b", "super_admin", null),
    isSelfUpdate: false,
    values: { active: false },
    incrementsSessionVersion: true,
    invalidatesCredentials: true,
    audit: audit("audit-second"),
  });

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(
    database.prepare(`
      SELECT count(*) AS value FROM users
      WHERE role = 'super_admin' AND active = 1 AND deleted_at IS NULL
    `).get().value,
    1,
  );
  assert.deepEqual(
    database
      .prepare("SELECT id FROM user_audit_events ORDER BY id")
      .all()
      .map((row) => ({ ...row })),
    [{ id: "audit-first" }],
  );
});

test("profile CAS independently keeps a lone super admin active", async () => {
  const database = createDatabase();
  insertUser(database, { id: "super-a", role: "super_admin", venueId: null });
  const persistence = createUserPersistence(asD1(database));
  const target = await persistence.loadUser("super-a");

  const updated = await persistence.updateProfile({
    target,
    actor: actor("super-a", "super_admin", null),
    isSelfUpdate: true,
    values: { active: false },
    incrementsSessionVersion: true,
    invalidatesCredentials: true,
    audit: null,
  });

  assert.equal(updated, false);
  assert.equal(database.prepare("SELECT active FROM users WHERE id = 'super-a'").get().active, 1);
});

test("profile CAS rejects an actor whose authenticated session snapshot was revoked", async () => {
  const database = createDatabase();
  insertUser(database, {
    id: "admin-a",
    role: "venue_admin",
    venueId: "venue-a",
  });
  insertUser(database, { id: "staff-a", role: "staff", venueId: "venue-a" });
  const persistence = createUserPersistence(asD1(database));
  const target = await persistence.loadUser("staff-a");
  database.prepare(`
    UPDATE users SET session_version = session_version + 1 WHERE id = 'admin-a'
  `).run();

  const updated = await persistence.updateProfile({
    target,
    actor: actor("admin-a", "venue_admin", "venue-a"),
    isSelfUpdate: false,
    values: { name: "Changed" },
    incrementsSessionVersion: false,
    invalidatesCredentials: false,
    audit: audit("audit-revoked", "user_updated"),
  });

  assert.equal(updated, false);
  assert.equal(database.prepare("SELECT name FROM users WHERE id = 'staff-a'").get().name, "staff-a");
  assert.equal(database.prepare("SELECT count(*) AS value FROM user_audit_events").get().value, 0);
});

test("profile persistence independently rejects a deleted target snapshot", async () => {
  const database = createDatabase();
  insertUser(database, {
    id: "admin-a",
    role: "venue_admin",
    venueId: "venue-a",
  });
  insertUser(database, { id: "staff-a", role: "staff", venueId: "venue-a" });
  database.prepare("UPDATE users SET deleted_at = ? WHERE id = 'staff-a'").run(NOW);
  const persistence = createUserPersistence(asD1(database));
  const deletedTarget = await persistence.loadUser("staff-a");

  const updated = await persistence.updateProfile({
    target: deletedTarget,
    actor: actor("admin-a", "venue_admin", "venue-a"),
    isSelfUpdate: false,
    values: { name: "Changed" },
    incrementsSessionVersion: false,
    invalidatesCredentials: false,
    audit: audit("audit-deleted", "user_updated"),
  });

  assert.equal(updated, false);
  assert.equal(database.prepare("SELECT name FROM users WHERE id = 'staff-a'").get().name, "staff-a");
  assert.equal(database.prepare("SELECT count(*) AS value FROM user_audit_events").get().value, 0);
});

test("successful guarded profile update commits session, credential, and audit changes together", async () => {
  const database = createDatabase();
  insertUser(database, {
    id: "admin-a",
    role: "venue_admin",
    venueId: "venue-a",
  });
  insertUser(database, { id: "staff-a", role: "staff", venueId: "venue-a" });
  insertOpenCredentials(database, "staff-a");
  const persistence = createUserPersistence(asD1(database));
  const target = await persistence.loadUser("staff-a");

  const updated = await persistence.updateProfile({
    target,
    actor: actor("admin-a", "venue_admin", "venue-a"),
    isSelfUpdate: false,
    values: { active: false },
    incrementsSessionVersion: true,
    invalidatesCredentials: true,
    audit: audit("audit-success"),
  });

  assert.equal(updated, true);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT active, session_version AS sessionVersion
      FROM users WHERE id = 'staff-a'
    `).get() },
    { active: 0, sessionVersion: 4 },
  );
  assert.equal(database.prepare("SELECT id FROM user_audit_events").get().id, "audit-success");
  assert.equal(database.prepare("SELECT used FROM password_reset_tokens").get().used, 1);
  assert.equal(database.prepare("SELECT status FROM password_reset_requests").get().status, "cancelled");
});

test("delete CAS rejects a reactivated target without tombstoning or side effects", async () => {
  const database = createDatabase();
  insertUser(database, {
    id: "admin-a",
    role: "venue_admin",
    venueId: "venue-a",
  });
  insertUser(database, {
    id: "staff-a",
    role: "staff",
    venueId: "venue-a",
    active: 0,
  });
  insertOpenCredentials(database, "staff-a");
  const persistence = createUserPersistence(asD1(database));
  const target = await persistence.loadUser("staff-a");
  database.prepare("UPDATE users SET active = 1 WHERE id = 'staff-a'").run();

  const deleted = await persistence.deleteUser({
    target,
    actor: actor("admin-a", "venue_admin", "venue-a"),
    passwordHash: "deleted-hash",
    tombstoneEmail: "deleted+staff-a@deleted.invalid",
    deletedAt: NOW,
    auditId: "delete-blocked",
  });

  assert.equal(deleted, false);
  assert.deepEqual(
    {
      ...database
        .prepare("SELECT email, deleted_at AS deletedAt FROM users WHERE id = 'staff-a'")
        .get(),
    },
    { email: "staff-a@example.com", deletedAt: null },
  );
  assert.equal(database.prepare("SELECT count(*) AS value FROM user_audit_events").get().value, 0);
  assert.equal(database.prepare("SELECT used FROM password_reset_tokens").get().used, 0);
  assert.equal(database.prepare("SELECT status FROM password_reset_requests").get().status, "pending");

  database.prepare("UPDATE users SET active = 0 WHERE id = 'staff-a'").run();
  database.prepare(`
    UPDATE users SET session_version = session_version + 1 WHERE id = 'admin-a'
  `).run();
  assert.equal(
    await persistence.deleteUser({
      target,
      actor: actor("admin-a", "venue_admin", "venue-a"),
      passwordHash: "deleted-hash",
      tombstoneEmail: "deleted+staff-a@deleted.invalid",
      deletedAt: NOW,
      auditId: "delete-revoked",
    }),
    false,
  );
  assert.equal(database.prepare("SELECT deleted_at AS value FROM users WHERE id = 'staff-a'").get().value, null);
  assert.equal(database.prepare("SELECT count(*) AS value FROM user_audit_events").get().value, 0);

  database.prepare("UPDATE users SET session_version = 3 WHERE id = 'admin-a'").run();
  const guardedDelete = await persistence.deleteUser({
    target,
    actor: actor("admin-a", "venue_admin", "venue-a"),
    passwordHash: "deleted-hash",
    tombstoneEmail: "deleted+staff-a@deleted.invalid",
    deletedAt: NOW,
    auditId: "delete-success",
  });
  assert.equal(guardedDelete, true);
  assert.deepEqual(
    {
      ...database.prepare(`
        SELECT email, name, active, deleted_at AS deletedAt,
               deleted_by AS deletedBy, session_version AS sessionVersion
        FROM users WHERE id = 'staff-a'
      `).get(),
    },
    {
      email: "deleted+staff-a@deleted.invalid",
      name: "Deleted user",
      active: 0,
      deletedAt: NOW,
      deletedBy: "admin-a",
      sessionVersion: 4,
    },
  );
  assert.equal(database.prepare("SELECT id FROM user_audit_events").get().id, "delete-success");
  assert.equal(database.prepare("SELECT used FROM password_reset_tokens").get().used, 1);
  assert.equal(database.prepare("SELECT status FROM password_reset_requests").get().status, "cancelled");
});

test("managed user creation is atomic and rechecks the actor and active venue", async () => {
  const database = createDatabase();
  insertUser(database, {
    id: "admin-a",
    role: "venue_admin",
    venueId: "venue-a",
  });
  const persistence = createUserPersistence(asD1(database));
  const input = {
    actor: actor("admin-a", "venue_admin", "venue-a"),
    user: {
      id: "staff-new",
      email: "staff-new@example.com",
      name: "Staff New",
      role: "staff",
      accountKind: "personal",
      doorAccessEnabled: false,
      venueId: "venue-a",
      guestLimit: 7,
      passwordHash: "invited-hash",
      preferredLocale: "ko",
      createdAt: NOW,
    },
    invitation: {
      id: "invitation-new",
      tokenHash: "token-hash-new",
      expiresAt: "2026-08-30T00:00:00.000Z",
    },
    audit: {
      id: "audit-create",
      details: { role: "staff" },
    },
  };
  database.prepare("UPDATE venues SET active = 0 WHERE id = 'venue-a'").run();

  assert.equal(await persistence.createUser(input), false);
  assert.equal(database.prepare("SELECT count(*) AS value FROM users WHERE id = 'staff-new'").get().value, 0);
  assert.equal(database.prepare("SELECT count(*) AS value FROM password_reset_tokens").get().value, 0);
  assert.equal(database.prepare("SELECT count(*) AS value FROM user_audit_events").get().value, 0);

  database.prepare("UPDATE venues SET active = 1 WHERE id = 'venue-a'").run();
  database.prepare(`
    UPDATE users SET session_version = session_version + 1 WHERE id = 'admin-a'
  `).run();
  assert.equal(await persistence.createUser(input), false);
  assert.equal(database.prepare("SELECT count(*) AS value FROM users WHERE id = 'staff-new'").get().value, 0);
  assert.equal(database.prepare("SELECT count(*) AS value FROM password_reset_tokens").get().value, 0);
  assert.equal(database.prepare("SELECT count(*) AS value FROM user_audit_events").get().value, 0);

  database.prepare("UPDATE users SET session_version = 3 WHERE id = 'admin-a'").run();
  assert.equal(await persistence.createUser(input), true);
  assert.equal(database.prepare("SELECT migration_status AS value FROM users WHERE id = 'staff-new'").get().value, "pending_reset");
  assert.equal(database.prepare("SELECT user_id AS value FROM password_reset_tokens WHERE id = 'invitation-new'").get().value, "staff-new");
  assert.equal(database.prepare("SELECT target_user_id AS value FROM user_audit_events WHERE id = 'audit-create'").get().value, "staff-new");
});
