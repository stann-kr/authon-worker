import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, service, persistence] = await Promise.all([
  readFile(new URL("../../app/api/auth/reset-password/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./password-reset-token-service.ts", import.meta.url), "utf8"),
  readFile(new URL("./password-reset-token-persistence.ts", import.meta.url), "utf8"),
]);

test("token reset route retains transport policy and delegates credential state", () => {
  assert.match(route, /isTrustedMutationOrigin\(request\)/);
  assert.match(route, /consumeRateLimitOrDeny/);
  assert.match(route, /getTenantContextForRequest\(request\)/);
  assert.match(route, /prepareTokenPasswordReset/);
  assert.match(route, /resetPasswordWithToken/);
  assert.match(route, /EMAIL_RESET_DISABLED/);
  assert.match(route, /\{ status: 410, headers: \{ Allow: "PUT" \} \}/);
  assert.doesNotMatch(
    route,
    /\.prepare\(|\.batch\(|credential-lifecycle-sql|hashPassword|hashResetToken/,
  );
  assert.match(service, /getPasswordPolicyError/);
  assert.match(service, /loadCandidate/);
  assert.match(service, /hashPassword/);
  assert.match(service, /commit/);
});

test("token persistence keeps the one-winner SQL sequence in one D1 batch", () => {
  const batchSource = persistence.slice(persistence.indexOf("database.batch"));
  const updateIndex = batchSource.indexOf("UPDATE_PASSWORD_WITH_VALID_TOKEN_SQL");
  const consumeIndex = batchSource.indexOf("CONSUME_EXACT_RESET_TOKEN_SQL");
  const auditIndex = batchSource.indexOf("INSERT_TOKEN_RESET_AUDIT_SQL");
  const invalidateIndex = batchSource.indexOf(
    "INVALIDATE_ALL_USER_RESET_TOKENS_SQL",
  );
  const completeIndex = batchSource.indexOf(
    "COMPLETE_TOKEN_RESET_REQUESTS_SQL",
  );
  assert.match(persistence, /database\.batch/);
  assert.ok(
    updateIndex >= 0 &&
      updateIndex < consumeIndex &&
      consumeIndex < auditIndex &&
      auditIndex < invalidateIndex &&
      invalidateIndex < completeIndex,
  );
});
