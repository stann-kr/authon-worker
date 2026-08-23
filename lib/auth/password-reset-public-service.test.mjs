import assert from "node:assert/strict";
import test from "node:test";

import {
  getPublicPasswordResetStatus,
  submitPublicPasswordResetRequest,
} from "./password-reset-public-service.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = { resolved: true, scope: "venue", venueId: "venue-a" };

function createDependencies(overrides = {}) {
  const calls = [];
  const persistence = {
    async findUserByEmail(email) {
      calls.push(["findUserByEmail", email]);
      return null;
    },
    async createOrSelectBrowserRequest(input) {
      calls.push(["createOrSelectBrowserRequest", input]);
      return { insertedRequestId: null, existingRequestId: null };
    },
    async loadReceiptStatus(requestId) {
      calls.push(["loadReceiptStatus", requestId]);
      return null;
    },
    async cancelExpiredApprovedRequest(input) {
      calls.push(["cancelExpiredApprovedRequest", input]);
    },
    async cancelBrowserRequest(input) {
      calls.push(["cancelBrowserRequest", input]);
    },
    ...overrides.persistence,
  };
  return {
    calls,
    dependencies: {
      persistence,
      now: () => NOW,
      createId: () => REQUEST_ID,
      getReceiptRequestIdForCandidate: async () => null,
      createReceipt: async (requestId) => `receipt:${requestId}`,
      deriveChallenge: async (requestId) => `challenge:${requestId}`,
      createClaimGrant: async (requestId, expiresAtMs) =>
        `claim:${requestId}:${expiresAtMs}`,
      ...overrides,
      persistence,
    },
  };
}

test("public reset request keeps a decoy receipt when no eligible account exists", async () => {
  const { dependencies, calls } = createDependencies();

  const result = await submitPublicPasswordResetRequest(
    {
      email: "missing@example.com",
      headers: new Headers(),
      secret: "test-secret",
      tenant: TENANT,
    },
    dependencies,
  );

  assert.deepEqual(result, {
    receipt: `receipt:${REQUEST_ID}`,
    challenge: `challenge:${REQUEST_ID}`,
    persistenceError: null,
  });
  assert.deepEqual(calls[1], [
    "createOrSelectBrowserRequest",
    {
      requestId: REQUEST_ID,
      existingReceiptRequestId: null,
      eligibleUserId: REQUEST_ID,
      expiresAt: "2026-08-24T12:00:00.000Z",
      nowIso: "2026-08-23T12:00:00.000Z",
      tenantScope: "venue",
      tenantVenueId: "venue-a",
    },
  ]);
});

test("public reset request retains an exact valid browser receipt after an insert conflict", async () => {
  const { dependencies } = createDependencies({
    getReceiptRequestIdForCandidate: async () => EXISTING_REQUEST_ID,
    persistence: {
      async createOrSelectBrowserRequest(input) {
        assert.equal(input.requestId, EXISTING_REQUEST_ID);
        return {
          insertedRequestId: null,
          existingRequestId: EXISTING_REQUEST_ID,
        };
      },
    },
  });

  const result = await submitPublicPasswordResetRequest(
    {
      email: "missing@example.com",
      headers: new Headers(),
      secret: "test-secret",
      tenant: TENANT,
    },
    dependencies,
  );

  assert.equal(result.receipt, `receipt:${EXISTING_REQUEST_ID}`);
  assert.equal(result.challenge, `challenge:${EXISTING_REQUEST_ID}`);
});

test("approved exact request creates a claim bounded by the database approval expiry", async () => {
  const expiresAt = "2026-08-23T12:05:00.000Z";
  const { dependencies } = createDependencies({
    persistence: {
      async loadReceiptStatus() {
        return {
          venueId: "venue-a",
          userRole: "door_staff",
          status: "approved",
          setupMethod: "admin_approved",
          expiresAt,
        };
      },
    },
  });

  const result = await getPublicPasswordResetStatus(
    {
      receiptRequestId: REQUEST_ID,
      claimGrant: null,
      secret: "test-secret",
      tenant: TENANT,
    },
    dependencies,
  );

  assert.deepEqual(result, {
    state: "approved",
    challenge: `challenge:${REQUEST_ID}`,
    expiresAt,
    claim: `claim:${REQUEST_ID}:${Date.parse(expiresAt)}`,
    claimCookieMaxAge: 300,
    shouldClearRecoveryCookies: false,
    shouldClearReceiptCookie: true,
  });
});

test("an expired claim cancels its approved request before clearing browser recovery cookies", async () => {
  const { dependencies, calls } = createDependencies({
    persistence: {
      async loadReceiptStatus() {
        return {
          venueId: "venue-a",
          userRole: "door_staff",
          status: "approved",
          setupMethod: "admin_approved",
          expiresAt: "2026-08-23T12:15:00.000Z",
        };
      },
    },
  });

  const result = await getPublicPasswordResetStatus(
    {
      receiptRequestId: null,
      claimGrant: {
        requestId: REQUEST_ID,
        expiresAt: "2026-08-23T11:59:59.000Z",
      },
      secret: "test-secret",
      tenant: TENANT,
    },
    dependencies,
  );

  assert.equal(result.state, "expired");
  assert.equal(result.shouldClearRecoveryCookies, true);
  assert.deepEqual(calls.at(-1), [
    "cancelExpiredApprovedRequest",
    { requestId: REQUEST_ID, nowIso: NOW.toISOString() },
  ]);
});
