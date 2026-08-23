import assert from "node:assert/strict";
import test from "node:test";

import { changeProfilePassword } from "./profile-password-service.ts";

function createPersistence(overrides = {}) {
  const calls = [];
  const persistence = {
    async loadUser(userId) {
      calls.push(["loadUser", userId]);
      return {
        id: userId,
        venueId: "venue-a",
        passwordHash: "old-hash",
        sessionVersion: 7,
        active: true,
      };
    },
    async commitChange(input) {
      calls.push(["commitChange", input]);
      return { updatedUserId: "user-a", auditedUserId: "user-a" };
    },
    async deleteSession(sessionId) {
      calls.push(["deleteSession", sessionId]);
    },
    ...overrides,
  };
  return { persistence, calls };
}

test("profile password verifies the current credential before the CAS batch", async () => {
  const { persistence, calls } = createPersistence();
  const result = await changeProfilePassword(
    {
      actorUserId: "user-a",
      currentPassword: "Current1",
      newPassword: "Password2",
      sessionId: "session-a",
    },
    {
      persistence,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      createId: () => "audit-a",
      verifyPassword: async () => true,
      hashPassword: async () => "new-hash",
    },
  );
  assert.equal(result.status, "success");
  assert.deepEqual(calls.map(([name]) => name), [
    "loadUser",
    "commitChange",
    "deleteSession",
  ]);
});

test("profile password rejects an inactive user before verification", async () => {
  const { persistence } = createPersistence({
    loadUser: async () => ({
      id: "user-a",
      venueId: "venue-a",
      passwordHash: "old-hash",
      sessionVersion: 7,
      active: false,
    }),
  });
  let verifyCalls = 0;
  const result = await changeProfilePassword(
    {
      actorUserId: "user-a",
      currentPassword: "Current1",
      newPassword: "Password2",
    },
    {
      persistence,
      verifyPassword: async () => {
        verifyCalls += 1;
        return true;
      },
    },
  );
  assert.deepEqual(result, { status: "user_not_found" });
  assert.equal(verifyCalls, 0);
});

test("profile password conflict does not remove the current KV session", async () => {
  const { persistence, calls } = createPersistence({
    commitChange: async () => ({ updatedUserId: null, auditedUserId: null }),
  });
  const result = await changeProfilePassword(
    {
      actorUserId: "user-a",
      currentPassword: "Current1",
      newPassword: "Password2",
      sessionId: "session-a",
    },
    {
      persistence,
      verifyPassword: async () => true,
      hashPassword: async () => "new-hash",
    },
  );
  assert.deepEqual(result, { status: "conflict" });
  assert.equal(calls.some(([name]) => name === "deleteSession"), false);
});

test("profile password reports KV cleanup failure after a successful D1 commit", async () => {
  const cleanupError = new Error("KV unavailable");
  const { persistence } = createPersistence({
    deleteSession: async () => {
      throw cleanupError;
    },
  });
  const result = await changeProfilePassword(
    {
      actorUserId: "user-a",
      currentPassword: "Current1",
      newPassword: "Password2",
      sessionId: "session-a",
    },
    {
      persistence,
      verifyPassword: async () => true,
      hashPassword: async () => "new-hash",
    },
  );
  assert.equal(result.status, "success");
  assert.equal(result.sessionCleanupError, cleanupError);
});
