import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareTokenPasswordReset,
  resetPasswordWithToken,
} from "./password-reset-token-service.ts";

const NOW = "2026-08-23T12:00:00.000Z";

function createPersistence(overrides = {}) {
  const calls = [];
  const persistence = {
    async loadCandidate(input) {
      calls.push(["loadCandidate", input]);
      return {
        userId: "user-a",
        migrationStatus: "active",
        passwordSetAt: "before",
      };
    },
    async commit(input) {
      calls.push(["commit", input]);
      return {
        updatedUserId: "user-a",
        consumedUserId: "user-a",
        auditedUserId: "user-a",
      };
    },
    ...overrides,
  };
  return { persistence, calls };
}

test("token reset validates transport values before rate-limited execution", () => {
  assert.deepEqual(
    prepareTokenPasswordReset({ token: null, newPassword: "Password1" }),
    { status: "missing" },
  );
  assert.deepEqual(
    prepareTokenPasswordReset({ token: "short", newPassword: "Password1" }),
    { status: "invalid_token" },
  );
  assert.deepEqual(
    prepareTokenPasswordReset({ token: "a".repeat(43), newPassword: "short" }),
    {
      status: "policy_error",
      error: "Password must be at least 8 characters.",
    },
  );
});

test("token reset hashes the password only after exact candidate scope", async () => {
  const { persistence, calls } = createPersistence();
  const passwordHashCalls = [];
  const result = await resetPasswordWithToken(
    {
      token: "a".repeat(43),
      newPassword: "Password1",
      expectedVenueId: "venue-a",
    },
    {
      persistence,
      now: () => new Date(NOW),
      createId: () => "audit-a",
      hashResetToken: async () => "token-hash",
      hashPassword: async (password) => {
        passwordHashCalls.push(password);
        return "new-hash";
      },
    },
  );

  assert.deepEqual(result, {
    status: "success",
    userId: "user-a",
    isInitialSetup: false,
  });
  assert.equal(calls[0][0], "loadCandidate");
  assert.deepEqual(passwordHashCalls, ["Password1"]);
  assert.equal(calls[1][1].auditAction, "password_reset_completed");
});

test("token reset rejects a stale candidate without expensive password hashing", async () => {
  const { persistence } = createPersistence({ loadCandidate: async () => null });
  let passwordHashCalls = 0;
  const result = await resetPasswordWithToken(
    {
      token: "a".repeat(43),
      newPassword: "Password1",
      expectedVenueId: null,
    },
    {
      persistence,
      hashResetToken: async () => "token-hash",
      hashPassword: async () => {
        passwordHashCalls += 1;
        return "new-hash";
      },
    },
  );
  assert.deepEqual(result, { status: "invalid_token" });
  assert.equal(passwordHashCalls, 0);
});

test("token reset requires password, token, and audit to identify one winner", async () => {
  const { persistence } = createPersistence({
    commit: async () => ({
      updatedUserId: "user-a",
      consumedUserId: null,
      auditedUserId: "user-a",
    }),
  });
  const result = await resetPasswordWithToken(
    {
      token: "a".repeat(43),
      newPassword: "Password1",
      expectedVenueId: null,
    },
    {
      persistence,
      hashResetToken: async () => "token-hash",
      hashPassword: async () => "new-hash",
    },
  );
  assert.deepEqual(result, { status: "invalid_token" });
});
