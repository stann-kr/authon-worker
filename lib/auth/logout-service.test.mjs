import assert from "node:assert/strict";
import test from "node:test";

import { logoutSession } from "./logout-service.ts";
import { SESSION_REVOCATION_MAX_ATTEMPTS } from "./session-revocation.ts";

function createDependencies(overrides = {}) {
  const calls = [];
  const persistence = {
    async readSession(sessionId) {
      calls.push(["readSession", sessionId]);
      return { userId: "user-a", sessionVersion: 3 };
    },
    async revokeUserSessions(userId, sessionVersion) {
      calls.push(["revokeUserSessions", userId, sessionVersion]);
      return { sessionVersion: sessionVersion + 1 };
    },
    async deleteSession(sessionId) {
      calls.push(["deleteSession", sessionId]);
    },
    ...overrides.persistence,
  };
  return {
    dependencies: {
      persistence,
      verifyToken: async () => ({ userId: "user-a", sessionVersion: 3 }),
      isInvalidTokenError: () => false,
      ...overrides,
      persistence,
    },
    calls,
  };
}

test("logout revokes the bound user version before deleting the current KV session", async () => {
  const { dependencies, calls } = createDependencies();

  const result = await logoutSession(
    { token: "token-a", sessionId: "session-a" },
    dependencies,
  );

  assert.deepEqual(result, {
    cleanupFailed: false,
    revocationPending: false,
    failures: [],
  });
  assert.deepEqual(calls, [
    ["readSession", "session-a"],
    ["revokeUserSessions", "user-a", 3],
    ["deleteSession", "session-a"],
  ]);
});

test("logout preserves the KV session when durable revocation stays unavailable", async () => {
  const failure = new Error("D1 unavailable");
  const { dependencies, calls } = createDependencies({
    persistence: {
      async revokeUserSessions(userId, sessionVersion) {
        calls.push(["revokeUserSessions", userId, sessionVersion]);
        throw failure;
      },
    },
  });

  const result = await logoutSession(
    { token: "token-a", sessionId: "session-a" },
    dependencies,
  );

  assert.equal(result.cleanupFailed, true);
  assert.equal(result.revocationPending, true);
  assert.deepEqual(result.failures, [
    { event: "auth.logout.session_revocation", error: failure },
  ]);
  assert.equal(
    calls.filter(([name]) => name === "revokeUserSessions").length,
    SESSION_REVOCATION_MAX_ATTEMPTS,
  );
  assert.equal(calls.some(([name]) => name === "deleteSession"), false);
});

test("logout preserves the credential when a verified token cannot be bound to KV", async () => {
  const failure = new Error("KV unavailable");
  const { dependencies, calls } = createDependencies({
    persistence: {
      async readSession() {
        throw failure;
      },
    },
  });

  const result = await logoutSession(
    { token: "token-a", sessionId: "session-a" },
    dependencies,
  );

  assert.deepEqual(result, {
    cleanupFailed: true,
    revocationPending: true,
    failures: [{ event: "auth.logout.session_binding", error: failure }],
  });
  assert.equal(calls.some(([name]) => name === "deleteSession"), false);
});

test("invalid tokens still allow local KV cleanup", async () => {
  const { dependencies, calls } = createDependencies({
    verifyToken: async () => {
      throw new Error("expired");
    },
    isInvalidTokenError: () => true,
  });

  const result = await logoutSession(
    { token: "expired", sessionId: "session-a" },
    dependencies,
  );

  assert.equal(result.revocationPending, false);
  assert.deepEqual(calls, [["deleteSession", "session-a"]]);
});

test("KV cleanup failure remains a successful local termination outcome", async () => {
  const failure = new Error("KV delete unavailable");
  const { dependencies } = createDependencies({
    persistence: {
      async deleteSession() {
        throw failure;
      },
    },
  });

  const result = await logoutSession(
    { sessionId: "session-a" },
    dependencies,
  );

  assert.deepEqual(result, {
    cleanupFailed: true,
    revocationPending: false,
    failures: [{ event: "auth.logout.session_cleanup", error: failure }],
  });
});
