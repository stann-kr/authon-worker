import assert from "node:assert/strict";
import test from "node:test";

import {
  PasswordResetAdminError,
  listAdminPasswordResetRequests,
  rejectAdminPasswordResetRequest,
  startAdminManagedPasswordReset,
} from "./password-reset-admin-service.ts";

const now = () => new Date("2026-08-23T12:00:00.000Z");
const actor = {
  id: "admin-a",
  role: "venue_admin",
  venueId: "venue-a",
  sessionVersion: 4,
};

function request(overrides = {}) {
  return {
    id: "request-a",
    venueId: "venue-a",
    userId: "user-a",
    source: "self_service",
    status: "pending",
    setupMethod: null,
    decidedByUserId: null,
    decidedAt: null,
    expiresAt: "2026-08-24T12:00:00.000Z",
    completedAt: null,
    createdAt: "2026-08-23T11:00:00.000Z",
    updatedAt: "2026-08-23T11:00:00.000Z",
    ...overrides,
  };
}

function target(overrides = {}) {
  return {
    id: "user-a",
    venueId: "venue-a",
    role: "staff",
    accountKind: "personal",
    active: true,
    deletedAt: null,
    passwordHash: "previous-hash",
    sessionVersion: 2,
    ...overrides,
  };
}

function createDependencies(overrides = {}) {
  const calls = [];
  const persistence = {
    async listRequests(input) {
      calls.push(["listRequests", input]);
      return [];
    },
    async countPendingRequests() {
      return 0;
    },
    async loadRequest(requestId) {
      calls.push(["loadRequest", requestId]);
      return request();
    },
    async loadTarget(userId) {
      calls.push(["loadTarget", userId]);
      return target({ id: userId });
    },
    async approveBrowserRequest(input) {
      calls.push(["approveBrowserRequest", input]);
      return { approvedUserId: input.target.id };
    },
    async approveSetupCodeRequest(input) {
      calls.push(["approveSetupCodeRequest", input]);
      return { updatedUserId: input.target.id, approvedUserId: input.target.id };
    },
    async createDirectSetupCodeReset(input) {
      calls.push(["createDirectSetupCodeReset", input]);
      return { updatedUserId: input.target.id, approvedUserId: input.target.id };
    },
    async rejectRequest(input) {
      calls.push(["rejectRequest", input]);
      return input.requestId;
    },
    ...overrides.persistence,
  };
  return {
    calls,
    dependencies: {
      persistence,
      now,
      createId: (() => {
        let count = 0;
        return () => `operation-${++count}`;
      })(),
      createSetupCode: () => "AUTH-ABCD-2345",
      hashPassword: async (value) => `hash:${value}`,
      verifyChallenge: async () => true,
      requireActiveVenueId: async (venueId) => venueId,
      ...overrides.dependencies,
    },
  };
}

test("admin browser approval preserves the request expiry and performs the receipt check before D1 commit", async () => {
  const { calls, dependencies } = createDependencies();
  const result = await startAdminManagedPasswordReset(
    {
      actor,
      params: {
        requestId: "request-a",
        setupMethod: "admin_approved",
        verificationAttested: true,
        verificationMethod: "in_person",
        verificationChallenge: "signed-challenge",
        jwtSecret: "test-secret",
      },
    },
    dependencies,
  );

  assert.deepEqual(result, {
    requestId: "request-a",
    setupMethod: "admin_approved",
    setupCode: null,
    expiresAt: "2026-08-24T12:00:00.000Z",
  });
  assert.deepEqual(calls.map(([name]) => name), [
    "loadRequest",
    "loadTarget",
    "approveBrowserRequest",
  ]);
  assert.equal(calls[2][1].auditDetails.includes("signed-challenge"), false);
});

test("admin setup-code approval hashes the generated code before the ordered reset batch", async () => {
  const { calls, dependencies } = createDependencies();
  const result = await startAdminManagedPasswordReset(
    { actor, params: { requestId: "request-a", setupMethod: "setup_code" } },
    dependencies,
  );

  assert.equal(result.setupCode, "AUTH-ABCD-2345");
  assert.equal(calls.at(-1)[0], "approveSetupCodeRequest");
  assert.equal(calls.at(-1)[1].passwordHash, "hash:AUTH-ABCD-2345");
});

test("direct reset remains setup-code only and does not create a browser approval", async () => {
  const { calls, dependencies } = createDependencies();
  const result = await startAdminManagedPasswordReset(
    { actor, params: { userId: "user-a", setupMethod: "setup_code" } },
    dependencies,
  );

  assert.equal(result.requestId, "operation-1");
  assert.equal(result.setupCode, "AUTH-ABCD-2345");
  assert.deepEqual(calls.map(([name]) => name), [
    "loadTarget",
    "createDirectSetupCodeReset",
  ]);
});

test("browser approval fails closed when receipt verification is absent or the request expired", async () => {
  const missingReceipt = createDependencies();
  await assert.rejects(
    startAdminManagedPasswordReset(
      { actor, params: { requestId: "request-a", setupMethod: "admin_approved", jwtSecret: "test" } },
      missingReceipt.dependencies,
    ),
    (error) => error instanceof PasswordResetAdminError && error.code === "VERIFICATION_REQUIRED",
  );
  assert.equal(missingReceipt.calls.some(([name]) => name === "approveBrowserRequest"), false);

  const expired = createDependencies({
    persistence: { loadRequest: async () => request({ expiresAt: "2026-08-23T11:59:59.000Z" }) },
  });
  await assert.rejects(
    startAdminManagedPasswordReset(
      { actor, params: { requestId: "request-a", setupMethod: "setup_code" } },
      expired.dependencies,
    ),
    (error) => error instanceof PasswordResetAdminError && error.code === "REQUEST_EXPIRED",
  );
  assert.equal(expired.calls.some(([name]) => name === "approveSetupCodeRequest"), false);
});

test("admin list scopes venue admins to their tenant and rejection reloads the updated request", async () => {
  let requestLoadCount = 0;
  const { calls, dependencies } = createDependencies({
    persistence: {
      listRequests: async (input) => {
        calls.push(["listRequests", input]);
        return [];
      },
      loadRequest: async (requestId) => {
        calls.push(["loadRequest", requestId]);
        requestLoadCount += 1;
        return requestLoadCount === 1
          ? request()
          : request({
            status: "rejected",
            decidedByUserId: actor.id,
            decidedAt: now().toISOString(),
            updatedAt: now().toISOString(),
          });
      },
    },
  });
  await listAdminPasswordResetRequests({ actor, venueId: "venue-other" }, dependencies);
  assert.deepEqual(calls[0][1].visibility, {
    kind: "venue",
    venueId: "venue-a",
    excludedActorId: "admin-a",
  });

  const rejected = await rejectAdminPasswordResetRequest(
    { actor, requestId: "request-a" },
    dependencies,
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.decidedByUserId, actor.id);
  assert.deepEqual(calls.slice(1).map(([name]) => name), [
    "loadRequest",
    "loadTarget",
    "rejectRequest",
    "loadRequest",
  ]);
});
