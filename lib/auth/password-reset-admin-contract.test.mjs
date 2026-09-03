import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [facade, service, persistence] = await Promise.all([
  readFile(new URL("../api/password-reset-requests.ts", import.meta.url), "utf8"),
  readFile(new URL("./password-reset-admin-service.ts", import.meta.url), "utf8"),
  readFile(new URL("./password-reset-admin-persistence.ts", import.meta.url), "utf8"),
]);

test("password-reset admin action delegates policy and D1 mutation boundaries", () => {
  assert.match(facade, /requireRole\(\["super_admin", "venue_admin"\]\)/);
  assert.match(facade, /startAdminManagedPasswordReset/);
  assert.match(facade, /createDependencies\(env\.DB\)/);
  assert.doesNotMatch(
    facade,
    /drizzle|db\/schema|\.prepare\(|\.batch\(|hashPassword|MANAGEABLE_PASSWORD_RESET_TARGET_SQL/,
  );
  assert.match(service, /getAdminApprovedResetPolicyError/);
  assert.match(service, /verifyChallenge/);
  assert.match(service, /requireActiveVenueId/);
  assert.match(service, /approveBrowserRequest/);
  assert.match(persistence, /database\.batch/);
  assert.match(persistence, /changes\(\) = 1/);
  assert.match(persistence, /APPROVE_BROWSER_PASSWORD_RESET_SQL/);
  assert.match(persistence, /SET_USER_SETUP_CODE_FOR_REQUEST_SQL/);
});
