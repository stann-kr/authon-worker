import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

await import("tsx");
const [
  { createLoginPersistence },
  { createAccountClaimPersistence },
  { createProfilePasswordPersistence },
  credentialSql,
  resetSql,
] = await Promise.all([
  import("./login-persistence.ts"),
  import("./account-claim-persistence.ts"),
  import("./profile-password-persistence.ts"),
  import("./credential-lifecycle-sql.ts"),
  import("./password-reset-lifecycle-sql.ts"),
]);

const NOW = "2026-08-23T12:00:00.000Z";
const FUTURE = "2026-08-23T12:30:00.000Z";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
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
      timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
      opening_time TEXT NOT NULL DEFAULT '22:00',
      closing_time TEXT NOT NULL DEFAULT '06:00',
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
      venue_id TEXT,
      guest_limit INTEGER,
      active INTEGER NOT NULL,
      session_version INTEGER NOT NULL,
      migration_status TEXT NOT NULL,
      migrated_at TEXT,
      password_set_at TEXT,
      preferred_locale TEXT,
      last_login_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE password_reset_requests (
      id TEXT PRIMARY KEY,
      venue_id TEXT,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      setup_method TEXT,
      decided_by_user_id TEXT,
      decided_at TEXT,
      expires_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL
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
    INSERT INTO venues (id, name, type, active)
      VALUES ('venue-a', 'Venue A', 'club', 1);
  `);
  return database;
}

function insertUser(database, overrides = {}) {
  const user = {
    id: "user-a",
    email: "staff@example.com",
    passwordHash: "setup-hash",
    name: "Staff",
    role: "staff",
    accountKind: "personal",
    doorAccessEnabled: 0,
    venueId: "venue-a",
    guestLimit: 12,
    active: 1,
    sessionVersion: 7,
    migrationStatus: "pending_reset",
    passwordSetAt: null,
    preferredLocale: "ko",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
  database.prepare(`
    INSERT INTO users (
      id, email, password_hash, name, role, account_kind,
      door_access_enabled, venue_id, guest_limit, active, session_version,
      migration_status, password_set_at, preferred_locale, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.email,
    user.passwordHash,
    user.name,
    user.role,
    user.accountKind,
    user.doorAccessEnabled,
    user.venueId,
    user.guestLimit,
    user.active,
    user.sessionVersion,
    user.migrationStatus,
    user.passwordSetAt,
    user.preferredLocale,
    user.createdAt,
  );
}

function insertResetRequest(database, overrides = {}) {
  const request = {
    id: "setup-request",
    venueId: "venue-a",
    userId: "user-a",
    source: "manual",
    status: "approved",
    setupMethod: "setup_code",
    decidedByUserId: "admin-a",
    decidedAt: "2026-08-23T11:59:00.000Z",
    expiresAt: FUTURE,
    createdAt: "2026-08-23T11:00:00.000Z",
    updatedAt: "2026-08-23T11:59:00.000Z",
    ...overrides,
  };
  database.prepare(`
    INSERT INTO password_reset_requests (
      id, venue_id, user_id, source, status, setup_method,
      decided_by_user_id, decided_at, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    request.id,
    request.venueId,
    request.userId,
    request.source,
    request.status,
    request.setupMethod,
    request.decidedByUserId,
    request.decidedAt,
    request.expiresAt,
    request.createdAt,
    request.updatedAt,
  );
}

function createSqliteD1(database) {
  const bindCalls = [];

  function prepare(sql) {
    let values = [];
    const statement = {
      bind(...nextValues) {
        values = nextValues;
        bindCalls.push({ sql, values: [...nextValues] });
        return statement;
      },
      async first(columnName) {
        const row = database.prepare(sql).get(...values) ?? null;
        return columnName && row ? row[columnName] : row;
      },
      async all() {
        return {
          success: true,
          results: database.prepare(sql).all(...values),
          meta: {},
        };
      },
      async raw() {
        const sqliteStatement = database.prepare(sql);
        sqliteStatement.setReturnArrays(true);
        return sqliteStatement.all(...values);
      },
      async run() {
        const result = database.prepare(sql).run(...values);
        return {
          success: true,
          results: [],
          meta: { changes: result.changes },
        };
      },
      executeBatch() {
        if (/\bRETURNING\b/i.test(sql)) {
          return {
            success: true,
            results: database.prepare(sql).all(...values),
            meta: {},
          };
        }
        const result = database.prepare(sql).run(...values);
        return {
          success: true,
          results: [],
          meta: { changes: result.changes },
        };
      },
    };
    return statement;
  }

  return {
    bindCalls,
    prepare,
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.executeBatch());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function findBind(d1, sql) {
  return d1.bindCalls.find((call) => call.sql === sql)?.values;
}

test("login persistence executes candidate mapping and ordered D1 bind/result mapping", async () => {
  const database = createDatabase();
  insertUser(database, {
    migrationStatus: "active",
    passwordSetAt: "2026-08-01T00:00:00.000Z",
  });
  insertResetRequest(database);
  const d1 = createSqliteD1(database);
  const persistence = createLoginPersistence({ DB: d1 });

  const candidate = await persistence.findCandidate("staff@example.com");
  assert.deepEqual(
    {
      id: candidate.id,
      email: candidate.email,
      passwordHash: candidate.passwordHash,
      doorAccessEnabled: candidate.doorAccessEnabled,
      venueId: candidate.venueId,
      venueActive: candidate.venueActive,
      guestLimit: candidate.guestLimit,
      active: candidate.active,
      sessionVersion: candidate.sessionVersion,
      preferredLocale: candidate.preferredLocale,
    },
    {
      id: "user-a",
      email: "staff@example.com",
      passwordHash: "setup-hash",
      doorAccessEnabled: false,
      venueId: "venue-a",
      venueActive: true,
      guestLimit: 12,
      active: true,
      sessionVersion: 7,
      preferredLocale: "ko",
    },
  );
  assert.deepEqual(d1.bindCalls[0].values, ["staff@example.com", 1]);

  assert.deepEqual(await persistence.findLatestSetupCodeRequest("user-a"), {
    status: "approved",
    setupMethod: "setup_code",
    expiresAt: FUTURE,
  });
  assert.deepEqual(
    findBind(d1, credentialSql.SELECT_LATEST_SETUP_CODE_REQUEST_SQL),
    ["user-a"],
  );

  assert.equal(await persistence.commitLogin({
    user: candidate,
    passwordHash: "rehash-a",
    nowIso: NOW,
  }), 7);
  assert.deepEqual(
    findBind(d1, credentialSql.UPDATE_USER_FOR_LOGIN_SQL),
    [NOW, "rehash-a", "user-a", "setup-hash", 7],
  );
  assert.deepEqual(
    findBind(d1, credentialSql.CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL),
    [NOW, "user-a"],
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT password_hash, last_login_at FROM users WHERE id = 'user-a'
    `).get() },
    { password_hash: "rehash-a", last_login_at: NOW },
  );
  assert.equal(
    database.prepare("SELECT status FROM password_reset_requests WHERE id = 'setup-request'").get().status,
    "cancelled",
  );
  database.close();
});

test("account-claim persistence executes tenant candidate binds and maps the one-winner batch", async () => {
  const database = createDatabase();
  insertUser(database);
  insertUser(database, {
    id: "admin-a",
    email: "admin@example.com",
    passwordHash: "admin-hash",
    name: "Admin",
    role: "venue_admin",
    guestLimit: null,
    sessionVersion: 3,
    migrationStatus: "active",
    passwordSetAt: "2026-08-01T00:00:00.000Z",
    preferredLocale: null,
  });
  insertResetRequest(database);
  insertResetRequest(database, {
    id: "browser-request",
    source: "self_service",
    setupMethod: "admin_approved",
    decidedAt: "2026-08-23T11:58:00.000Z",
    createdAt: "2026-08-23T10:00:00.000Z",
  });
  database.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
    VALUES ('token-a', 'user-a', 'reset-token-a', ?, 0)
  `).run(FUTURE);
  const d1 = createSqliteD1(database);
  const persistence = createAccountClaimPersistence(d1);

  const browserCandidate = await persistence.findBrowserReceiptCandidate({
    requestId: "browser-request",
    nowIso: NOW,
    expectedVenueId: "venue-a",
  });
  assert.equal(browserCandidate.request_id, "browser-request");
  assert.equal(browserCandidate.setup_method, "admin_approved");
  const browserBind = d1.bindCalls.find((call) =>
    call.sql.includes("FROM password_reset_requests pr") &&
    call.sql.includes("pr.source = 'self_service'")
  );
  assert.deepEqual(browserBind.values, [
    "browser-request",
    NOW,
    "venue-a",
    "venue-a",
  ]);

  const setupCandidate = await persistence.findSetupCodeCandidate({
    email: "staff@example.com",
    nowIso: NOW,
    expectedVenueId: "venue-a",
  });
  assert.deepEqual(
    {
      id: setupCandidate.id,
      requestId: setupCandidate.request_id,
      setupMethod: setupCandidate.setup_method,
      hasHistory: setupCandidate.has_setup_code_history,
    },
    {
      id: "user-a",
      requestId: "setup-request",
      setupMethod: "setup_code",
      hasHistory: 1,
    },
  );
  const setupBind = d1.bindCalls.find((call) =>
    call.sql.includes("WHERE u.email = ?")
  );
  assert.deepEqual(setupBind.values, [
    NOW,
    "staff@example.com",
    "venue-a",
    "venue-a",
  ]);

  assert.equal(await persistence.consumeClaim({
    candidate: setupCandidate,
    expectedVenueId: "venue-a",
    passwordHash: "claimed-hash",
    credentialChangedAt: NOW,
    operationId: "claim-audit",
    claimMethod: "manual_setup_code",
    exactRequestId: "setup-request",
  }), "user-a");
  assert.deepEqual(
    findBind(d1, resetSql.UPDATE_USER_WITH_APPROVED_RESET_SQL),
    [
      "claimed-hash",
      NOW,
      "user-a",
      "setup-hash",
      7,
      "venue-a",
      "venue-a",
      "manual_setup_code",
      "manual_setup_code",
      "setup-request",
      "setup_code",
      NOW,
    ],
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT password_hash, session_version, migration_status, password_set_at
      FROM users WHERE id = 'user-a'
    `).get() },
    {
      password_hash: "claimed-hash",
      session_version: 8,
      migration_status: "active",
      password_set_at: NOW,
    },
  );
  assert.equal(
    database.prepare("SELECT status FROM password_reset_requests WHERE id = 'setup-request'").get().status,
    "completed",
  );
  assert.equal(
    database.prepare("SELECT status FROM password_reset_requests WHERE id = 'browser-request'").get().status,
    "cancelled",
  );
  assert.equal(
    database.prepare("SELECT used FROM password_reset_tokens WHERE id = 'token-a'").get().used,
    1,
  );
  assert.equal(
    database.prepare("SELECT target_user_id FROM user_audit_events WHERE id = 'claim-audit'").get().target_user_id,
    "user-a",
  );
  database.close();
});

test("profile-password persistence maps Drizzle reads, CAS batch results, and KV session keys", async () => {
  const database = createDatabase();
  insertUser(database, {
    passwordHash: "old-hash",
    migrationStatus: "active",
    passwordSetAt: "2026-08-01T00:00:00.000Z",
  });
  insertResetRequest(database, { status: "pending", setupMethod: null });
  database.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
    VALUES ('token-a', 'user-a', 'reset-token-a', ?, 0)
  `).run(FUTURE);
  const d1 = createSqliteD1(database);
  const deletedKeys = [];
  const persistence = createProfilePasswordPersistence({
    DB: d1,
    SESSIONS: {
      async delete(key) {
        deletedKeys.push(key);
      },
    },
  });

  const user = await persistence.loadUser("user-a");
  assert.deepEqual(user, {
    id: "user-a",
    venueId: "venue-a",
    passwordHash: "old-hash",
    sessionVersion: 7,
    active: true,
  });
  assert.deepEqual(d1.bindCalls[0].values, ["user-a", 1]);

  assert.deepEqual(await persistence.commitChange({
    user,
    passwordHash: "profile-hash",
    nowIso: NOW,
    auditEventId: "profile-audit",
  }), {
    updatedUserId: "user-a",
    auditedUserId: "user-a",
  });
  assert.deepEqual(
    findBind(d1, credentialSql.UPDATE_PROFILE_PASSWORD_CAS_SQL),
    ["profile-hash", NOW, "user-a", "old-hash", 7],
  );
  assert.deepEqual(
    findBind(d1, credentialSql.INSERT_PROFILE_PASSWORD_AUDIT_SQL),
    [
      "profile-audit",
      JSON.stringify({ method: "authenticated_profile" }),
      NOW,
      "user-a",
    ],
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT password_hash, session_version FROM users WHERE id = 'user-a'
    `).get() },
    { password_hash: "profile-hash", session_version: 8 },
  );
  assert.equal(
    database.prepare("SELECT used FROM password_reset_tokens WHERE id = 'token-a'").get().used,
    1,
  );
  assert.equal(
    database.prepare("SELECT status FROM password_reset_requests WHERE id = 'setup-request'").get().status,
    "cancelled",
  );

  await persistence.deleteSession("session-a");
  assert.deepEqual(deletedKeys, ["session:session-a"]);
  database.close();
});
