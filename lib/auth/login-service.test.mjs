import assert from "node:assert/strict";
import test from "node:test";

import { loginWithPassword } from "./login-service.ts";
import {
  DUMMY_BCRYPT_PASSWORD_HASH,
  DUMMY_PBKDF2_PASSWORD_HASH,
} from "./password.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const CURRENT_PASSWORD_HASH =
  "pbkdf2$100000$Aud1PnfAdnmks4HLqvBwVQ==$AgkDnZqJEDZaY7gsi+3OYHDi0Px87/E9QAWdGgOgXtI=";
const LEGACY_PASSWORD_HASH =
  "$2a$10$rpPtH3Gi/lD7I4CMibddou2MuN51mIpNE1ZCiY7tA65PzJzf2rLEa";

function user(overrides = {}) {
  return {
    id: "user-a", email: "staff@example.com", passwordHash: CURRENT_PASSWORD_HASH,
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

test("ineligible candidates still run setup-history lookup and both dummy password verifications", async () => {
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
    ["verify", { password: "Password1", storedHash: DUMMY_PBKDF2_PASSWORD_HASH }],
    ["verify", { password: "Password1", storedHash: DUMMY_BCRYPT_PASSWORD_HASH }],
  ]);
  assert.match(DUMMY_BCRYPT_PASSWORD_HASH, /^\$2[aby]\$10\$/);
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
    assert.deepEqual(
      dependencies.calls
        .filter(([name]) => name === "verify")
        .map(([, verification]) => verification.storedHash),
      [DUMMY_PBKDF2_PASSWORD_HASH, DUMMY_BCRYPT_PASSWORD_HASH],
    );
  }
});

test("PBKDF2 and legacy bcrypt candidates both pay one actual and one dummy verification", async () => {
  for (const [candidateHash, expectedHashes] of [
    [CURRENT_PASSWORD_HASH, [CURRENT_PASSWORD_HASH, DUMMY_BCRYPT_PASSWORD_HASH]],
    [LEGACY_PASSWORD_HASH, [DUMMY_PBKDF2_PASSWORD_HASH, LEGACY_PASSWORD_HASH]],
  ]) {
    const dependencies = createDependencies({
      persistence: {
        async findCandidate(email) {
          dependencies.calls.push(["candidate", email]);
          return user({ passwordHash: candidateHash });
        },
        async findLatestSetupCodeRequest(userId) {
          dependencies.calls.push(["setupHistory", userId]);
          return null;
        },
        async commitLogin(input) {
          dependencies.calls.push(["commit", input]);
          return 7;
        },
      },
      async verifyPassword(password, storedHash) {
        dependencies.calls.push(["verify", { password, storedHash }]);
        return storedHash === candidateHash;
      },
    });

    assert.equal((await loginWithPassword(input(), dependencies)).status, "success");
    assert.deepEqual(
      dependencies.calls
        .filter(([name]) => name === "verify")
        .map(([, verification]) => verification.storedHash),
      expectedHashes,
    );
  }
});

test("dummy matches and malformed stored credentials are never accepted", async () => {
  for (const [candidateHash, matchingDummy, expectedHashes] of [
    [
      CURRENT_PASSWORD_HASH,
      DUMMY_BCRYPT_PASSWORD_HASH,
      [CURRENT_PASSWORD_HASH, DUMMY_BCRYPT_PASSWORD_HASH],
    ],
    [
      LEGACY_PASSWORD_HASH,
      DUMMY_PBKDF2_PASSWORD_HASH,
      [DUMMY_PBKDF2_PASSWORD_HASH, LEGACY_PASSWORD_HASH],
    ],
    [
      "pbkdf2$100000$malformed$credential",
      DUMMY_PBKDF2_PASSWORD_HASH,
      [DUMMY_PBKDF2_PASSWORD_HASH, DUMMY_BCRYPT_PASSWORD_HASH],
    ],
  ]) {
    const dependencies = createDependencies({
      persistence: {
        async findCandidate() {
          return user({ passwordHash: candidateHash });
        },
        async findLatestSetupCodeRequest() {
          return null;
        },
        async commitLogin() {
          throw new Error("a dummy match cannot commit a login");
        },
      },
      async verifyPassword(password, storedHash) {
        dependencies.calls.push(["verify", { password, storedHash }]);
        return storedHash === matchingDummy;
      },
    });

    assert.deepEqual(await loginWithPassword(input(), dependencies), {
      status: "invalid_credentials",
    });
    assert.deepEqual(
      dependencies.calls
        .filter(([name]) => name === "verify")
        .map(([, verification]) => verification.storedHash),
      expectedHashes,
    );
    assert.equal(
      dependencies.calls.some(([name]) =>
        ["configured", "hash", "commit", "session"].includes(name),
      ),
      false,
    );
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
    "candidate", "setupHistory", "verify", "verify", "configured", "hash", "commit", "session",
  ]);
  assert.equal(
    dependencies.calls.find(([name]) => name === "commit")[1].passwordHash,
    "rehash",
  );
  assert.equal(
    dependencies.calls.find(([name]) => name === "session")[1].keepSignedIn,
    true,
  );
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
    dependencies.calls.filter(([name]) => name === "verify").length,
    2,
  );
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
