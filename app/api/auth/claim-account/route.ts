import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createAccountClaimPersistence } from "@/lib/auth/account-claim-persistence";
import { createAccountClaimPostHandler } from "@/lib/auth/account-claim-route-handler";
import {
  accountClaimPasswordDependencies,
  claimAccount,
} from "@/lib/auth/account-claim-service";
import {
  getPasswordResetClaimGrant,
  getPasswordResetReceiptRequestId,
} from "@/lib/auth/password-reset-receipt";
import { consumeRateLimitOrDeny } from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";

/**
 * Browser-bound 관리자 승인 또는 유효한 1회용 설정 코드를 원자적으로 소비한다.
 */
export const POST = createAccountClaimPostHandler({
  getEnvironment: () => getCloudflareContext().env,
  consumeRateLimit: consumeRateLimitOrDeny,
  getTenant: getTenantContextForRequest,
  getReceiptRequestId: getPasswordResetReceiptRequestId,
  getClaimGrant: getPasswordResetClaimGrant,
  claim: (input, env) =>
    claimAccount(input, {
      persistence: createAccountClaimPersistence(env.DB),
      ...accountClaimPasswordDependencies,
      createOperationId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    }),
});
