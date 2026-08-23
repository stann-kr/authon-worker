import assert from "node:assert/strict";
import test from "node:test";

import { loginWithPassword } from "./login-service.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");

function user(overrides = {}) {
  return {
    id: "user-a", email: "staff@example.com", passwordHash: "pbkdf2$100000$salt$hash",
    name: "Staff", role: "staff", accountKind: "personal", doorAccessEnabled: false,
    venueId: "venue-a", venueActive: true, guestLimit: null, preferredLocale: "ko",
    active: true, deletedAt: null, sessionVersion: 7, migrationStatus: "active",
    passwordSetAt: "2026-08-01T00:00:00.000Z", ...overrides,
  };
}

function createDependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    persistence: {
      async findCandidate(email) { calls.push(["candidate", email]); return user(); },
      async findLatestSetupCodeRequest(userId) { calls.push(["setupHistory", userId]); return null; },
      async commitLogin(input) { calls.push(["commit", input]); return 7; },
    },
    session: {
      isConfigured() { calls.push(["configured"]); return true; },
      async createSession(input) {
        calls.push(["session", input]);
        return { token: "token-a", sessionId: "session-a", lifetime: { ttlSeconds: 86_400 } };
      },
    },
    async verifyPassword(password, storedHash) { calls.push(["verify", { password, storedHash }]); return true; },
    async hashPassword(password) { calls.push(["hash", password]); return "rehash"; },
    needsRehash() { return false; },
    now() { return NOW; },
    createId() { return "fake-user-id"; },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    email: "staff@example.com", password: "Password1", keepSignedIn: false,
    tenant: { resolved: true, scope: "venue", venueId: "venue-a" }, ...overrides,
  };
}

test("ineligible candidates still run setup-history lookup and dummy password verification", async () => {
  const dependencies = createDependencies({
    persistence: {
      async findCandidate() { return user({ active: false }); },
      async findLatestSetupCodeRequest(userId) { dependencies.calls.push(["setupHistory", userId]); return null; },
      async commitLogin() { throw new Error("ineligible login cannot commit"); },
    },
  });

  assert.deepEqual(await loginWithPassword(input(), dependencies), { status: "invalid_credentials" });
  assert.deepEqual(dependencies.calls, [
    ["setupHistory", "fake-user-id"],
    ["verify", { password: "Password1", storedHash: "pbkdf2$100000$Yud1PnfAdnmks4HLqvBwVQ==$bgkDnZqJEDZaY7gsi+3OYHDi0Px87/E9QAWdGgOgXtI=" }],
  ]);
});

test("inactive venues and tenant mismatches use the same fake candidate boundary", async () => {
  for (const candidate of [user({ venueActive: false }), user({ venueId: "venue-b" })]) {
    const dependencies = createDependencies({
      persistence: {
        async findCandidate() { return candidate; },
        async findLatestSetupCodeRequest(userId) { dependencies.calls.push(["setupHistory", userId]); return null; },
        async commitLogin() { throw new Error("ineligible login cannot commit"); },
      },
    });
    assert.equal((await loginWithPassword(input(), dependencies)).status, "invalid_credentials");
    assert.equal(dependencies.calls[0][1], "fake-user-id");
    assert.notEqual(dependencies.calls[1][1].storedHash, candidate.passwordHash);
  }
});

test("pending setup preserves approved-code and legacy history behavior", async () => {
  const dependencies = createDependencies({
    persistence: {
      async findCandidate() { return user({ migrationStatus: "pending_reset", passwordSetAt: null }); },
      async findLatestSetupCodeRequest(userId) {
        dependencies.calls.push(["setupHistory", userId]);
        return { status: "approved", setupMethod: "setup_code", expiresAt: "2026-08-23T12:01:00.000Z" };
      },
      async commitLogin() { throw new Error("setup-required login cannot commit"); },
    },
  });
  assert.deepEqual(await loginWithPassword(input(), dependencies), { status: "setup_required" });
  assert.equal(dependencies.calls.some(([name]) => name === "session"), false);
});

test("rehash commits with the password snapshot before exactly one session is created", async () => {
  const dependencies = createDependencies({ needsRehash() { return true; } });
  const result = await loginWithPassword(input({ keepSignedIn: true }), dependencies);
  assert.equal(result.status, "success");
  assert.deepEqual(dependencies.calls.map(([name]) => name), [
    "candidate", "setupHistory", "verify", "configured", "hash", "commit", "session",
  ]);
  assert.equal(dependencies.calls[5][1].passwordHash, "rehash");
  assert.equal(dependencies.calls[6][1].keepSignedIn, true);
});

test("a CAS loser cannot create a JWT or KV session", async () => {
  const dependencies = createDependencies({
    persistence: {
      async findCandidate() { return user(); },
      async findLatestSetupCodeRequest() { return null; },
      async commitLogin() { return null; },
    },
  });
  assert.deepEqual(await loginWithPassword(input(), dependencies), { status: "invalid_credentials" });
  assert.equal(dependencies.calls.some(([name]) => name === "session"), false);
});

test("a valid candidate with the wrong password cannot check configuration or commit", async () => {
  const dependencies = createDependencies({
    async verifyPassword(password, storedHash) {
      dependencies.calls.push(["verify", { password, storedHash }]);
      return false;
    },
  });

  assert.deepEqual(await loginWithPassword(input(), dependencies), {
    status: "invalid_credentials",
  });
  assert.equal(
    dependencies.calls.some(([name]) =>
      ["configured", "hash", "commit", "session"].includes(name),
    ),
    false,
  );
});

test("missing JWT configuration fails after verification without mutating login state", async () => {
  const dependencies = createDependencies({
    session: {
      isConfigured() {
        dependencies.calls.push(["configured"]);
        return false;
      },
      async createSession() {
        throw new Error("an unavailable login cannot create a session");
      },
    },
  });

  const result = await loginWithPassword(input(), dependencies);
  assert.equal(result.status, "unavailable");
  assert.equal(
    dependencies.calls.some(([name]) =>
      ["hash", "commit", "session"].includes(name),
    ),
    false,
  );
});
