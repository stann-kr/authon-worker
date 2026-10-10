import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, handler, service, persistence] = await Promise.all([
  readFile(new URL("../../app/api/profile/password/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./profile-password-route-handler.ts", import.meta.url), "utf8"),
  readFile(new URL("./profile-password-service.ts", import.meta.url), "utf8"),
  readFile(new URL("./profile-password-persistence.ts", import.meta.url), "utf8"),
]);

test("profile password production route wires auth, rate-limit, and capability adapters", () => {
  assert.match(route, /createProfilePasswordPutHandler/);
  assert.match(route, /requireAuth/);
  assert.match(route, /consumeRateLimitOrDeny/);
  assert.match(route, /changeProfilePassword/);
  assert.match(route, /createProfilePasswordPersistence\(env\)/);
  assert.doesNotMatch(
    route,
    /drizzle|db\/schema|\.prepare\(|\.batch\(|verifyPassword|hashPassword/,
  );
});

test("profile password handler owns origin, actor+IP rate-limit, response, and cookie policy", () => {
  assert.match(handler, /isTrustedMutationOrigin\(request\)/);
  assert.match(handler, /dependencies\.requireAuth\(\)/);
  assert.match(handler, /dependencies\.consumeRateLimit/);
  assert.match(handler, /identifier: `\$\{authUser\.id\}:\$\{getRequestIp\(request\)\}`/);
  assert.match(handler, /RATE_LIMITED/);
  assert.match(handler, /"Retry-After"/);
  assert.match(handler, /dependencies\.changePassword/);
  assert.equal(handler.match(/response\.cookies\.set/g)?.length, 2);
  assert.match(handler, /reauthRequired: true/);
  assert.match(handler, /auth\.profile_password\.session_cleanup/);
  assert.doesNotMatch(
    handler,
    /drizzle|db\/schema|\.prepare\(|\.batch\(|verifyPassword|hashPassword/,
  );
  assert.match(service, /verifyPassword/);
  assert.match(service, /commitChange/);
  assert.match(service, /deleteSession/);
  assert.match(persistence, /UPDATE_PROFILE_PASSWORD_CAS_SQL/);
  assert.match(persistence, /INSERT_PROFILE_PASSWORD_AUDIT_SQL/);
  assert.match(persistence, /env\.DB\.batch/);
});

test("profile password failures keep their status and expose stable error codes", async () => {
  await import("tsx");
  const { createProfilePasswordPutHandler } = await import(
    "./profile-password-route-handler.ts"
  );
  const scenarios = [
    { result: { status: "missing" }, status: 400, code: "VALIDATION" },
    {
      result: {
        status: "policy_error",
        error: "Password must be at least 8 characters.",
      },
      status: 400,
      code: "PASSWORD_POLICY",
    },
    { result: { status: "user_not_found" }, status: 404, code: "USER_NOT_FOUND" },
    {
      result: { status: "password_mismatch" },
      status: 400,
      code: "PASSWORD_MISMATCH",
    },
    { result: { status: "conflict" }, status: 409, code: "ACCOUNT_STATE_CHANGED" },
    { thrown: new Error("Unauthorized"), status: 401, code: "UNAUTHORIZED" },
    { thrown: new Error("D1 unavailable"), status: 500, code: "SERVER_ERROR" },
  ];

  for (const scenario of scenarios) {
    const handler = createProfilePasswordPutHandler({
      getRequestId: () => "request-a",
      reportServerError: async () => {},
      writeStructuredLog: async () => ({}),
      getEnvironment: () => ({}),
      requireAuth: async () => ({ id: "user-a" }),
      consumeRateLimit: async () => ({
        allowed: true,
        remaining: 4,
        retryAfterSeconds: 900,
      }),
      changePassword: async () => {
        if (scenario.thrown) throw scenario.thrown;
        return scenario.result;
      },
    });
    const response = await handler(
      new Request("https://venue.example.com/api/profile/password", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          host: "venue.example.com",
          origin: "https://venue.example.com",
          cookie: "sessionId=session-a; token=token-a",
        },
        body: JSON.stringify({
          currentPassword: "OldPassword1",
          newPassword: "NewPassword1",
        }),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, scenario.status, scenario.code);
    assert.equal(body.code, scenario.code);
    assert.equal(typeof body.error, "string");
    // A failed change never clears the current session cookies.
    assert.equal(response.headers.get("set-cookie"), null, scenario.code);
  }
});

test("profile password client feedback maps codes to specific copy and focus targets", async () => {
  const { selectProfilePasswordError } = await import(
    "./profile-password-feedback.ts"
  );
  assert.deepEqual(selectProfilePasswordError("PASSWORD_MISMATCH"), {
    key: "currentPasswordIncorrect",
    target: "currentPassword",
  });
  assert.deepEqual(selectProfilePasswordError("RATE_LIMITED"), {
    key: "passwordRateLimited",
    target: "form",
  });
  assert.deepEqual(selectProfilePasswordError("ACCOUNT_STATE_CHANGED"), {
    key: "passwordAccountChanged",
    target: "form",
  });
  assert.equal(selectProfilePasswordError("UNAUTHORIZED").key, "sessionUnavailable");
  for (const unknown of ["SERVER_ERROR", undefined, null, 42]) {
    assert.deepEqual(selectProfilePasswordError(unknown), {
      key: "passwordUpdateFailed",
      target: "form",
    });
  }
});
