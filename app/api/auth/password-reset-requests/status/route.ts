import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createPasswordResetPublicPersistence } from "@/lib/auth/password-reset-public-persistence";
import { getPublicPasswordResetStatus } from "@/lib/auth/password-reset-public-service";
import {
  getPasswordResetClaimGrantRecord,
  getPasswordResetReceiptRequestId,
} from "@/lib/auth/password-reset-receipt";
import { createPasswordResetStatusGetHandler } from "@/lib/auth/password-reset-status-route-handler";
import { consumeRateLimitOrDeny } from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";

/**
 * 서명된 browser proof가 가리키는 exact request의 direct 승인만 공개한다.
 */
export const GET = createPasswordResetStatusGetHandler({
  getEnvironment: () => getCloudflareContext().env,
  consumeRateLimit: consumeRateLimitOrDeny,
  getTenant: getTenantContextForRequest,
  getReceiptRequestId: getPasswordResetReceiptRequestId,
  getClaimGrantRecord: getPasswordResetClaimGrantRecord,
  getStatus: (input, env) =>
    getPublicPasswordResetStatus(input, {
      persistence: createPasswordResetPublicPersistence(env.DB),
    }),
});
