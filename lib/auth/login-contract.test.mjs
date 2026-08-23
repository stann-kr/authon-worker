import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, service, persistence, session] = await Promise.all([
  readFile(new URL("../../app/api/auth/login/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./login-service.ts", import.meta.url), "utf8"),
  readFile(new URL("./login-persistence.ts", import.meta.url), "utf8"),
  readFile(new URL("./login-session.ts", import.meta.url), "utf8"),
]);

test("login route retains HTTP, rate-limit, tenant, cookie, and log ownership", () => {
  assert.match(route, /isTrustedMutationOrigin\(request\)/);
  assert.match(route, /consumeRateLimitOrDeny/);
  assert.match(route, /getTenantContextForRequest\(request\)/);
  assert.match(route, /loginWithPassword/);
  assert.match(route, /PASSWORD_SETUP_REQUIRED/);
  assert.match(route, /MISSING_CREDENTIALS/);
  assert.match(route, /INVALID_CREDENTIALS/);
  assert.match(route, /RATE_LIMITED/);
  assert.match(route, /SERVER_ERROR/);
  assert.match(route, /"Retry-After"/);
  assert.match(route, /\["token", result\.session\.token\]/);
  assert.match(route, /\["sessionId", result\.session\.sessionId\]/);
  assert.match(route, /maxAge: result\.session\.lifetime\.ttlSeconds/);
  assert.match(route, /name: LOCALE_COOKIE_NAME/);
  assert.match(route, /maxAge: LOCALE_COOKIE_MAX_AGE/);
  assert.match(route, /auth\.login/);
  assert.doesNotMatch(route, /drizzle|db\/schema|\.prepare\(|\.batch\(|verifyPassword|hashPassword|SignJWT|SESSIONS\.put/);
});

test("login service owns credential eligibility, dummy verification, setup history, CAS orchestration", () => {
  assert.match(service, /DUMMY_PASSWORD_HASH/);
  assert.match(service, /findLatestSetupCodeRequest\(lookupUserId\)/);
  assert.match(service, /isEligible \? user\.passwordHash : DUMMY_PASSWORD_HASH/);
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
