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
