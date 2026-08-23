import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, service, persistence] = await Promise.all([
  readFile(new URL("../../app/api/profile/password/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./profile-password-service.ts", import.meta.url), "utf8"),
  readFile(new URL("./profile-password-persistence.ts", import.meta.url), "utf8"),
]);

test("profile password route keeps auth and cookie mapping without persistence I/O", () => {
  assert.match(route, /requireAuth\(\)/);
  assert.match(route, /changeProfilePassword/);
  assert.match(route, /createProfilePasswordPersistence\(env\)/);
  assert.equal(route.match(/response\.cookies\.set/g)?.length, 2);
  assert.match(route, /reauthRequired: true/);
  assert.match(route, /auth\.profile_password\.session_cleanup/);
  assert.doesNotMatch(
    route,
    /drizzle|db\/schema|\.prepare\(|\.batch\(|verifyPassword|hashPassword/,
  );
  assert.match(service, /verifyPassword/);
  assert.match(service, /commitChange/);
  assert.match(service, /deleteSession/);
  assert.match(persistence, /UPDATE_PROFILE_PASSWORD_CAS_SQL/);
  assert.match(persistence, /INSERT_PROFILE_PASSWORD_AUDIT_SQL/);
  assert.match(persistence, /env\.DB\.batch/);
});
