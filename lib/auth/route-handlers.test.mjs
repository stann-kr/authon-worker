import assert from "node:assert/strict";
import test from "node:test";

await import("tsx");
const [
  { createLoginPostHandler },
  { createAccountClaimPostHandler },
  { createProfilePasswordPutHandler },
  { createPasswordResetPublicRouteHandlers },
  { createPasswordResetStatusGetHandler },
  { createPasswordResetTokenRouteHandlers },
  { createLogoutPostHandler },
  { consumeRateLimitOrDeny },
] = await Promise.all([
  import("./login-route-handler.ts"),
  import("./account-claim-route-handler.ts"),
  import("./profile-password-route-handler.ts"),
  import("./password-reset-public-route-handler.ts"),
  import("./password-reset-status-route-handler.ts"),
  import("./password-reset-token-route-handler.ts"),
  import("./logout-route-handler.ts"),
  import("./rate-limit.ts"),
]);

const ALLOWED = { allowed: true, remaining: 4, retryAfterSeconds: 900 };
const DENIED = { allowed: false, remaining: 0, retryAfterSeconds: 37 };
const TENANT = { resolved: true, scope: "venue", venueId: "venue-a" };

function request(path, body, headers = {}, method = "POST") {
  return new Request(`https://venue.example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      host: "venue.example.com",
      origin: "https://venue.example.com",
      "cf-connecting-ip": "203.0.113.8",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function emptyRequest(path, headers = {}, method = "GET") {
  return new Request(`https://venue.example.com${path}`, {
    method,
    headers: {
      host: "venue.example.com",
      origin: "https://venue.example.com",
      "cf-connecting-ip": "203.0.113.8",
      ...headers,
    },
  });
}

function quietRouteDependencies() {
  return {
    getRequestId: () => "request-a",
    reportServerError: async () => {},
    writeStructuredLog: async () => ({
      event: "test.event",
      requestId: "request-a",
      outcome: "success",
    }),
  };
}

function loginUser() {
  return {
    id: "user-a",
    email: "staff@example.com",
    passwordHash: "hash-a",
    name: "Staff",
    role: "staff",
    accountKind: "personal",
    doorAccessEnabled: false,
    venueId: "venue-a",
    venueActive: true,
    guestLimit: 12,
    preferredLocale: "ko",
    active: true,
    deletedAt: null,
    sessionVersion: 7,
    migrationStatus: "active",
    passwordSetAt: "2026-08-01T00:00:00.000Z",
  };
}

test("login handler executes origin and rate-limit guards before its service", async () => {
  let serviceCalls = 0;
  let environmentCalls = 0;
  const crossOriginHandler = createLoginPostHandler({
    ...quietRouteDependencies(),
    getEnvironment() {
      environmentCalls += 1;
      return {};
    },
    async consumeRateLimit() {
      throw new Error("cross-origin login cannot consume a rate limit");
    },
    async getTenant() {
      return TENANT;
    },
    async login() {
      serviceCalls += 1;
      return { status: "invalid_credentials" };
    },
  });
  const forbidden = await crossOriginHandler(request(
    "/api/auth/login",
    { email: "staff@example.com", password: "Password1" },
    { origin: "https://evil.example" },
  ));
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "FORBIDDEN_ORIGIN");
  assert.equal(environmentCalls, 0);
  assert.equal(serviceCalls, 0);

  let rateLimitInput;
  const rateLimitedHandler = createLoginPostHandler({
    ...quietRouteDependencies(),
    getEnvironment: () => ({}),
    async consumeRateLimit(input) {
      rateLimitInput = input;
      return DENIED;
    },
    async getTenant() {
      throw new Error("rate-limited login cannot resolve a tenant");
    },
    async login() {
      serviceCalls += 1;
      return { status: "invalid_credentials" };
    },
  });
  const denied = await rateLimitedHandler(request(
    "/api/auth/login",
    { email: " Staff@Example.COM ", password: "Password1" },
  ));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "37");
  assert.deepEqual(rateLimitInput, {
    namespace: "login",
    identifier: "203.0.113.8:staff@example.com",
    limit: 5,
    windowSeconds: 900,
  });
  assert.equal(serviceCalls, 0);
});

test("login handler delegates normalized input and preserves session cookies", async () => {
  let serviceInput;
  const handler = createLoginPostHandler({
    ...quietRouteDependencies(),
    getEnvironment: () => ({ marker: "environment-a" }),
    consumeRateLimit: async () => ALLOWED,
    getTenant: async () => TENANT,
    async login(input, environment) {
      serviceInput = { input, environment };
      return {
        status: "success",
        user: loginUser(),
        session: {
          token: "token-a",
          sessionId: "session-a",
          lifetime: { ttlSeconds: 86_400 },
        },
      };
    },
  });

  const response = await handler(request("/api/auth/login", {
    email: " Staff@Example.COM ",
    password: "Password1",
    keepSignedIn: true,
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.email, "staff@example.com");
  assert.deepEqual(serviceInput, {
    input: {
      email: "staff@example.com",
      password: "Password1",
      keepSignedIn: true,
      tenant: TENANT,
    },
    environment: { marker: "environment-a" },
  });
  assert.equal(response.cookies.get("token")?.value, "token-a");
  assert.equal(response.cookies.get("sessionId")?.value, "session-a");
  assert.equal(response.cookies.get("AUTHON_LOCALE")?.value, "ko");
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /token=token-a/);
  assert.match(setCookie, /sessionId=session-a/);
  assert.match(setCookie, /Max-Age=86400/);
});

test("login handler maps service result failures and unavailable telemetry", async () => {
  const scenarios = [
    {
      name: "invalid credentials",
      result: { status: "invalid_credentials" },
      expectedStatus: 401,
      expectedBody: {
        code: "INVALID_CREDENTIALS",
        error: "Invalid email or password.",
      },
      expectedLog: null,
    },
    {
      name: "first-time setup required",
      result: { status: "setup_required" },
      expectedStatus: 409,
      expectedBody: {
        code: "PASSWORD_SETUP_REQUIRED",
        error: "First-time password setup is required.",
        setupMethod: "setup_code",
      },
      expectedLog: null,
    },
    {
      name: "unavailable authentication bindings",
      result: { status: "unavailable", user: loginUser() },
      expectedStatus: 500,
      expectedBody: {
        code: "SERVER_ERROR",
        error: "Unable to sign in right now.",
      },
      expectedLog: {
        level: "error",
        entry: {
          event: "auth.login",
          requestId: "request-a",
          actorId: "user-a",
          venueId: "venue-a",
          outcome: "unavailable",
          errorKind: "MissingConfiguration",
        },
      },
    },
  ];

  for (const scenario of scenarios) {
    const logs = [];
    const handler = createLoginPostHandler({
      ...quietRouteDependencies(),
      getEnvironment: () => ({ marker: "environment-a" }),
      consumeRateLimit: async () => ALLOWED,
      getTenant: async () => TENANT,
      login: async () => scenario.result,
      async writeStructuredLog(level, entry) {
        logs.push({ level, entry });
      },
    });

    const response = await handler(request("/api/auth/login", {
      email: "staff@example.com",
      password: "Password1",
    }));
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.deepEqual(await response.json(), scenario.expectedBody, scenario.name);
    assert.deepEqual(logs[0] ?? null, scenario.expectedLog, scenario.name);
  }
});

function accountClaimDependencies(overrides = {}) {
  return {
    ...quietRouteDependencies(),
    getEnvironment: () => ({ JWT_SECRET: "secret-a" }),
    consumeRateLimit: async () => ALLOWED,
    getTenant: async () => TENANT,
    getReceiptRequestId: async () => null,
    getClaimGrant: async () => null,
    claim: async () => ({ status: "not_eligible" }),
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    ...overrides,
  };
}

test("account-claim handler executes origin and rate-limit guards before its service", async () => {
  let serviceCalls = 0;
  const forbiddenHandler = createAccountClaimPostHandler(accountClaimDependencies({
    getEnvironment() {
      throw new Error("cross-origin claim cannot load its environment");
    },
    async claim() {
      serviceCalls += 1;
      return { status: "not_eligible" };
    },
  }));
  const forbidden = await forbiddenHandler(request(
    "/api/auth/claim-account",
    { email: "staff@example.com", setupCode: "code", newPassword: "Password1" },
    { origin: "https://evil.example" },
  ));
  assert.equal(forbidden.status, 403);
  assert.equal(serviceCalls, 0);

  let rateLimitInput;
  const deniedHandler = createAccountClaimPostHandler(accountClaimDependencies({
    async consumeRateLimit(input) {
      rateLimitInput = input;
      return DENIED;
    },
    async getTenant() {
      throw new Error("rate-limited claim cannot resolve a tenant");
    },
    async claim() {
      serviceCalls += 1;
      return { status: "not_eligible" };
    },
  }));
  const denied = await deniedHandler(request("/api/auth/claim-account", {
    email: " Staff@Example.COM ",
    setupCode: "code",
    newPassword: "Password1",
  }));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "37");
  assert.equal(rateLimitInput.identifier, "203.0.113.8:staff@example.com");
  assert.equal(serviceCalls, 0);
});

test("account-claim handler preserves browser proof input and clears both proof cookies", async () => {
  let serviceInput;
  const handler = createAccountClaimPostHandler(accountClaimDependencies({
    getReceiptRequestId: async () => "request-a",
    getClaimGrant: async () => ({
      requestId: "request-a",
      expiresAt: "2026-08-23T12:15:00.000Z",
    }),
    async claim(input, environment) {
      serviceInput = { input, environment };
      return {
        status: "claimed",
        userId: "user-a",
        venueId: "venue-a",
        requestId: "request-a",
      };
    },
  }));

  const response = await handler(request("/api/auth/claim-account", {
    recoveryReceipt: true,
    newPassword: "Password1",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(serviceInput.input, {
    useBrowserReceipt: true,
    email: "",
    setupCode: "",
    newPassword: "Password1",
    receiptRequestId: "request-a",
    claimGrantExpiresAt: "2026-08-23T12:15:00.000Z",
    nowIso: "2026-08-23T12:00:00.000Z",
    expectedVenueId: "venue-a",
  });
  assert.equal(
    response.cookies.get("authon-password-reset-claim")?.value,
    "",
  );
  assert.equal(
    response.cookies.get("authon-password-reset-receipt")?.value,
    "",
  );
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("account-claim handler maps every claim result", async () => {
  const scenarios = [
    {
      name: "ineligible claim",
      result: { status: "not_eligible" },
      expectedStatus: 400,
      expectedBody: {
        code: "ACCOUNT_NOT_ELIGIBLE",
        error: "The administrator approval or setup code is invalid, expired, or already used.",
      },
    },
    {
      name: "expired grant",
      result: { status: "grant_expired" },
      expectedStatus: 400,
      expectedBody: {
        code: "ACCOUNT_NOT_ELIGIBLE",
        error: "The administrator approval has expired.",
      },
    },
    {
      name: "claimed account",
      result: {
        status: "claimed",
        userId: "user-a",
        venueId: "venue-a",
        requestId: null,
      },
      expectedStatus: 200,
      expectedBody: {
        ok: true,
        message: "Your password has been set.",
      },
    },
  ];

  for (const scenario of scenarios) {
    const handler = createAccountClaimPostHandler(accountClaimDependencies({
      claim: async () => scenario.result,
    }));
    const response = await handler(request("/api/auth/claim-account", {
      email: "staff@example.com",
      setupCode: "setup-code",
      newPassword: "Password1",
    }));
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.deepEqual(await response.json(), scenario.expectedBody, scenario.name);
  }
});

function profilePasswordDependencies(overrides = {}) {
  return {
    ...quietRouteDependencies(),
    getEnvironment: () => ({ marker: "environment-a" }),
    requireAuth: async () => ({ id: "user-a" }),
    consumeRateLimit: async () => ALLOWED,
    changePassword: async () => ({ status: "password_mismatch" }),
    ...overrides,
  };
}

test("profile password rejects untrusted and rate-limited attempts without service calls", async () => {
  let serviceCalls = 0;
  let authCalls = 0;
  const forbiddenHandler = createProfilePasswordPutHandler(profilePasswordDependencies({
    getEnvironment() {
      throw new Error("cross-origin password change cannot load its environment");
    },
    async requireAuth() {
      authCalls += 1;
      return { id: "user-a" };
    },
    async changePassword() {
      serviceCalls += 1;
      return { status: "password_mismatch" };
    },
  }));
  const forbidden = await forbiddenHandler(request(
    "/api/profile/password",
    { currentPassword: "OldPassword1", newPassword: "NewPassword1" },
    { origin: "https://evil.example" },
  ));
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "FORBIDDEN_ORIGIN");
  assert.equal(authCalls, 0);
  assert.equal(serviceCalls, 0);

  let rateLimitInput;
  const deniedHandler = createProfilePasswordPutHandler(profilePasswordDependencies({
    async consumeRateLimit(input) {
      rateLimitInput = input;
      return DENIED;
    },
    async changePassword() {
      serviceCalls += 1;
      return { status: "password_mismatch" };
    },
  }));
  const denied = await deniedHandler(request(
    "/api/profile/password",
    { currentPassword: "OldPassword1", newPassword: "NewPassword1" },
  ));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "37");
  assert.deepEqual(rateLimitInput, {
    namespace: "profile-password",
    identifier: "user-a:203.0.113.8",
    limit: 5,
    windowSeconds: 900,
  });
  assert.equal(serviceCalls, 0);
});

test("profile password delegates actor and session snapshots then clears auth cookies", async () => {
  let serviceInput;
  const handler = createProfilePasswordPutHandler(profilePasswordDependencies({
    async changePassword(input, environment) {
      serviceInput = { input, environment };
      return {
        status: "success",
        user: {
          id: "user-a",
          venueId: "venue-a",
          passwordHash: "old-hash",
          sessionVersion: 7,
          active: true,
        },
        sessionCleanupError: null,
      };
    },
  }));

  const response = await handler(request(
    "/api/profile/password",
    { currentPassword: "OldPassword1", newPassword: "NewPassword1" },
    { cookie: "other=x; sessionId=session-a; token=token-a" },
  ));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reauthRequired, true);
  assert.deepEqual(serviceInput, {
    input: {
      actorUserId: "user-a",
      currentPassword: "OldPassword1",
      newPassword: "NewPassword1",
      sessionId: "session-a",
    },
    environment: { marker: "environment-a" },
  });
  assert.equal(response.cookies.get("token")?.value, "");
  assert.equal(response.cookies.get("sessionId")?.value, "");
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("rate-limit storage errors are executable fail-closed denials", async () => {
  const reports = [];
  const result = await consumeRateLimitOrDeny(
    {
      namespace: "profile-password",
      identifier: "user-a:203.0.113.8",
      limit: 5,
      windowSeconds: 900,
    },
    {
      async consumeRateLimit() {
        throw new Error("KV unavailable");
      },
      async reportServerError(...input) {
        reports.push(input);
      },
    },
  );

  assert.deepEqual(result, {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.equal(reports.length, 1);
  assert.equal(reports[0][0], "rate_limit.storage");
  assert.equal(reports[0].length, 2);
});

function publicResetDependencies(overrides = {}) {
  return {
    ...quietRouteDependencies(),
    getEnvironment: () => ({ JWT_SECRET: "secret-a", marker: "environment-a" }),
    consumeRateLimit: async () => ALLOWED,
    getTenant: async () => TENANT,
    getReceiptRequestId: async () => null,
    getClaimGrantRecord: async () => null,
    submit: async () => ({
      receipt: "receipt-a",
      challenge: "1234",
      persistenceError: null,
    }),
    cancel: async () => {},
    ...overrides,
  };
}

test("public reset request handler denies origin, invalid input, and rate limits before submission", async () => {
  let submitCalls = 0;
  let rateCalls = 0;
  const forbiddenHandlers = createPasswordResetPublicRouteHandlers(
    publicResetDependencies({
      getEnvironment() {
        throw new Error("cross-origin reset request cannot load its environment");
      },
      async submit() {
        submitCalls += 1;
        throw new Error("cross-origin reset request cannot submit");
      },
    }),
  );
  const forbidden = await forbiddenHandlers.POST(request(
    "/api/auth/password-reset-requests",
    { email: "staff@example.com" },
    { origin: "https://evil.example" },
  ));
  assert.equal(forbidden.status, 403);
  assert.equal(submitCalls, 0);

  const invalidHandlers = createPasswordResetPublicRouteHandlers(
    publicResetDependencies({
      async consumeRateLimit() {
        rateCalls += 1;
        return ALLOWED;
      },
      async submit() {
        submitCalls += 1;
        throw new Error("invalid reset request cannot submit");
      },
    }),
  );
  const invalid = await invalidHandlers.POST(request(
    "/api/auth/password-reset-requests",
    { email: "invalid" },
  ));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_EMAIL");
  assert.equal(rateCalls, 0);
  assert.equal(submitCalls, 0);

  let rateLimitInput;
  const deniedHandlers = createPasswordResetPublicRouteHandlers(
    publicResetDependencies({
      async consumeRateLimit(input) {
        rateLimitInput = input;
        return DENIED;
      },
      async getTenant() {
        throw new Error("rate-limited reset request cannot resolve a tenant");
      },
      async submit() {
        submitCalls += 1;
        throw new Error("rate-limited reset request cannot submit");
      },
    }),
  );
  const denied = await deniedHandlers.POST(request(
    "/api/auth/password-reset-requests",
    { email: " Staff@Example.COM " },
  ));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "37");
  assert.deepEqual(rateLimitInput, {
    namespace: "password-reset-request",
    identifier: "203.0.113.8:staff@example.com",
    limit: 3,
    windowSeconds: 3600,
  });
  assert.equal(submitCalls, 0);
});

test("public reset request keeps decoy 202 receipt and trusted cancellation cookie semantics", async () => {
  let submissionInput;
  let cancellationInput;
  const handlers = createPasswordResetPublicRouteHandlers(
    publicResetDependencies({
      getReceiptRequestId: async () => "request-a",
      getClaimGrantRecord: async () => ({
        requestId: "request-a",
        expiresAt: "2026-08-23T12:15:00.000Z",
      }),
      async submit(input, environment) {
        submissionInput = { input, environment };
        return {
          receipt: "receipt-a",
          challenge: "1234",
          persistenceError: null,
        };
      },
      async cancel(input, environment) {
        cancellationInput = { input, environment };
      },
    }),
  );

  const submitted = await handlers.POST(request(
    "/api/auth/password-reset-requests",
    { email: " Staff@Example.COM " },
  ));
  assert.equal(submitted.status, 202);
  assert.equal(submitted.headers.get("cache-control"), "no-store");
  assert.equal((await submitted.json()).challenge, "1234");
  assert.equal(
    submitted.cookies.get("authon-password-reset-receipt")?.value,
    "receipt-a",
  );
  assert.equal(submissionInput.input.email, "staff@example.com");
  assert.equal(submissionInput.input.secret, "secret-a");

  const cancelled = await handlers.DELETE(emptyRequest(
    "/api/auth/password-reset-requests",
    { cookie: "authon-password-reset-receipt=receipt-a" },
    "DELETE",
  ));
  assert.equal(cancelled.status, 204);
  assert.equal(cancelled.cookies.get("authon-password-reset-receipt")?.value, "");
  assert.equal(cancelled.cookies.get("authon-password-reset-claim")?.value, "");
  assert.equal(cancellationInput.input.receiptRequestId, "request-a");
  assert.equal(cancellationInput.input.claimGrant.requestId, "request-a");

  let deniedCancelCalls = 0;
  const deniedHandlers = createPasswordResetPublicRouteHandlers(
    publicResetDependencies({
      async cancel() {
        deniedCancelCalls += 1;
      },
    }),
  );
  const crossOriginDelete = await deniedHandlers.DELETE(emptyRequest(
    "/api/auth/password-reset-requests",
    { origin: "https://evil.example" },
    "DELETE",
  ));
  assert.equal(crossOriginDelete.status, 204);
  assert.equal(crossOriginDelete.headers.get("set-cookie"), null);
  assert.equal(deniedCancelCalls, 0);
});

test("public reset handlers map unavailable submission and still clear trusted local proofs", async () => {
  const postScenarios = [
    {
      name: "unknown venue",
      dependencies: {
        getTenant: async () => ({ resolved: false, scope: "unknown", venueId: null }),
      },
      expectedStatus: 404,
      expectedCacheControl: null,
      expectedBody: { code: "UNKNOWN_VENUE", error: "Unknown venue." },
      expectedLog: null,
    },
    {
      name: "missing receipt signing secret",
      dependencies: {
        getEnvironment: () => ({}),
      },
      expectedStatus: 500,
      expectedCacheControl: "no-store",
      expectedBody: {
        code: "SERVER_ERROR",
        error: "Unable to submit the request right now.",
      },
      expectedLog: {
        level: "error",
        entry: {
          event: "auth.password_reset_request",
          requestId: "request-a",
          venueId: "venue-a",
          outcome: "unavailable",
          errorKind: "MissingConfiguration",
        },
      },
    },
  ];

  for (const scenario of postScenarios) {
    const logs = [];
    const handlers = createPasswordResetPublicRouteHandlers(
      publicResetDependencies({
        ...scenario.dependencies,
        async writeStructuredLog(level, entry) {
          logs.push({ level, entry });
        },
      }),
    );
    const response = await handlers.POST(request("/api/auth/password-reset-requests", {
      email: "staff@example.com",
    }));
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.equal(
      response.headers.get("cache-control"),
      scenario.expectedCacheControl,
      scenario.name,
    );
    assert.deepEqual(await response.json(), scenario.expectedBody, scenario.name);
    assert.deepEqual(logs[0] ?? null, scenario.expectedLog, scenario.name);
  }

  let cancelCalls = 0;
  const handlers = createPasswordResetPublicRouteHandlers(publicResetDependencies({
    getEnvironment: () => ({}),
    async cancel() {
      cancelCalls += 1;
    },
  }));
  const response = await handlers.DELETE(emptyRequest(
    "/api/auth/password-reset-requests",
    { cookie: "authon-password-reset-receipt=receipt-a" },
    "DELETE",
  ));
  assert.equal(response.status, 204);
  assert.equal(response.cookies.get("authon-password-reset-receipt")?.value, "");
  assert.equal(response.cookies.get("authon-password-reset-claim")?.value, "");
  assert.equal(cancelCalls, 0);
});

function resetStatusDependencies(overrides = {}) {
  return {
    ...quietRouteDependencies(),
    getEnvironment: () => ({ JWT_SECRET: "secret-a" }),
    consumeRateLimit: async () => ALLOWED,
    getTenant: async () => TENANT,
    getReceiptRequestId: async () => "request-a",
    getClaimGrantRecord: async () => null,
    getStatus: async () => ({
      state: "waiting",
      challenge: "1234",
      expiresAt: null,
      claim: null,
      claimCookieMaxAge: null,
      shouldClearRecoveryCookies: false,
      shouldClearReceiptCookie: false,
    }),
    ...overrides,
  };
}

test("reset status handler denies origin and rate limits without status service calls", async () => {
  let serviceCalls = 0;
  const forbiddenHandler = createPasswordResetStatusGetHandler(
    resetStatusDependencies({
      getEnvironment() {
        throw new Error("cross-origin reset status cannot load its environment");
      },
      async getStatus() {
        serviceCalls += 1;
        throw new Error("cross-origin reset status cannot query");
      },
    }),
  );
  const forbidden = await forbiddenHandler(emptyRequest(
    "/api/auth/password-reset-requests/status",
    { origin: "https://evil.example" },
  ));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("vary"), "Cookie");
  assert.equal(serviceCalls, 0);

  const waitingHandler = createPasswordResetStatusGetHandler(
    resetStatusDependencies({
      getReceiptRequestId: async () => null,
      async consumeRateLimit() {
        throw new Error("proof-less waiting status cannot consume rate limit");
      },
      async getStatus() {
        serviceCalls += 1;
        throw new Error("proof-less waiting status cannot query");
      },
    }),
  );
  const waiting = await waitingHandler(emptyRequest(
    "/api/auth/password-reset-requests/status",
  ));
  assert.equal(waiting.status, 200);
  assert.deepEqual(await waiting.json(), {
    state: "waiting",
    challenge: null,
    expiresAt: null,
  });
  assert.equal(serviceCalls, 0);

  let rateLimitInput;
  const deniedHandler = createPasswordResetStatusGetHandler(
    resetStatusDependencies({
      async consumeRateLimit(input) {
        rateLimitInput = input;
        return DENIED;
      },
      async getTenant() {
        throw new Error("rate-limited reset status cannot resolve a tenant");
      },
      async getStatus() {
        serviceCalls += 1;
        throw new Error("rate-limited reset status cannot query");
      },
    }),
  );
  const denied = await deniedHandler(emptyRequest(
    "/api/auth/password-reset-requests/status",
  ));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "37");
  assert.equal(rateLimitInput.identifier, "203.0.113.8:request-a");
  assert.equal(serviceCalls, 0);
});

test("reset status handler maps approved claim state and rotates proof cookies", async () => {
  let statusInput;
  const handler = createPasswordResetStatusGetHandler(
    resetStatusDependencies({
      async getStatus(input, environment) {
        statusInput = { input, environment };
        return {
          state: "approved",
          challenge: "1234",
          expiresAt: "2026-08-23T12:15:00.000Z",
          claim: "claim-a",
          claimCookieMaxAge: 900,
          shouldClearRecoveryCookies: false,
          shouldClearReceiptCookie: true,
        };
      },
    }),
  );
  const response = await handler(emptyRequest(
    "/api/auth/password-reset-requests/status",
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).state, "approved");
  assert.equal(response.cookies.get("authon-password-reset-claim")?.value, "claim-a");
  assert.equal(response.cookies.get("authon-password-reset-receipt")?.value, "");
  assert.equal(statusInput.input.receiptRequestId, "request-a");
  assert.equal(statusInput.input.secret, "secret-a");
});

test("reset status handler maps unavailable and recovery-cookie outcomes", async () => {
  const scenarios = [
    {
      name: "missing signing secret",
      dependencies: {
        getEnvironment: () => ({}),
      },
      expectedStatus: 500,
      expectedBody: {
        code: "SERVER_ERROR",
        error: "Unable to check the request right now.",
      },
      expectedCookies: [],
      expectedLog: {
        level: "error",
        entry: {
          event: "auth.password_reset_status",
          requestId: "request-a",
          outcome: "unavailable",
          errorKind: "MissingConfiguration",
        },
      },
    },
    {
      name: "expired recovery proof",
      dependencies: {
        getStatus: async () => ({
          state: "expired",
          challenge: "1234",
          expiresAt: "2026-08-23T12:15:00.000Z",
          claim: null,
          claimCookieMaxAge: null,
          shouldClearRecoveryCookies: true,
          shouldClearReceiptCookie: false,
        }),
      },
      expectedStatus: 200,
      expectedBody: {
        state: "expired",
        challenge: "1234",
        expiresAt: "2026-08-23T12:15:00.000Z",
      },
      expectedCookies: [
        "authon-password-reset-claim",
        "authon-password-reset-receipt",
      ],
      expectedLog: null,
    },
  ];

  for (const scenario of scenarios) {
    const logs = [];
    const handler = createPasswordResetStatusGetHandler(resetStatusDependencies({
      ...scenario.dependencies,
      async writeStructuredLog(level, entry) {
        logs.push({ level, entry });
      },
    }));
    const response = await handler(emptyRequest(
      "/api/auth/password-reset-requests/status",
    ));
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.equal(response.headers.get("cache-control"), "private, no-store", scenario.name);
    assert.deepEqual(await response.json(), scenario.expectedBody, scenario.name);
    assert.deepEqual(
      scenario.expectedCookies.map((name) => response.cookies.get(name)?.value),
      scenario.expectedCookies.map(() => ""),
      scenario.name,
    );
    assert.deepEqual(logs[0] ?? null, scenario.expectedLog, scenario.name);
  }
});

function tokenResetDependencies(overrides = {}) {
  return {
    ...quietRouteDependencies(),
    getEnvironment: () => ({ marker: "environment-a" }),
    consumeRateLimit: async () => ALLOWED,
    getTenant: async () => TENANT,
    reset: async () => ({
      status: "success",
      userId: "user-a",
      isInitialSetup: false,
    }),
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    ...overrides,
  };
}

test("token reset handlers keep disabled POST and deny invalid PUT attempts before service", async () => {
  let serviceCalls = 0;
  const handlers = createPasswordResetTokenRouteHandlers(
    tokenResetDependencies({
      async reset() {
        serviceCalls += 1;
        throw new Error("denied token reset cannot execute");
      },
    }),
  );
  const disabled = await handlers.POST();
  assert.equal(disabled.status, 410);
  assert.equal(disabled.headers.get("allow"), "PUT");
  assert.equal((await disabled.json()).code, "EMAIL_RESET_DISABLED");

  const forbidden = await handlers.PUT(request(
    "/api/auth/reset-password",
    { token: "A".repeat(43), newPassword: "Password1" },
    { origin: "https://evil.example" },
    "PUT",
  ));
  assert.equal(forbidden.status, 403);
  assert.equal(serviceCalls, 0);

  const invalid = await handlers.PUT(request(
    "/api/auth/reset-password",
    { token: "invalid", newPassword: "Password1" },
    {},
    "PUT",
  ));
  assert.equal(invalid.status, 400);
  assert.equal(serviceCalls, 0);

  const rateLimitedHandlers = createPasswordResetTokenRouteHandlers(
    tokenResetDependencies({
      consumeRateLimit: async () => DENIED,
      async getTenant() {
        throw new Error("rate-limited token reset cannot resolve tenant");
      },
      async reset() {
        serviceCalls += 1;
        throw new Error("rate-limited token reset cannot execute");
      },
    }),
  );
  const denied = await rateLimitedHandlers.PUT(request(
    "/api/auth/reset-password",
    { token: "A".repeat(43), newPassword: "Password1" },
    {},
    "PUT",
  ));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "37");
  assert.equal(serviceCalls, 0);
});

test("token reset PUT delegates prepared token, tenant, and operation time", async () => {
  let resetInput;
  const handlers = createPasswordResetTokenRouteHandlers(
    tokenResetDependencies({
      async reset(input, environment, operationNow) {
        resetInput = { input, environment, operationNow };
        return {
          status: "success",
          userId: "user-a",
          isInitialSetup: true,
        };
      },
    }),
  );
  const response = await handlers.PUT(request(
    "/api/auth/reset-password",
    { token: "A".repeat(43), newPassword: "Password1" },
    {},
    "PUT",
  ));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.deepEqual(resetInput.input, {
    token: "A".repeat(43),
    newPassword: "Password1",
    expectedVenueId: "venue-a",
  });
  assert.deepEqual(resetInput.environment, { marker: "environment-a" });
  assert.equal(resetInput.operationNow.toISOString(), "2026-08-23T12:00:00.000Z");
});

test("token reset handler maps unknown venues and consumed tokens", async () => {
  const scenarios = [
    {
      name: "unknown venue",
      dependencies: {
        getTenant: async () => ({ resolved: false, scope: "unknown", venueId: null }),
        async reset() {
          throw new Error("unknown venue cannot reset a password");
        },
      },
      expectedStatus: 404,
      expectedBody: { error: "Unknown venue." },
    },
    {
      name: "consumed token",
      dependencies: {
        reset: async () => ({ status: "invalid_token" }),
      },
      expectedStatus: 400,
      expectedBody: { error: "유효하지 않거나 만료된 토큰입니다." },
    },
  ];

  for (const scenario of scenarios) {
    const handlers = createPasswordResetTokenRouteHandlers(
      tokenResetDependencies(scenario.dependencies),
    );
    const response = await handlers.PUT(request(
      "/api/auth/reset-password",
      { token: "A".repeat(43), newPassword: "Password1" },
      {},
      "PUT",
    ));
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.deepEqual(await response.json(), scenario.expectedBody, scenario.name);
  }
});

function logoutDependencies(overrides = {}) {
  return {
    ...quietRouteDependencies(),
    getEnvironment: () => ({
      JWT_SECRET: "secret-a",
      SESSIONS: {},
      DB: {},
    }),
    logout: async () => ({
      cleanupFailed: false,
      revocationPending: false,
      failures: [],
    }),
    ...overrides,
  };
}

test("logout handler denies untrusted or unavailable credentials without service calls", async () => {
  let serviceCalls = 0;
  const forbiddenHandler = createLogoutPostHandler(logoutDependencies({
    getEnvironment() {
      throw new Error("cross-origin logout cannot load its environment");
    },
    async logout() {
      serviceCalls += 1;
      throw new Error("cross-origin logout cannot execute");
    },
  }));
  const forbidden = await forbiddenHandler(emptyRequest(
    "/api/auth/logout",
    {
      origin: "https://evil.example",
      cookie: "token=token-a; sessionId=session-a",
    },
    "POST",
  ));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("set-cookie"), null);
  assert.equal(serviceCalls, 0);

  const unavailableHandler = createLogoutPostHandler(logoutDependencies({
    getEnvironment: () => ({ JWT_SECRET: "", SESSIONS: null, DB: null }),
    async logout() {
      serviceCalls += 1;
      throw new Error("unavailable logout cannot execute");
    },
  }));
  const unavailable = await unavailableHandler(emptyRequest(
    "/api/auth/logout",
    { cookie: "token=token-a; sessionId=session-a" },
    "POST",
  ));
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, "SESSION_REVOCATION_PENDING");
  assert.equal(unavailable.headers.get("set-cookie"), null);
  assert.equal(serviceCalls, 0);
});

test("logout handler only clears cookies after a completed revocation", async () => {
  const scenarios = [
    {
      name: "completed revocation",
      result: {
        cleanupFailed: false,
        revocationPending: false,
        failures: [],
      },
      expectedStatus: 200,
      expectedCode: undefined,
      shouldClearCookies: true,
    },
    {
      name: "pending revocation",
      result: {
        cleanupFailed: true,
        revocationPending: true,
        failures: [],
      },
      expectedStatus: 503,
      expectedCode: "SESSION_REVOCATION_PENDING",
      shouldClearCookies: false,
    },
  ];

  for (const scenario of scenarios) {
    let logoutInput;
    const handler = createLogoutPostHandler(logoutDependencies({
      async logout(input) {
        logoutInput = input;
        return scenario.result;
      },
    }));
    const response = await handler(emptyRequest(
      "/api/auth/logout",
      { cookie: "other=x; token=token-a; sessionId=session-a" },
      "POST",
    ));
    const body = await response.json();
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.equal(body.code, scenario.expectedCode, scenario.name);
    assert.deepEqual(logoutInput, {
      token: "token-a",
      sessionId: "session-a",
    }, scenario.name);
    if (scenario.shouldClearCookies) {
      assert.equal(response.cookies.get("token")?.value, "", scenario.name);
      assert.equal(response.cookies.get("sessionId")?.value, "", scenario.name);
    } else {
      assert.equal(response.headers.get("set-cookie"), null, scenario.name);
    }
  }
});
