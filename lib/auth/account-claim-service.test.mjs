import assert from "node:assert/strict";
import test from "node:test";

import {
  claimAccount,
  prepareAccountClaimPassword,
} from "./account-claim-service.ts";
import {
  DUMMY_BCRYPT_PASSWORD_HASH,
  DUMMY_PBKDF2_PASSWORD_HASH,
} from "./password.ts";

const NOW = "2026-08-23T12:00:00.000Z";
const CURRENT_SETUP_CODE_HASH =
  "pbkdf2$100000$Bud1PnfAdnmks4HLqvBwVQ==$BgkDnZqJEDZaY7gsi+3OYHDi0Px87/E9QAWdGgOgXtI=";
const LEGACY_SETUP_CODE_HASH =
  "$2a$10$rpPtH3Gi/lD7I4CMibddou2MuN51mIpNE1ZCiY7tA65PzJzf2rLEa";

function candidate(overrides = {}) {
  return {
    id: "staff-a",
    venue_id: "venue-a",
    password_hash: CURRENT_SETUP_CODE_HASH,
    session_version: 7,
    migration_status: "pending_reset",
    password_set_at: null,
    request_id: "request-a",
    setup_method: "setup_code",
    has_setup_code_history: 1,
    ...overrides,
  };
}

function createDependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    persistence: {
      async findBrowserReceiptCandidate(input) {
        calls.push(["browser", input]);
        return candidate({ setup_method: "admin_approved" });
      },
      async findSetupCodeCandidate(input) {
        calls.push(["setup", input]);
        return candidate();
      },
      async consumeClaim(input) {
        calls.push(["consume", input]);
        return "staff-a";
      },
    },
    async verifyPassword(password, hash) {
      calls.push(["verify", { password, hash }]);
      return true;
    },
    async hashPassword(password) {
      calls.push(["hash", password]);
      return "new-password-hash";
    },
    createOperationId() {
      calls.push(["operation"]);
      return "operation-a";
    },
    now() {
      return NOW;
    },
    ...overrides,
  };
}

function setupInput(overrides = {}) {
  return {
    useBrowserReceipt: false,
    email: "staff@example.com",
    setupCode: "setup-code",
    newPassword: "Password123",
    receiptRequestId: null,
    claimGrantExpiresAt: null,
    nowIso: NOW,
    expectedVenueId: "venue-a",
    ...overrides,
  };
}

test("account claim password policy is owned by the service before execution", () => {
  assert.deepEqual(prepareAccountClaimPassword(null), { status: "missing" });
  assert.deepEqual(prepareAccountClaimPassword("short"), {
    status: "policy_error",
    code: "PASSWORD_TOO_SHORT",
  });
  assert.deepEqual(prepareAccountClaimPassword("Password1"), {
    status: "ready",
    password: "Password1",
  });
});

test("setup-code claim verifies its scoped candidate then consumes its credential snapshot", async () => {
  const dependencies = createDependencies();

  const result = await claimAccount(setupInput(), dependencies);

  assert.deepEqual(result, {
    status: "claimed",
    userId: "staff-a",
    venueId: "venue-a",
    requestId: "request-a",
  });
  assert.deepEqual(dependencies.calls, [
    ["setup", {
      email: "staff@example.com",
      nowIso: NOW,
      expectedVenueId: "venue-a",
    }],
    ["verify", { password: "setup-code", hash: CURRENT_SETUP_CODE_HASH }],
    ["verify", { password: "setup-code", hash: DUMMY_BCRYPT_PASSWORD_HASH }],
    ["hash", "Password123"],
    ["operation"],
    ["consume", {
      candidate: candidate(),
      expectedVenueId: "venue-a",
      passwordHash: "new-password-hash",
      credentialChangedAt: NOW,
      operationId: "operation-a",
      claimMethod: "manual_setup_code",
      exactRequestId: "request-a",
    }],
  ]);
});

test("legacy setup-code claim retains the no-request fallback and exact empty request id", async () => {
  const dependencies = createDependencies({
    persistence: {
      async findBrowserReceiptCandidate() {
        throw new Error("browser candidate is not expected");
      },
      async findSetupCodeCandidate() {
        return candidate({
          password_hash: LEGACY_SETUP_CODE_HASH,
          request_id: null,
          has_setup_code_history: 0,
        });
      },
      async consumeClaim(input) {
        dependencies.calls.push(["consume", input]);
        return "staff-a";
      },
    },
  });

  const result = await claimAccount(setupInput(), dependencies);

  assert.equal(result.status, "claimed");
  const consume = dependencies.calls.find(([name]) => name === "consume")[1];
  assert.equal(consume.claimMethod, "legacy_setup_code");
  assert.equal(consume.exactRequestId, "");
  assert.equal(consume.candidate.request_id, null);
  assert.deepEqual(
    dependencies.calls
      .filter(([name]) => name === "verify")
      .map(([, verification]) => verification.hash),
    [DUMMY_PBKDF2_PASSWORD_HASH, LEGACY_SETUP_CODE_HASH],
  );
});

test("invalid setup candidates still run both dummy verifiers and never hash or consume", async () => {
  const calls = [];
  const dependencies = createDependencies({
    persistence: {
      async findBrowserReceiptCandidate() {
        return null;
      },
      async findSetupCodeCandidate() {
        return null;
      },
      async consumeClaim() {
        throw new Error("invalid candidates cannot consume a claim");
      },
    },
    async verifyPassword(password, hash) {
      calls.push({ password, hash });
      return false;
    },
    async hashPassword() {
      throw new Error("ineligible claims cannot hash a new password");
    },
  });

  const result = await claimAccount(setupInput(), dependencies);

  assert.deepEqual(result, { status: "not_eligible" });
  assert.deepEqual(calls, [
    { password: "setup-code", hash: DUMMY_PBKDF2_PASSWORD_HASH },
    { password: "setup-code", hash: DUMMY_BCRYPT_PASSWORD_HASH },
  ]);
});

test("setup-code dummy matches and malformed stored credentials are never accepted", async () => {
  for (const [candidateHash, matchingDummy, expectedHashes] of [
    [
      CURRENT_SETUP_CODE_HASH,
      DUMMY_BCRYPT_PASSWORD_HASH,
      [CURRENT_SETUP_CODE_HASH, DUMMY_BCRYPT_PASSWORD_HASH],
    ],
    [
      LEGACY_SETUP_CODE_HASH,
      DUMMY_PBKDF2_PASSWORD_HASH,
      [DUMMY_PBKDF2_PASSWORD_HASH, LEGACY_SETUP_CODE_HASH],
    ],
    [
      "$2a$04$not-a-supported-cost-10-credential.................",
      DUMMY_BCRYPT_PASSWORD_HASH,
      [DUMMY_PBKDF2_PASSWORD_HASH, DUMMY_BCRYPT_PASSWORD_HASH],
    ],
  ]) {
    const dependencies = createDependencies({
      persistence: {
        async findBrowserReceiptCandidate() {
          return null;
        },
        async findSetupCodeCandidate() {
          return candidate({ password_hash: candidateHash });
        },
        async consumeClaim() {
          throw new Error("a dummy match cannot consume a setup credential");
        },
      },
      async verifyPassword(password, hash) {
        dependencies.calls.push(["verify", { password, hash }]);
        return hash === matchingDummy;
      },
      async hashPassword() {
        throw new Error("a dummy match cannot hash a new password");
      },
    });

    assert.deepEqual(await claimAccount(setupInput(), dependencies), {
      status: "not_eligible",
    });
    assert.deepEqual(
      dependencies.calls
        .filter(([name]) => name === "verify")
        .map(([, verification]) => verification.hash),
      expectedHashes,
    );
  }
});

test("browser receipt claim requires the signed exact request and never verifies a setup code", async () => {
  const dependencies = createDependencies();

  const result = await claimAccount(
    setupInput({
      useBrowserReceipt: true,
      email: "",
      setupCode: "",
      receiptRequestId: "request-a",
      claimGrantExpiresAt: "2026-08-23T12:01:00.000Z",
    }),
    dependencies,
  );

  assert.equal(result.status, "claimed");
  assert.deepEqual(dependencies.calls[0], ["browser", {
    requestId: "request-a",
    nowIso: NOW,
    expectedVenueId: "venue-a",
  }]);
  assert.equal(dependencies.calls.some(([name]) => name === "verify"), false);
  const consume = dependencies.calls.find(([name]) => name === "consume")[1];
  assert.equal(consume.claimMethod, "browser_receipt");
  assert.equal(consume.candidate.setup_method, "admin_approved");
});

test("expired browser grants retain the hash-before-expiry order but cannot consume the one-time state", async () => {
  const dependencies = createDependencies();

  const result = await claimAccount(
    setupInput({
      useBrowserReceipt: true,
      email: "",
      setupCode: "",
      receiptRequestId: "request-a",
      claimGrantExpiresAt: NOW,
    }),
    dependencies,
  );

  assert.deepEqual(result, { status: "grant_expired" });
  assert.equal(dependencies.calls.some(([name]) => name === "hash"), true);
  assert.equal(dependencies.calls.some(([name]) => name === "consume"), false);
});

test("a failed compare-and-swap result is externally ineligible", async () => {
  const dependencies = createDependencies({
    persistence: {
      async findBrowserReceiptCandidate() {
        return null;
      },
      async findSetupCodeCandidate() {
        return candidate();
      },
      async consumeClaim() {
        return null;
      },
    },
  });

  assert.deepEqual(
    await claimAccount(setupInput(), dependencies),
    { status: "not_eligible" },
  );
});
