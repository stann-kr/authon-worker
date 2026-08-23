import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, service, persistence] = await Promise.all([
  readFile(new URL("../../app/api/auth/claim-account/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./account-claim-service.ts", import.meta.url), "utf8"),
  readFile(new URL("./account-claim-persistence.ts", import.meta.url), "utf8"),
]);

test("account claim route retains request, tenant, response, cookie, and telemetry ownership", () => {
  assert.match(route, /isTrustedMutationOrigin\(request\)/);
  assert.match(route, /await request\.json\(\)\.catch/);
  assert.match(route, /consumeRateLimitOrDeny/);
  assert.match(route, /getTenantContextForRequest\(request\)/);
  assert.match(route, /claimAccount\(/);
  assert.match(route, /createAccountClaimPersistence\(env\.DB\)/);
  assert.match(route, /PASSWORD_RESET_CLAIM_COOKIE_NAME/);
  assert.match(route, /PASSWORD_RESET_RECEIPT_COOKIE_NAME/);
  assert.match(route, /signedReceiptRequestId === result\.requestId/);
  assert.match(route, /writeStructuredLog\("info"/);
  assert.match(route, /reportServerError\("auth\.account_claim"/);
  assert.doesNotMatch(route, /env\.DB\.prepare|env\.DB\.batch|SELECT u\.id|UPDATE_USER_WITH_APPROVED_RESET_SQL/);
});

test("account claim service owns proof eligibility, snapshot hashing, and CAS orchestration", () => {
  assert.match(service, /findBrowserReceiptCandidate/);
  assert.match(service, /findSetupCodeCandidate/);
  assert.match(service, /getPasswordPolicyErrorCode/);
  assert.match(service, /DUMMY_PASSWORD_HASH/);
  assert.match(service, /has_setup_code_history === 0/);
  assert.match(service, /claimGrantExpiresAt <= credentialChangedAt/);
  assert.match(service, /candidate\.password_hash/);
  assert.match(service, /consumeClaim/);
  assert.match(service, /exactRequestId: candidate\.request_id \?\? ""/);
});

test("account claim persistence keeps tenant-scoped candidates and audit-gated ordered D1 batch", () => {
  assert.match(persistence, /pr\.source = 'self_service'/);
  assert.match(persistence, /pr\.setup_method = 'admin_approved'/);
  assert.match(persistence, /u\.account_kind = 'personal'/);
  assert.match(persistence, /candidate_venue\.active = 1/);
  assert.match(persistence, /reset_actor\.active = 1/);
  assert.match(persistence, /ORDER BY pr\.decided_at DESC, pr\.id DESC/);
  assert.match(persistence, /u\.migration_status = 'pending_reset'/);
  assert.match(persistence, /u\.password_set_at IS NULL/);
  const updateIndex = persistence.lastIndexOf("UPDATE_USER_WITH_APPROVED_RESET_SQL");
  const auditIndex = persistence.lastIndexOf("INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL");
  const completeIndex = persistence.lastIndexOf("COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL");
  const invalidateIndex = persistence.lastIndexOf("INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL");
  const cancelIndex = persistence.lastIndexOf("CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL");
  assert.ok(updateIndex < auditIndex);
  assert.ok(auditIndex < completeIndex);
  assert.ok(completeIndex < invalidateIndex);
  assert.ok(invalidateIndex < cancelIndex);
  assert.match(persistence, /candidate\.password_hash/);
  assert.match(persistence, /candidate\.session_version/);
});
