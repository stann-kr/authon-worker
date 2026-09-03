import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, handler, service, persistence] = await Promise.all([
  readFile(new URL("../../app/api/auth/reset-password/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./password-reset-token-route-handler.ts", import.meta.url), "utf8"),
  readFile(new URL("./password-reset-token-service.ts", import.meta.url), "utf8"),
  readFile(new URL("./password-reset-token-persistence.ts", import.meta.url), "utf8"),
]);

test("token reset production route retains only dependency wiring", () => {
  assert.match(route, /createPasswordResetTokenRouteHandlers/);
  assert.match(route, /consumeRateLimitOrDeny/);
  assert.match(route, /getTenant: getTenantContextForRequest/);
  assert.match(route, /resetPasswordWithToken/);
  assert.match(route, /createPasswordResetTokenPersistence/);
  assert.doesNotMatch(
    route,
    /\.prepare\(|\.batch\(|credential-lifecycle-sql|hashPassword|hashResetToken/,
  );
});

test("token reset handler owns origin, input, rate-limit, and response policy", () => {
  assert.match(handler, /isTrustedMutationOrigin\(request\)/);
  assert.match(handler, /dependencies\.consumeRateLimit/);
  assert.match(handler, /dependencies\.getTenant\(request\)/);
  assert.match(handler, /prepareTokenPasswordReset/);
  assert.match(handler, /dependencies\.reset/);
  assert.match(handler, /EMAIL_RESET_DISABLED/);
  assert.match(handler, /\{ status: 410, headers: \{ Allow: "PUT" \} \}/);
  assert.doesNotMatch(
    handler,
    /createPasswordResetTokenPersistence|\.prepare\(|\.batch\(|credential-lifecycle-sql|hashPassword|hashResetToken/,
  );
});

test("token reset service owns password policy, hashing, and credential mutation", () => {
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
