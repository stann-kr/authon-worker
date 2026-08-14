import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  APPROVE_BROWSER_PASSWORD_RESET_SQL,
  APPROVE_SETUP_CODE_REQUEST_SQL,
  CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL,
  COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL,
  INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL,
  INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL,
  INVALIDATE_RESET_TOKENS_AFTER_AUDIT_SQL,
  INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL,
  SET_USER_SETUP_CODE_FOR_REQUEST_SQL,
  UPDATE_USER_WITH_APPROVED_RESET_SQL,
} from "./password-reset-lifecycle-sql.ts";

const NOW = "2026-08-09T12:00:00.000Z";
const PENDING_EXPIRY = "2026-08-10T12:00:00.000Z";
const APPROVAL_EXPIRY = "2026-08-09T12:15:00.000Z";

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      active INTEGER NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      venue_id TEXT,
      role TEXT NOT NULL,
      account_kind TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL,
      deleted_at TEXT,
      session_version INTEGER NOT NULL,
      migration_status TEXT NOT NULL,
      password_set_at TEXT
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
      token TEXT NOT NULL UNIQUE,
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
    INSERT INTO venues VALUES ('venue-a', 1);
  `);
  return db;
}

function seedRequest(db) {
  db.exec(`
    INSERT INTO users VALUES (
      'admin-a', 'venue-a', 'venue_admin', 'personal',
      'admin-hash', 1, NULL, 1, 'active', '${NOW}'
    );
    INSERT INTO users VALUES (
      'staff-a', 'venue-a', 'staff', 'personal',
      'old-hash', 1, NULL, 7, 'active', '${NOW}'
    );
    INSERT INTO password_reset_requests (
      id, venue_id, user_id, source, status, setup_method,
      expires_at, created_at, updated_at
    ) VALUES (
      '123e4567-e89b-42d3-a456-426614174000',
      'venue-a', 'staff-a', 'self_service', 'pending', NULL,
      '${PENDING_EXPIRY}', '${NOW}', '${NOW}'
    );
    INSERT INTO password_reset_tokens VALUES (
      'token-a', 'staff-a', 'token-a-hash', '${PENDING_EXPIRY}', 0
    );
    INSERT INTO password_reset_tokens VALUES (
      'token-b', 'staff-a', 'token-b-hash', '${PENDING_EXPIRY}', 0
    );
  `);
}

function runBatch(db, statements) {
  db.exec("BEGIN");
  try {
    const results = statements.map(({ sql, args, returning = false }) => {
      const statement = db.prepare(sql);
      return returning
        ? statement.all(...args).map((row) => ({ ...row }))
        : (statement.run(...args), []);
    });
    db.exec("COMMIT");
    return results;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function approveBrowserRequest(db, auditId = "approval-audit") {
  return runBatch(db, [
    {
      sql: APPROVE_BROWSER_PASSWORD_RESET_SQL,
      args: [
        "admin-a",
        NOW,
        APPROVAL_EXPIRY,
        NOW,
        "123e4567-e89b-42d3-a456-426614174000",
        "staff-a",
        NOW,
        "staff-a",
        "admin-a",
        1,
      ],
      returning: true,
    },
    {
      sql: INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL,
      args: [
        auditId,
        "admin-a",
        '{"method":"browser_receipt"}',
        NOW,
        "staff-a",
      ],
    },
  ]);
}

function claimBrowserRequest(db, {
  auditId = "claim-audit",
  expectedHash = "old-hash",
  expectedSessionVersion = 7,
  requestId = "123e4567-e89b-42d3-a456-426614174000",
  nextHash = "new-hash",
} = {}) {
  return runBatch(db, [
    {
      sql: UPDATE_USER_WITH_APPROVED_RESET_SQL,
      args: [
        nextHash,
        NOW,
        "staff-a",
        expectedHash,
        expectedSessionVersion,
        "venue-a",
        "venue-a",
        "browser_receipt",
        "browser_receipt",
        requestId,
        "admin_approved",
        NOW,
      ],
      returning: true,
    },
    {
      sql: INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL,
      args: [
        auditId,
        JSON.stringify({ method: "browser_receipt", requestId }),
        NOW,
        "staff-a",
      ],
    },
    {
      sql: COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL,
      args: [NOW, NOW, requestId, auditId],
    },
    {
      sql: INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL,
      args: ["staff-a", auditId],
    },
    {
      sql: CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL,
      args: [NOW, "staff-a", requestId, auditId],
    },
  ]);
}

function approveSetupCodeRequest(db, auditId = "setup-approval-audit") {
  return runBatch(db, [
    {
      sql: SET_USER_SETUP_CODE_FOR_REQUEST_SQL,
      args: [
        "setup-code-hash",
        "staff-a",
        "old-hash",
        7,
        "123e4567-e89b-42d3-a456-426614174000",
        "staff-a",
        NOW,
        "staff-a",
        "admin-a",
        1,
      ],
      returning: true,
    },
    {
      sql: APPROVE_SETUP_CODE_REQUEST_SQL,
      args: [
        "admin-a",
        NOW,
        APPROVAL_EXPIRY,
        NOW,
        "123e4567-e89b-42d3-a456-426614174000",
        "staff-a",
      ],
      returning: true,
    },
    {
      sql: INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL,
      args: [
        auditId,
        "admin-a",
        '{"method":"manual_setup_code"}',
        NOW,
        "staff-a",
      ],
    },
    {
      sql: INVALIDATE_RESET_TOKENS_AFTER_AUDIT_SQL,
      args: ["staff-a", auditId],
    },
  ]);
}

function claimSetupCodeRequest(
  db,
  auditId = "setup-claim-audit",
  { expectedSessionVersion = 8 } = {},
) {
  const requestId = "123e4567-e89b-42d3-a456-426614174000";
  return runBatch(db, [
    {
      sql: UPDATE_USER_WITH_APPROVED_RESET_SQL,
      args: [
        "new-setup-password-hash",
        NOW,
        "staff-a",
        "setup-code-hash",
        expectedSessionVersion,
        "venue-a",
        "venue-a",
        "manual_setup_code",
        "manual_setup_code",
        requestId,
        "setup_code",
        NOW,
      ],
      returning: true,
    },
    {
      sql: INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL,
      args: [
        auditId,
        JSON.stringify({ method: "manual_setup_code", requestId }),
        NOW,
        "staff-a",
      ],
    },
    {
      sql: COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL,
      args: [NOW, NOW, requestId, auditId],
    },
    {
      sql: INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL,
      args: ["staff-a", auditId],
    },
    {
      sql: CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL,
      args: [NOW, "staff-a", requestId, auditId],
    },
  ]);
}

function claimLegacySetupCode(db, {
  auditId = "legacy-claim-audit",
  expectedHash = "legacy-setup-hash",
  expectedSessionVersion = 7,
} = {}) {
  return runBatch(db, [
    {
      sql: UPDATE_USER_WITH_APPROVED_RESET_SQL,
      args: [
        "new-password-hash",
        NOW,
        "staff-a",
        expectedHash,
        expectedSessionVersion,
        "venue-a",
        "venue-a",
        "legacy_setup_code",
        "legacy_setup_code",
        "",
        "setup_code",
        NOW,
      ],
      returning: true,
    },
    {
      sql: INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL,
      args: [
        auditId,
        JSON.stringify({ method: "legacy_setup_code", requestId: null }),
        NOW,
        "staff-a",
      ],
    },
    {
      sql: COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL,
      args: [NOW, NOW, "", auditId],
    },
    {
      sql: INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL,
      args: ["staff-a", auditId],
    },
    {
      sql: CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL,
      args: [NOW, "staff-a", "", auditId],
    },
  ]);
}

function seedLegacySetupAccount(db) {
  db.exec(`
    INSERT INTO users VALUES (
      'staff-a', 'venue-a', 'staff', 'personal',
      'legacy-setup-hash', 1, NULL, 7, 'pending_reset', NULL
    );
    INSERT INTO password_reset_requests (
      id, venue_id, user_id, source, status, setup_method,
      expires_at, created_at, updated_at
    ) VALUES (
      'public-request', 'venue-a', 'staff-a', 'self_service',
      'pending', NULL, '${PENDING_EXPIRY}', '${NOW}', '${NOW}'
    );
  `);
}

test("공개 요청 이력만 있는 초기 계정은 기존 setup code를 계속 소비할 수 있다", () => {
  const db = createDatabase();
  seedLegacySetupAccount(db);

  const [claimed] = claimLegacySetupCode(db);
  assert.deepEqual(claimed, [{ id: "staff-a" }]);
  assert.deepEqual(
    {
      ...db.prepare(
        "SELECT password_hash, migration_status, password_set_at FROM users WHERE id = 'staff-a'",
      ).get(),
    },
    {
      password_hash: "new-password-hash",
      migration_status: "active",
      password_set_at: NOW,
    },
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'public-request'").get()
      .status,
    "cancelled",
  );
  assert.equal(
    db.prepare(
      "SELECT count(*) AS count FROM user_audit_events WHERE action = 'password_setup_completed'",
    ).get().count,
    1,
  );
});

test("실제 setup code 발급 이력이 있으면 legacy fallback은 다시 열리지 않는다", () => {
  const db = createDatabase();
  seedLegacySetupAccount(db);
  db.exec(`
    INSERT INTO password_reset_requests (
      id, venue_id, user_id, source, status, setup_method,
      expires_at, created_at, updated_at
    ) VALUES (
      'setup-history', 'venue-a', 'staff-a', 'admin_manual',
      'cancelled', 'setup_code', '${APPROVAL_EXPIRY}', '${NOW}', '${NOW}'
    );
  `);

  const [claimed] = claimLegacySetupCode(db, {
    auditId: "blocked-legacy-claim",
  });
  assert.deepEqual(claimed, []);
  assert.equal(
    db.prepare("SELECT password_hash FROM users WHERE id = 'staff-a'").get().password_hash,
    "legacy-setup-hash",
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'public-request'").get()
      .status,
    "pending",
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM user_audit_events").get().count,
    0,
  );
});

test("direct 승인은 exact pending request만 승인하고 credential은 claim 전까지 바꾸지 않는다", () => {
  const db = createDatabase();
  seedRequest(db);

  const [approval] = approveBrowserRequest(db);
  assert.deepEqual(approval, [{ user_id: "staff-a" }]);
  assert.deepEqual(
    { ...db.prepare(
      "SELECT status, setup_method, expires_at FROM password_reset_requests",
    ).get() },
    {
      status: "approved",
      setup_method: "admin_approved",
      expires_at: APPROVAL_EXPIRY,
    },
  );
  assert.deepEqual(
    { ...db.prepare(
      "SELECT password_hash, session_version FROM users WHERE id = 'staff-a'",
    ).get() },
    { password_hash: "old-hash", session_version: 7 },
  );

  const [duplicate] = approveBrowserRequest(db, "duplicate-approval-audit");
  assert.deepEqual(duplicate, []);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM user_audit_events").get().count,
    1,
  );
});

test("비활성 venue는 새 reset 승인과 기존 승인 claim을 모두 차단한다", () => {
  const approvalDb = createDatabase();
  seedRequest(approvalDb);
  approvalDb.exec("UPDATE venues SET active = 0 WHERE id = 'venue-a'");

  const [blockedApproval] = approveBrowserRequest(approvalDb);
  assert.deepEqual(blockedApproval, []);
  assert.equal(
    approvalDb.prepare("SELECT status FROM password_reset_requests").get().status,
    "pending",
  );

  const claimDb = createDatabase();
  seedRequest(claimDb);
  approveBrowserRequest(claimDb);
  claimDb.exec("UPDATE venues SET active = 0 WHERE id = 'venue-a'");

  const [blockedClaim] = claimBrowserRequest(claimDb);
  assert.deepEqual(blockedClaim, []);
  assert.equal(
    claimDb.prepare("SELECT password_hash FROM users WHERE id = 'staff-a'").get()
      .password_hash,
    "old-hash",
  );
});

test("Venue Admin 권한이 사라지거나 대상이 peer admin으로 승격되면 승인 SQL이 거부한다", () => {
  for (const mutation of [
    "UPDATE users SET role = 'venue_admin' WHERE id = 'staff-a'",
    "UPDATE users SET account_kind = 'shared' WHERE id = 'staff-a'",
    "UPDATE users SET venue_id = 'venue-b' WHERE id = 'staff-a'",
    "UPDATE users SET active = 0 WHERE id = 'admin-a'",
    "UPDATE users SET session_version = 2 WHERE id = 'admin-a'",
  ]) {
    const db = createDatabase();
    seedRequest(db);
    db.exec(mutation);
    const [approval] = approveBrowserRequest(db);
    assert.deepEqual(approval, []);
    assert.equal(
      db.prepare("SELECT status FROM password_reset_requests").get().status,
      "pending",
    );
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM user_audit_events").get().count,
      0,
    );
  }
});

test("Super Admin도 request 발급 뒤 venue가 바뀐 대상을 stale request로 승인할 수 없다", () => {
  for (const approve of [approveBrowserRequest, approveSetupCodeRequest]) {
    const db = createDatabase();
    seedRequest(db);
    db.exec(`
      UPDATE users SET role = 'super_admin', venue_id = NULL WHERE id = 'admin-a';
      UPDATE users SET venue_id = 'venue-b' WHERE id = 'staff-a';
    `);

    const [firstResult] = approve(db);
    assert.deepEqual(firstResult, []);
    assert.equal(
      db.prepare("SELECT status FROM password_reset_requests").get().status,
      "pending",
    );
  }
});

test("direct 승인은 대상이 승격·공유 전환되거나 승인자가 권한을 잃은 뒤 claim할 수 없다", () => {
  for (const [index, mutation] of [
    "UPDATE users SET role = 'venue_admin', session_version = 8 WHERE id = 'staff-a'",
    "UPDATE users SET account_kind = 'shared', session_version = 8 WHERE id = 'staff-a'",
    "UPDATE users SET role = 'staff', venue_id = 'venue-b', session_version = 8 WHERE id = 'staff-a'",
    "UPDATE users SET active = 0 WHERE id = 'admin-a'",
  ].entries()) {
    const db = createDatabase();
    seedRequest(db);
    approveBrowserRequest(db);
    db.exec(mutation);

    const target = db.prepare(
      "SELECT password_hash, session_version FROM users WHERE id = 'staff-a'",
    ).get();
    const [claimed] = claimBrowserRequest(db, {
      auditId: `blocked-direct-${index}`,
      expectedHash: target.password_hash,
      expectedSessionVersion: target.session_version,
    });
    assert.deepEqual(claimed, []);
    assert.equal(
      db.prepare("SELECT password_hash FROM users WHERE id = 'staff-a'").get().password_hash,
      "old-hash",
    );
  }
});

test("exact approved request의 claim만 한 번 성공하고 모든 reset token을 폐기한다", () => {
  const db = createDatabase();
  seedRequest(db);
  approveBrowserRequest(db);

  const [claimed] = claimBrowserRequest(db);
  assert.deepEqual(claimed, [{ id: "staff-a" }]);
  assert.deepEqual(
    { ...db.prepare(
      "SELECT password_hash, session_version FROM users WHERE id = 'staff-a'",
    ).get() },
    { password_hash: "new-hash", session_version: 8 },
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests").get().status,
    "completed",
  );
  assert.equal(
    db.prepare("SELECT sum(used) AS used FROM password_reset_tokens").get().used,
    2,
  );

  const [reused] = claimBrowserRequest(db, {
    auditId: "reused-claim-audit",
    nextHash: "attacker-hash",
  });
  assert.deepEqual(reused, []);
  assert.equal(
    db.prepare("SELECT password_hash FROM users WHERE id = 'staff-a'").get().password_hash,
    "new-hash",
  );
  assert.equal(
    db.prepare(
      "SELECT count(*) AS count FROM user_audit_events WHERE action = 'password_setup_completed'",
    ).get().count,
    1,
  );
});

test("setup code도 15분 approval row에 결속되고 취소·만료 뒤에는 사용할 수 없다", () => {
  const db = createDatabase();
  seedRequest(db);

  const [userUpdated, requestApproved] = approveSetupCodeRequest(db);
  assert.deepEqual(userUpdated, [{ id: "staff-a" }]);
  assert.deepEqual(requestApproved, [{ user_id: "staff-a" }]);
  assert.deepEqual(
    { ...db.prepare(
      "SELECT password_hash, session_version, migration_status FROM users WHERE id = 'staff-a'",
    ).get() },
    {
      password_hash: "setup-code-hash",
      session_version: 8,
      migration_status: "pending_reset",
    },
  );

  db.exec(`
    UPDATE password_reset_requests
    SET status = 'cancelled'
    WHERE id = '123e4567-e89b-42d3-a456-426614174000'
  `);
  const [cancelledClaim] = claimSetupCodeRequest(db, "cancelled-setup-claim");
  assert.deepEqual(cancelledClaim, []);
  assert.equal(
    db.prepare("SELECT password_hash FROM users WHERE id = 'staff-a'").get().password_hash,
    "setup-code-hash",
  );

  db.exec(`
    UPDATE password_reset_requests
    SET status = 'approved', expires_at = '${NOW}'
    WHERE id = '123e4567-e89b-42d3-a456-426614174000'
  `);
  const [expiredClaim] = claimSetupCodeRequest(db, "expired-setup-claim");
  assert.deepEqual(expiredClaim, []);
  assert.equal(
    db.prepare(
      "SELECT count(*) AS count FROM user_audit_events WHERE action = 'password_setup_completed'",
    ).get().count,
    0,
  );
});

test("유효한 setup code approval은 한 번만 소비된다", () => {
  const db = createDatabase();
  seedRequest(db);
  approveSetupCodeRequest(db);

  const [claimed] = claimSetupCodeRequest(db);
  assert.deepEqual(claimed, [{ id: "staff-a" }]);
  assert.deepEqual(
    { ...db.prepare(
      "SELECT password_hash, session_version, migration_status FROM users WHERE id = 'staff-a'",
    ).get() },
    {
      password_hash: "new-setup-password-hash",
      session_version: 9,
      migration_status: "active",
    },
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests").get().status,
    "completed",
  );

  const [reused] = claimSetupCodeRequest(db, "reused-setup-claim");
  assert.deepEqual(reused, []);
  assert.equal(
    db.prepare(
      "SELECT count(*) AS count FROM user_audit_events WHERE action = 'password_setup_completed'",
    ).get().count,
    1,
  );
});

test("venue admin이 발급한 setup code는 대상 승격·venue 이동 뒤 claim할 수 없다", () => {
  for (const [index, mutation] of [
    "UPDATE users SET role = 'venue_admin', session_version = 9 WHERE id = 'staff-a'",
    "UPDATE users SET venue_id = 'venue-b', session_version = 9 WHERE id = 'staff-a'",
    "UPDATE users SET role = 'staff', session_version = 2 WHERE id = 'admin-a'",
  ].entries()) {
    const db = createDatabase();
    seedRequest(db);
    approveSetupCodeRequest(db);
    db.exec(mutation);

    const currentSessionVersion = db.prepare(
      "SELECT session_version FROM users WHERE id = 'staff-a'",
    ).get().session_version;
    const [claimed] = claimSetupCodeRequest(
      db,
      `blocked-setup-${index}`,
      { expectedSessionVersion: currentSessionVersion },
    );
    assert.deepEqual(claimed, []);
    assert.equal(
      db.prepare("SELECT password_hash FROM users WHERE id = 'staff-a'").get().password_hash,
      "setup-code-hash",
    );
  }
});

test("다른 request receipt와 stale credential snapshot은 사용자·token에 부작용을 남기지 않는다", () => {
  const db = createDatabase();
  seedRequest(db);
  approveBrowserRequest(db);

  const [wrongRequest] = claimBrowserRequest(db, {
    auditId: "wrong-request-audit",
    requestId: "223e4567-e89b-42d3-a456-426614174000",
  });
  assert.deepEqual(wrongRequest, []);

  db.exec("UPDATE users SET session_version = 8 WHERE id = 'staff-a'");
  const [staleCredential] = claimBrowserRequest(db, {
    auditId: "stale-credential-audit",
  });
  assert.deepEqual(staleCredential, []);
  assert.equal(
    db.prepare("SELECT password_hash FROM users WHERE id = 'staff-a'").get().password_hash,
    "old-hash",
  );
  assert.equal(
    db.prepare("SELECT sum(used) AS used FROM password_reset_tokens").get().used,
    0,
  );
});

test("claim batch 후반 실패는 password·request·token·audit을 전부 rollback한다", () => {
  const db = createDatabase();
  seedRequest(db);
  approveBrowserRequest(db);
  db.exec(`
    CREATE TRIGGER abort_direct_request_completion
    BEFORE UPDATE OF status ON password_reset_requests
    WHEN NEW.status = 'completed'
    BEGIN
      SELECT RAISE(ABORT, 'forced direct completion failure');
    END;
  `);

  assert.throws(
    () => claimBrowserRequest(db),
    /forced direct completion failure/,
  );
  assert.deepEqual(
    { ...db.prepare(
      "SELECT password_hash, session_version FROM users WHERE id = 'staff-a'",
    ).get() },
    { password_hash: "old-hash", session_version: 7 },
  );
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests").get().status,
    "approved",
  );
  assert.equal(
    db.prepare("SELECT sum(used) AS used FROM password_reset_tokens").get().used,
    0,
  );
  assert.equal(
    db.prepare(
      "SELECT count(*) AS count FROM user_audit_events WHERE action = 'password_setup_completed'",
    ).get().count,
    0,
  );
});
