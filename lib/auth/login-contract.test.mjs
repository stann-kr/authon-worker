import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, handler, service, persistence, session] = await Promise.all([
  readFile(new URL("../../app/api/auth/login/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./login-route-handler.ts", import.meta.url), "utf8"),
  readFile(new URL("./login-service.ts", import.meta.url), "utf8"),
  readFile(new URL("./login-persistence.ts", import.meta.url), "utf8"),
  readFile(new URL("./login-session.ts", import.meta.url), "utf8"),
]);

test("login production route wires only capability adapters into its executable handler", () => {
  assert.match(route, /createLoginPostHandler/);
  assert.match(route, /consumeRateLimitOrDeny/);
  assert.match(route, /getTenant: getTenantContextForRequest/);
  assert.match(route, /loginWithPassword/);
  assert.match(route, /createLoginPersistence\(env\)/);
  assert.match(route, /createLoginSessionAdapter\(env\)/);
  assert.doesNotMatch(route, /drizzle|db\/schema|\.prepare\(|\.batch\(|verifyPassword|hashPassword|SignJWT|SESSIONS\.put/);
});

test("login handler owns HTTP, origin, rate-limit, response, cookie, and log policy", () => {
  assert.match(handler, /isTrustedMutationOrigin\(request\)/);
  assert.match(handler, /dependencies\.consumeRateLimit/);
  assert.match(handler, /dependencies\.getTenant\(request\)/);
  assert.match(handler, /dependencies\.login/);
  assert.match(handler, /PASSWORD_SETUP_REQUIRED/);
  assert.match(handler, /MISSING_CREDENTIALS/);
  assert.match(handler, /INVALID_CREDENTIALS/);
  assert.match(handler, /RATE_LIMITED/);
  assert.match(handler, /SERVER_ERROR/);
  assert.match(handler, /"Retry-After"/);
  assert.match(handler, /\["token", result\.session\.token\]/);
  assert.match(handler, /\["sessionId", result\.session\.sessionId\]/);
  assert.match(handler, /maxAge: result\.session\.lifetime\.ttlSeconds/);
  assert.match(handler, /name: LOCALE_COOKIE_NAME/);
  assert.match(handler, /maxAge: LOCALE_COOKIE_MAX_AGE/);
  assert.match(handler, /auth\.login/);
  assert.doesNotMatch(
    handler,
    /drizzle|db\/schema|\.prepare\(|\.batch\(|verifyPassword|hashPassword|SignJWT|SESSIONS\.put/,
  );
});

test("login service owns credential eligibility, dummy verification, setup history, CAS orchestration", () => {
  assert.match(service, /verifyPasswordWithDummies/);
  assert.match(service, /findLatestSetupCodeRequest\(lookupUserId\)/);
  assert.match(service, /isEligible \? user\.passwordHash : null/);
  assert.match(service, /needsRehash/);
  assert.match(service, /commitLogin/);
  assert.match(service, /session\.createSession/);
  assert.ok(service.indexOf("commitLogin") < service.indexOf("session.createSession"));
});

test("persistence keeps the candidate, setup-history, and ordered login/reset batch boundary", () => {
  assert.match(persistence, /SELECT_LATEST_SETUP_CODE_REQUEST_SQL/);
  assert.match(persistence, /UPDATE_USER_FOR_LOGIN_SQL/);
  assert.match(persistence, /CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL/);
  assert.match(persistence, /env\.DB\.batch/);
  assert.ok(
    persistence.indexOf("env.DB.prepare(UPDATE_USER_FOR_LOGIN_SQL)") <
      persistence.indexOf("env.DB.prepare(CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL)"),
  );
});

test("session adapter retains login lifetime, signed JWT, and KV storage ownership", () => {
  assert.match(session, /createLoginSessionLifetime\(input\.keepSignedIn === true\)/);
  assert.match(session, /new SignJWT/);
  assert.match(session, /expirationTtl: lifetime\.storageTtlSeconds/);
  assert.match(session, /createStoredSession/);
});
