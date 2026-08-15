import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ACTIVATE_MANAGED_PASSWORD_LINK_SQL,
  CANCEL_MANAGED_PASSWORD_RESET_REQUESTS_SQL,
  INSERT_MANAGED_PASSWORD_LINK_AUDIT_SQL,
  INVALIDATE_OTHER_MANAGED_PASSWORD_LINKS_SQL,
} from "./password-link-lifecycle-sql.ts";

function extractSql(relativePath, constantName) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const match = source.match(
    new RegExp("const " + constantName + " = `([\\s\\S]*?)`;"),
  );
  assert.ok(match, `${constantName} SQL을 찾을 수 없습니다.`);
  return match[1];
}

const profileSql = {
  updatePassword: extractSql(
    "../../app/api/profile/password/route.ts",
    "UPDATE_PROFILE_PASSWORD_CAS_SQL",
  ),
  insertAudit: extractSql(
    "../../app/api/profile/password/route.ts",
    "INSERT_PROFILE_PASSWORD_AUDIT_SQL",
  ),
  invalidateTokens: extractSql(
    "../../app/api/profile/password/route.ts",
    "INVALIDATE_PROFILE_RESET_TOKENS_SQL",
  ),
  cancelRequests: extractSql(
    "../../app/api/profile/password/route.ts",
    "CANCEL_PROFILE_RESET_REQUESTS_SQL",
  ),
};

const tokenSql = {
  selectCandidate: extractSql(
    "../../app/api/auth/reset-password/route.ts",
    "SELECT_VALID_RESET_TOKEN_CANDIDATE_SQL",
  ),
  updatePassword: extractSql(
    "../../app/api/auth/reset-password/route.ts",
    "UPDATE_PASSWORD_WITH_VALID_TOKEN_SQL",
  ),
  consumeExactToken: extractSql(
    "../../app/api/auth/reset-password/route.ts",
    "CONSUME_EXACT_RESET_TOKEN_SQL",
  ),
  insertAudit: extractSql(
    "../../app/api/auth/reset-password/route.ts",
    "INSERT_TOKEN_RESET_AUDIT_SQL",
  ),
  invalidateAllTokens: extractSql(
    "../../app/api/auth/reset-password/route.ts",
    "INVALIDATE_ALL_USER_RESET_TOKENS_SQL",
  ),
  completeRequests: extractSql(
    "../../app/api/auth/reset-password/route.ts",
    "COMPLETE_TOKEN_RESET_REQUESTS_SQL",
  ),
};

const passwordLinkSql = {
  invalidateOtherLinks: INVALIDATE_OTHER_MANAGED_PASSWORD_LINKS_SQL,
  activateLink: ACTIVATE_MANAGED_PASSWORD_LINK_SQL,
  insertAudit: INSERT_MANAGED_PASSWORD_LINK_AUDIT_SQL,
  cancelRequests: CANCEL_MANAGED_PASSWORD_RESET_REQUESTS_SQL,
};

const loginSql = {
  selectLatestSetupCodeRequest: extractSql(
    "../../app/api/auth/login/route.ts",
    "SELECT_LATEST_SETUP_CODE_REQUEST_SQL",
  ),
  updateUser: extractSql(
    "../../app/api/auth/login/route.ts",
    "UPDATE_USER_FOR_LOGIN_SQL",
  ),
  cancelRequests: extractSql(
    "../../app/api/auth/login/route.ts",
    "CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL",
  ),
};

const NOW = "2026-08-09T12:00:00.000Z";
const FUTURE = "2026-08-10T12:00:00.000Z";

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      active INTEGER NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      venue_id TEXT,
      role TEXT NOT NULL DEFAULT 'staff',
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL,
      deleted_at TEXT,
      session_version INTEGER NOT NULL,
      migration_status TEXT NOT NULL,
      password_set_at TEXT,
      last_login_at TEXT
    );
    CREATE TABLE password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL
    );
    CREATE TABLE password_reset_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      setup_method TEXT,
      expires_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT 'before',
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
    INSERT INTO venues VALUES ('venue-a', 1);
  `);
  return db;
}

test("공개 reset 요청 이력은 기존 초기 설정 코드를 가로막지 않는다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);

  assert.equal(
    db.prepare(loginSql.selectLatestSetupCodeRequest).get("user-a"),
    undefined,
  );

  db.prepare(`
    INSERT INTO password_reset_requests (
      id, user_id, status, setup_method, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "setup-history",
    "user-a",
    "cancelled",
    "setup_code",
    FUTURE,
    "after",
    "after",
  );

  assert.deepEqual(
    {
      ...db.prepare(loginSql.selectLatestSetupCodeRequest).get("user-a"),
    },
    {
      status: "cancelled",
      setup_method: "setup_code",
      expires_at: FUTURE,
    },
  );
});

function seedOpenCredentialState(db) {
  db.exec(`
    INSERT INTO users (
      id, venue_id, password_hash, active, deleted_at,
      session_version, migration_status, password_set_at
    ) VALUES ('user-a', 'venue-a', 'old-hash', 1, NULL, 7, 'active', 'before');
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
      VALUES ('token-a-id', 'user-a', 'token-a', '${FUTURE}', 0);
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
      VALUES ('token-b-id', 'user-a', 'token-b', '${FUTURE}', 0);
    INSERT INTO password_reset_requests (id, user_id, status, updated_at)
      VALUES ('request-a', 'user-a', 'pending', 'before');
  `);
}

function seedPasswordLinkActor(db, venueId = "venue-a") {
  db.prepare(`
    INSERT INTO users (
      id, venue_id, role, password_hash, active, deleted_at,
      session_version, migration_status, password_set_at
    ) VALUES ('actor-a', ?, 'venue_admin', 'actor-hash', 1, NULL, 4, 'active', 'before')
  `).run(venueId);
}

test("고비용 password hash 전에 exact 유효 token과 tenant를 확인한다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);

  assert.deepEqual(
    {
      ...db.prepare(tokenSql.selectCandidate).get(
        "token-a",
        NOW,
        "venue-a",
        "venue-a",
      ),
    },
    {
      user_id: "user-a",
      migration_status: "active",
      password_set_at: "before",
    },
  );
  for (const [token, venueId] of [
    ["unknown-token", "venue-a"],
    ["token-a", "venue-b"],
  ]) {
    assert.equal(
      db.prepare(tokenSql.selectCandidate).get(
        token,
        NOW,
        venueId,
        venueId,
      ),
      undefined,
    );
  }

  db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE token = 'token-a'").run();
  assert.equal(
    db.prepare(tokenSql.selectCandidate).get(
      "token-a",
      NOW,
      "venue-a",
      "venue-a",
    ),
    undefined,
  );
});

test("비활성 venue의 reset token은 조회와 password 쓰기 경계에서 거부한다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);
  db.exec("UPDATE venues SET active = 0 WHERE id = 'venue-a'");

  assert.equal(
    db.prepare(tokenSql.selectCandidate).get(
      "token-a",
      NOW,
      "venue-a",
      "venue-a",
    ),
    undefined,
  );

  const [passwordResult] = runTokenReset(db, {
    auditId: "inactive-venue-audit",
    nextHash: "blocked-hash",
    token: "token-a",
  });
  assert.deepEqual(passwordResult, []);
  assert.equal(
    db.prepare("SELECT password_hash FROM users WHERE id = 'user-a'").get()
      .password_hash,
    "old-hash",
  );
});

test("비활성 venue는 credential login의 최종 CAS 쓰기도 거부한다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);
  db.exec("UPDATE venues SET active = 0 WHERE id = 'venue-a'");

  const [loginResult] = runSuccessfulLogin(db);
  assert.deepEqual(loginResult, []);
  assert.equal(
    db.prepare("SELECT last_login_at FROM users WHERE id = 'user-a'").get()
      .last_login_at,
    null,
  );
});

function runBatch(db, statements) {
  db.exec("BEGIN");
  try {
    const results = statements.map(({ sql, args, returning }) => {
      const statement = db.prepare(sql);
      if (returning) return statement.all(...args).map((row) => ({ ...row }));
      statement.run(...args);
      return [];
    });
    db.exec("COMMIT");
    return results;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function runProfileChange(db, {
  auditId,
  expectedHash,
  expectedSessionVersion,
  nextHash,
}) {
  return runBatch(db, [
    {
      sql: profileSql.updatePassword,
      args: [nextHash, NOW, "user-a", expectedHash, expectedSessionVersion],
      returning: true,
    },
    {
      sql: profileSql.insertAudit,
      args: [auditId, '{"method":"authenticated_profile"}', NOW, "user-a"],
      returning: true,
    },
    {
      sql: profileSql.invalidateTokens,
      args: ["user-a", auditId, "user-a"],
      returning: false,
    },
    {
      sql: profileSql.cancelRequests,
      args: [NOW, "user-a", auditId, "user-a"],
      returning: false,
    },
  ]);
}

function runTokenReset(db, {
  auditAction = "password_reset_completed",
  auditId,
  auditMethod = "password_reset_link",
  nextHash,
  token,
}) {
  return runBatch(db, [
    {
      sql: tokenSql.updatePassword,
      args: [nextHash, NOW, token, NOW, null, null],
      returning: true,
    },
    {
      sql: tokenSql.consumeExactToken,
      args: [token, NOW],
      returning: true,
    },
    {
      sql: tokenSql.insertAudit,
      args: [auditId, auditAction, JSON.stringify({ method: auditMethod }), NOW, token],
      returning: true,
    },
    {
      sql: tokenSql.invalidateAllTokens,
      args: [auditId],
      returning: false,
    },
    {
      sql: tokenSql.completeRequests,
      args: [NOW, NOW, auditId],
      returning: false,
    },
  ]);
}

function runManagedPasswordLinkIssue(db, {
  action = "password_reset_link_issued",
  actorId = "actor-a",
  actorSessionVersion = 4,
  auditId = "password-link-audit",
  expectedHash = "old-hash",
  expectedSessionVersion = 7,
  linkId = "managed-link-id",
} = {}) {
  return runBatch(db, [
    {
      sql: passwordLinkSql.invalidateOtherLinks,
      args: [
        "user-a",
        linkId,
        "user-a",
        expectedHash,
        expectedSessionVersion,
        "user-a",
        actorId,
        actorSessionVersion,
      ],
      returning: false,
    },
    {
      sql: passwordLinkSql.activateLink,
      args: [
        linkId,
        "user-a",
        NOW,
        "user-a",
        expectedHash,
        expectedSessionVersion,
        "user-a",
        actorId,
        actorSessionVersion,
      ],
      returning: true,
    },
    {
      sql: passwordLinkSql.insertAudit,
      args: [
        auditId,
        actorId,
        action,
        JSON.stringify({ setupMethod: "password_reset_link", linkExpiresAt: FUTURE }),
        NOW,
        "user-a",
        linkId,
        NOW,
      ],
      returning: true,
    },
    {
      sql: passwordLinkSql.cancelRequests,
      args: [NOW, "user-a", auditId],
      returning: false,
    },
  ]);
}

test("관리자 재설정 링크 발급은 기존 credential을 유지하고 이전 링크와 요청만 폐기한다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);
  seedPasswordLinkActor(db);
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
    VALUES ('managed-link-id', 'user-a', 'managed-link', ?, 1)
  `).run(FUTURE);

  const [, activatedResult, auditResult] = runManagedPasswordLinkIssue(db);
  assert.deepEqual(activatedResult, [{ user_id: "user-a" }]);
  assert.deepEqual(auditResult, [{ target_user_id: "user-a" }]);
  assert.deepEqual(
    {
      ...db.prepare(`
        SELECT password_hash, session_version, migration_status, password_set_at
        FROM users WHERE id = 'user-a'
      `).get(),
    },
    {
      password_hash: "old-hash",
      session_version: 7,
      migration_status: "active",
      password_set_at: "before",
    },
  );
  assert.deepEqual(
    db.prepare(`
      SELECT token, used FROM password_reset_tokens
      WHERE user_id = 'user-a' ORDER BY token
    `).all().map((row) => ({ ...row })),
    [
      { token: "managed-link", used: 0 },
      { token: "token-a", used: 1 },
      { token: "token-b", used: 1 },
    ],
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'request-a'").get()
      .status,
    "cancelled",
  );
});

test("stale credential snapshot은 기존 reset 권한과 요청을 건드리지 않는다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);
  seedPasswordLinkActor(db);
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
    VALUES ('managed-link-id', 'user-a', 'managed-link', ?, 1)
  `).run(FUTURE);

  const [, activatedResult, auditResult] = runManagedPasswordLinkIssue(db, {
    expectedHash: "stale-hash",
  });
  assert.deepEqual(activatedResult, []);
  assert.deepEqual(auditResult, []);
  assert.deepEqual(
    db.prepare(`
      SELECT token, used FROM password_reset_tokens
      WHERE user_id = 'user-a' ORDER BY token
    `).all().map((row) => ({ ...row })),
    [
      { token: "managed-link", used: 1 },
      { token: "token-a", used: 0 },
      { token: "token-b", used: 0 },
    ],
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'request-a'").get()
      .status,
    "pending",
  );
});

test("다른 venue 관리자는 password link를 활성화하거나 기존 링크를 폐기하지 못한다", () => {
  const db = createDatabase();
  db.exec("INSERT INTO venues VALUES ('venue-b', 1)");
  seedOpenCredentialState(db);
  seedPasswordLinkActor(db, "venue-b");
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
    VALUES ('managed-link-id', 'user-a', 'managed-link', ?, 1)
  `).run(FUTURE);

  const [, activatedResult, auditResult] = runManagedPasswordLinkIssue(db);
  assert.deepEqual(activatedResult, []);
  assert.deepEqual(auditResult, []);
  assert.equal(
    db.prepare("SELECT used FROM password_reset_tokens WHERE token = 'token-a'").get().used,
    0,
  );
  assert.equal(
    db.prepare("SELECT used FROM password_reset_tokens WHERE token = 'managed-link'").get().used,
    1,
  );
});

test("초기 계정 token은 비밀번호 설정으로 기록하고 계정을 활성화한다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);
  db.prepare(`
    UPDATE users
    SET migration_status = 'pending_reset', password_set_at = NULL
    WHERE id = 'user-a'
  `).run();

  const [passwordResult, tokenResult, auditResult] = runTokenReset(db, {
    auditAction: "password_setup_completed",
    auditId: "invitation-audit",
    auditMethod: "invitation_link",
    nextHash: "chosen-password-hash",
    token: "token-a",
  });

  assert.deepEqual(passwordResult, [{ id: "user-a" }]);
  assert.deepEqual(tokenResult, [{ user_id: "user-a" }]);
  assert.deepEqual(auditResult, [{ target_user_id: "user-a" }]);
  assert.deepEqual(
    {
      ...db.prepare(`
        SELECT migration_status, password_set_at
        FROM users
        WHERE id = 'user-a'
      `).get(),
    },
    { migration_status: "active", password_set_at: NOW },
  );
  assert.deepEqual(
    {
      ...db.prepare(`
        SELECT action, details
        FROM user_audit_events
        WHERE id = 'invitation-audit'
      `).get(),
    },
    {
      action: "password_setup_completed",
      details: '{"method":"invitation_link"}',
    },
  );
});

function runSuccessfulLogin(
  db,
  { expectedHash = "old-hash", expectedSessionVersion = 7 } = {},
) {
  return runBatch(db, [
    {
      sql: loginSql.updateUser,
      args: [NOW, "login-hash", "user-a", expectedHash, expectedSessionVersion],
      returning: true,
    },
    {
      sql: loginSql.cancelRequests,
      args: [NOW, "user-a"],
      returning: false,
    },
  ]);
}

test("성공한 credential login만 열린 관리자 reset grant를 취소한다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);

  const [loginResult] = runSuccessfulLogin(db);
  assert.deepEqual(loginResult, [{ session_version: 7 }]);
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'request-a'").get()
      .status,
    "cancelled",
  );

  db.prepare(
    "UPDATE password_reset_requests SET status = 'pending', updated_at = 'after' WHERE id = 'request-a'",
  ).run();
  const [staleLoginResult] = runSuccessfulLogin(db, {
    expectedHash: "stale-hash",
  });
  assert.deepEqual(staleLoginResult, []);
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'request-a'").get()
      .status,
    "pending",
  );
});

test("프로필 비밀번호 CAS 승자만 token과 open request를 닫는다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);

  const [passwordResult, auditResult] = runProfileChange(db, {
    auditId: "profile-audit",
    expectedHash: "old-hash",
    expectedSessionVersion: 7,
    nextHash: "profile-hash",
  });
  assert.deepEqual(passwordResult, [{ id: "user-a" }]);
  assert.deepEqual(auditResult, [{ target_user_id: "user-a" }]);
  assert.deepEqual(
    {
      ...db.prepare(
        "SELECT password_hash, session_version, password_set_at FROM users WHERE id = 'user-a'",
      ).get(),
    },
    {
      password_hash: "profile-hash",
      session_version: 8,
      password_set_at: NOW,
    },
  );
  assert.deepEqual(
    db.prepare("SELECT token, used FROM password_reset_tokens ORDER BY token")
      .all()
      .map((row) => ({ ...row })),
    [
      { token: "token-a", used: 1 },
      { token: "token-b", used: 1 },
    ],
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'request-a'").get()
      .status,
    "cancelled",
  );

  db.exec(`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used)
      VALUES ('token-c-id', 'user-a', 'token-c', '${FUTURE}', 0);
    INSERT INTO password_reset_requests (id, user_id, status, updated_at)
      VALUES ('request-b', 'user-a', 'pending', 'after');
  `);
  const [stalePasswordResult, staleAuditResult] = runProfileChange(db, {
    auditId: "stale-profile-audit",
    expectedHash: "old-hash",
    expectedSessionVersion: 7,
    nextHash: "stale-hash",
  });
  assert.deepEqual(stalePasswordResult, []);
  assert.deepEqual(staleAuditResult, []);
  assert.equal(
    db.prepare("SELECT password_hash FROM users WHERE id = 'user-a'").get().password_hash,
    "profile-hash",
  );
  assert.equal(
    db.prepare("SELECT used FROM password_reset_tokens WHERE token = 'token-c'").get().used,
    0,
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'request-b'").get()
      .status,
    "pending",
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM user_audit_events").get().count,
    1,
  );
});

test("유효 token 하나의 승자만 비밀번호를 쓰고 다른 token을 모두 폐기한다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);

  const [passwordResult, tokenResult, auditResult] = runTokenReset(db, {
    auditId: "token-audit",
    nextHash: "token-hash",
    token: "token-a",
  });
  assert.deepEqual(passwordResult, [{ id: "user-a" }]);
  assert.deepEqual(tokenResult, [{ user_id: "user-a" }]);
  assert.deepEqual(auditResult, [{ target_user_id: "user-a" }]);
  assert.deepEqual(
    db.prepare("SELECT token, used FROM password_reset_tokens ORDER BY token")
      .all()
      .map((row) => ({ ...row })),
    [
      { token: "token-a", used: 1 },
      { token: "token-b", used: 1 },
    ],
  );
  assert.deepEqual(
    {
      ...db.prepare(
        "SELECT status, completed_at FROM password_reset_requests WHERE id = 'request-a'",
      ).get(),
    },
    { status: "completed", completed_at: NOW },
  );
  assert.deepEqual(
    {
      ...db.prepare(
        "SELECT action, details FROM user_audit_events WHERE id = 'token-audit'",
      ).get(),
    },
    {
      action: "password_reset_completed",
      details: '{"method":"password_reset_link"}',
    },
  );

  const [reusedPasswordResult, reusedTokenResult, reusedAuditResult] = runTokenReset(db, {
    auditId: "reused-token-audit",
    nextHash: "attacker-hash",
    token: "token-b",
  });
  assert.deepEqual(reusedPasswordResult, []);
  assert.deepEqual(reusedTokenResult, []);
  assert.deepEqual(reusedAuditResult, []);
  assert.equal(
    db.prepare("SELECT password_hash FROM users WHERE id = 'user-a'").get().password_hash,
    "token-hash",
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM user_audit_events").get().count,
    1,
  );
});

test("batch 후반 SQL 실패는 password, token, audit 변경을 모두 rollback한다", () => {
  const db = createDatabase();
  seedOpenCredentialState(db);
  db.exec(`
    CREATE TRIGGER abort_password_reset_request_completion
    BEFORE UPDATE OF status ON password_reset_requests
    WHEN NEW.status = 'completed'
    BEGIN
      SELECT RAISE(ABORT, 'forced request completion failure');
    END;
  `);

  assert.throws(
    () => runTokenReset(db, {
      auditId: "rolled-back-audit",
      nextHash: "rolled-back-hash",
      token: "token-a",
    }),
    /forced request completion failure/,
  );
  assert.deepEqual(
    {
      ...db.prepare(
        "SELECT password_hash, session_version, password_set_at FROM users WHERE id = 'user-a'",
      ).get(),
    },
    {
      password_hash: "old-hash",
      session_version: 7,
      password_set_at: "before",
    },
  );
  assert.equal(
    db.prepare("SELECT sum(used) AS used FROM password_reset_tokens").get().used,
    0,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM user_audit_events").get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'request-a'").get()
      .status,
    "pending",
  );
});
