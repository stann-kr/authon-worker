import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  parseLogoutAuthCookies,
  REVOKE_USER_SESSIONS_SQL,
  resolveLogoutSessionBinding,
  SESSION_REVOCATION_MAX_ATTEMPTS,
  retrySessionRevocation,
} from "./session-revocation.ts";

test("logout session revocation advances the version exactly once", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      session_version INTEGER NOT NULL
    );
    INSERT INTO users VALUES ('user-a', 3);
  `);
  const statement = database.prepare(REVOKE_USER_SESSIONS_SQL);

  assert.deepEqual(
    { ...statement.get("user-a", 3) },
    { sessionVersion: 4 },
  );
  assert.equal(statement.get("user-a", 3), undefined);
  assert.equal(
    database.prepare("SELECT session_version FROM users WHERE id = 'user-a'").get()
      .session_version,
    4,
  );
  database.close();
});

test("logout cookie parser accepts optional whitespace between legal pairs", () => {
  assert.deepEqual(
    parseLogoutAuthCookies("token=jwt-value;sessionId=session-value"),
    { token: "jwt-value", sessionId: "session-value" },
  );
  assert.deepEqual(
    parseLogoutAuthCookies("other=ignored; token=jwt=with=equals; sessionId=session-value"),
    { token: "jwt=with=equals", sessionId: "session-value" },
  );
  assert.deepEqual(parseLogoutAuthCookies(null), {});
});

test("invalid or expired logout JWT allows local cleanup without reading KV", async () => {
  let sessionReads = 0;

  const result = await resolveLogoutSessionBinding(
    async () => {
      throw new Error("expired");
    },
    async () => {
      sessionReads += 1;
      return { userId: "user-1", sessionVersion: 3 };
    },
    () => true,
  );

  assert.deepEqual(result, { status: "invalid-token" });
  assert.equal(sessionReads, 0);
});

test("KV read outage preserves a verified logout credential for retry", async () => {
  const failure = new Error("KV unavailable");
  const result = await resolveLogoutSessionBinding(
    async () => ({ userId: "user-1", sessionVersion: 3 }),
    async () => {
      throw failure;
    },
    () => false,
  );

  assert.equal(result.status, "pending");
  assert.equal(result.error, failure);
});

test("verified JWT and matching KV session produce a bound revocation target", async () => {
  assert.deepEqual(
    await resolveLogoutSessionBinding(
      async () => ({ userId: "user-1", sessionVersion: 3 }),
      async () => ({ userId: "user-1", sessionVersion: 3 }),
      () => false,
    ),
    { status: "bound", userId: "user-1", sessionVersion: 3 },
  );
});

test("unexpected JWT verification failure preserves the credential for retry", async () => {
  const failure = new TypeError("crypto unavailable");
  let sessionReads = 0;
  const result = await resolveLogoutSessionBinding(
    async () => {
      throw failure;
    },
    async () => {
      sessionReads += 1;
      return null;
    },
    () => false,
  );

  assert.equal(result.status, "pending");
  assert.equal(result.error, failure);
  assert.equal(sessionReads, 0);
});

test("logout session revocation retries transient D1 failures without delay", async () => {
  let attempts = 0;

  const result = await retrySessionRevocation(async () => {
    attempts += 1;
    if (attempts < SESSION_REVOCATION_MAX_ATTEMPTS) throw new Error("transient");
    return { sessionVersion: 4 };
  });

  assert.deepEqual(result, { ok: true, value: { sessionVersion: 4 } });
  assert.equal(attempts, SESSION_REVOCATION_MAX_ATTEMPTS);
});

test("logout session revocation reports pending after the bounded attempts", async () => {
  let attempts = 0;
  const failure = new Error("unavailable");

  const result = await retrySessionRevocation(async () => {
    attempts += 1;
    throw failure;
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
  assert.equal(attempts, SESSION_REVOCATION_MAX_ATTEMPTS);
});
