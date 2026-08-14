import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CANCEL_BROWSER_PASSWORD_RESET_REQUEST_SQL,
  CANCEL_EXPIRED_ADMIN_APPROVED_RESET_REQUESTS_SQL,
  CANCEL_EXPIRED_OPEN_PASSWORD_RESET_REQUESTS_SQL,
  COMPLETE_OPEN_PASSWORD_RESET_REQUEST_AFTER_USER_UPDATE_SQL,
  INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_SQL,
  INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_WITH_EXPIRY_SQL,
  SELECT_EXISTING_BROWSER_PASSWORD_RESET_REQUEST_SQL,
} from "./password-reset-request-sql.ts";

const NOW = "2026-08-09T06:00:00.000Z";
const BEFORE_NOW = "2026-08-09T05:59:59.999Z";
const AFTER_NOW = "2026-08-10T06:00:00.000Z";
const migrationSql = readFileSync(
  new URL("../../migrations/0015_password_reset_requests.sql", import.meta.url),
  "utf8",
);

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (id TEXT PRIMARY KEY, active INTEGER NOT NULL);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      venue_id TEXT REFERENCES venues(id),
      role TEXT NOT NULL,
      active INTEGER NOT NULL,
      deleted_at TEXT
    );
    INSERT INTO venues (id, active) VALUES ('venue-a', 1);
    INSERT INTO users (id, venue_id, role, active, deleted_at)
    VALUES ('user-a', 'venue-a', 'staff', 1, NULL);
  `);
  db.exec(migrationSql);
  return db;
}

function submitBrowserBoundRequest(
  db,
  {
    requestId = "browser-request",
    userId = "user-a",
    scope = "venue",
    venueId = "venue-a",
    receiptRequestId = "missing-receipt",
  } = {},
) {
  db.exec("BEGIN");
  try {
    db.prepare(CANCEL_EXPIRED_OPEN_PASSWORD_RESET_REQUESTS_SQL).run(
      NOW,
      userId,
      NOW,
    );
    const inserted = db.prepare(
      INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_WITH_EXPIRY_SQL,
    ).all(
      requestId,
      AFTER_NOW,
      NOW,
      NOW,
      userId,
      scope,
      venueId,
    ).map((row) => ({ ...row }));
    const existing = db.prepare(
      SELECT_EXISTING_BROWSER_PASSWORD_RESET_REQUEST_SQL,
    ).all(
      receiptRequestId,
      userId,
      NOW,
      scope,
      venueId,
    ).map((row) => ({ ...row }));
    db.exec("COMMIT");
    return { inserted, existing };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function insertApprovedGrant(db, { id, expiresAt }) {
  db.prepare(`
    INSERT INTO password_reset_requests (
      id, venue_id, user_id, source, status, setup_method,
      decided_by_user_id, decided_at, expires_at, created_at, updated_at
    )
    VALUES (?, 'venue-a', 'user-a', 'admin', 'approved', 'admin_approved',
            'user-a', ?, ?, ?, ?)
  `).run(id, NOW, expiresAt, NOW, NOW);
}

function submitSelfServiceRequest(db, id) {
  db.exec("BEGIN");
  try {
    db.prepare(CANCEL_EXPIRED_ADMIN_APPROVED_RESET_REQUESTS_SQL).run(
      NOW,
      "user-a",
      NOW,
    );
    db.prepare(INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_SQL).run(
      id,
      "venue-a",
      "user-a",
      NOW,
      NOW,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("사용자별 열린 재설정 요청은 하나만 허용한다", () => {
  const db = createDatabase();
  db.prepare(INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_SQL).run(
    "pending-a",
    "venue-a",
    "user-a",
    NOW,
    NOW,
  );

  assert.throws(
    () => insertApprovedGrant(db, { id: "approved-a", expiresAt: AFTER_NOW }),
    /UNIQUE constraint failed/,
  );

  db.prepare(
    "UPDATE password_reset_requests SET status = 'rejected' WHERE id = 'pending-a'",
  ).run();
  insertApprovedGrant(db, { id: "approved-a", expiresAt: AFTER_NOW });
  assert.equal(
    db.prepare(
      "SELECT count(*) AS count FROM password_reset_requests WHERE status IN ('pending', 'approved')",
    ).get().count,
    1,
  );
});

test("만료된 코드 없는 승인을 취소한 뒤 새 요청을 원자적으로 등록한다", () => {
  const db = createDatabase();
  insertApprovedGrant(db, { id: "expired", expiresAt: BEFORE_NOW });

  submitSelfServiceRequest(db, "pending-after-expiry");

  assert.deepEqual(
    db.prepare(
      "SELECT id, status FROM password_reset_requests ORDER BY id",
    ).all().map((row) => ({ ...row })),
    [
      { id: "expired", status: "cancelled" },
      { id: "pending-after-expiry", status: "pending" },
    ],
  );
});

test("아직 유효한 승인이 있으면 중복 요청을 만들지 않는다", () => {
  const db = createDatabase();
  insertApprovedGrant(db, { id: "active", expiresAt: AFTER_NOW });

  submitSelfServiceRequest(db, "ignored-pending");

  assert.deepEqual(
    db.prepare("SELECT id, status FROM password_reset_requests")
      .all()
      .map((row) => ({ ...row })),
    [{ id: "active", status: "approved" }],
  );
});

test("browser-bound 요청은 expiry와 current tenant를 원자적으로 결속한다", () => {
  const db = createDatabase();
  assert.deepEqual(submitBrowserBoundRequest(db).inserted, [
    { id: "browser-request" },
  ]);

  db.prepare(
    "UPDATE password_reset_requests SET status = 'cancelled' WHERE id = 'browser-request'",
  ).run();
  db.exec("INSERT INTO venues (id, active) VALUES ('venue-b', 1)");
  db.exec("UPDATE users SET venue_id = 'venue-b' WHERE id = 'user-a'");
  assert.deepEqual(
    submitBrowserBoundRequest(db, { requestId: "stale-tenant-request" }).inserted,
    [],
  );
});

test("같은 browser receipt만 기존 open request를 복구한다", () => {
  const db = createDatabase();
  submitBrowserBoundRequest(db);

  assert.deepEqual(
    submitBrowserBoundRequest(db, {
      requestId: "duplicate-request",
      receiptRequestId: "browser-request",
    }),
    {
      inserted: [],
      existing: [{ id: "browser-request" }],
    },
  );
  assert.deepEqual(
    submitBrowserBoundRequest(db, {
      requestId: "attacker-request",
      receiptRequestId: "different-receipt",
    }).existing,
    [],
  );
});

test("비활성 venue는 browser reset 생성·복구·취소를 모두 거부한다", () => {
  const db = createDatabase();
  submitBrowserBoundRequest(db);
  db.exec("UPDATE venues SET active = 0 WHERE id = 'venue-a'");

  assert.deepEqual(
    submitBrowserBoundRequest(db, {
      requestId: "inactive-request",
      receiptRequestId: "browser-request",
    }),
    { inserted: [], existing: [] },
  );

  const cancelled = db.prepare(CANCEL_BROWSER_PASSWORD_RESET_REQUEST_SQL).run(
    NOW,
    "browser-request",
    "venue",
    "venue-a",
  );
  assert.equal(cancelled.changes, 0);
  assert.equal(
    db.prepare("SELECT status FROM password_reset_requests WHERE id = 'browser-request'")
      .get().status,
    "pending",
  );
});

test("receipt 없는 legacy NULL open row는 새 browser-bound 요청으로 교체한다", () => {
  const db = createDatabase();
  db.prepare(INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_SQL).run(
    "legacy-null",
    "venue-a",
    "user-a",
    NOW,
    NOW,
  );

  assert.deepEqual(
    submitBrowserBoundRequest(db, { requestId: "replacement" }).inserted,
    [{ id: "replacement" }],
  );
  assert.deepEqual(
    db.prepare(
      "SELECT id, status FROM password_reset_requests ORDER BY id",
    ).all().map((row) => ({ ...row })),
    [
      { id: "legacy-null", status: "cancelled" },
      { id: "replacement", status: "pending" },
    ],
  );
});

test("계정 설정 쓰기가 성공한 경우에만 열린 요청을 한 번 완료한다", () => {
  const db = createDatabase();
  db.prepare(INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_SQL).run(
    "pending",
    "venue-a",
    "user-a",
    NOW,
    NOW,
  );

  db.prepare("UPDATE users SET venue_id = venue_id WHERE id = 'missing'").run();
  db.prepare(COMPLETE_OPEN_PASSWORD_RESET_REQUEST_AFTER_USER_UPDATE_SQL).run(
    NOW,
    NOW,
    "user-a",
  );
  assert.equal(
    db.prepare(
      "SELECT status FROM password_reset_requests WHERE id = 'pending'",
    ).get().status,
    "pending",
  );

  db.prepare("UPDATE users SET venue_id = venue_id WHERE id = 'user-a'").run();
  const firstCompletion = db
    .prepare(COMPLETE_OPEN_PASSWORD_RESET_REQUEST_AFTER_USER_UPDATE_SQL)
    .run(NOW, NOW, "user-a");
  assert.equal(firstCompletion.changes, 1);
  assert.equal(
    db.prepare(
      "SELECT status FROM password_reset_requests WHERE id = 'pending'",
    ).get().status,
    "completed",
  );

  db.prepare("UPDATE users SET venue_id = venue_id WHERE id = 'user-a'").run();
  const repeatedCompletion = db
    .prepare(COMPLETE_OPEN_PASSWORD_RESET_REQUEST_AFTER_USER_UPDATE_SQL)
    .run(NOW, NOW, "user-a");
  assert.equal(repeatedCompletion.changes, 0);
});

test("마이그레이션이 허용되지 않은 상태와 처리 방식을 거부한다", () => {
  const db = createDatabase();
  const insert = db.prepare(`
    INSERT INTO password_reset_requests (
      id, venue_id, user_id, source, status, setup_method, created_at, updated_at
    ) VALUES (?, 'venue-a', 'user-a', ?, ?, ?, ?, ?)
  `);

  assert.throws(
    () => insert.run("bad-status", "self_service", "expired", null, NOW, NOW),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insert.run("bad-method", "self_service", "pending", "email", NOW, NOW),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insert.run("bad-source", "email", "pending", null, NOW, NOW),
    /CHECK constraint failed/,
  );
});
