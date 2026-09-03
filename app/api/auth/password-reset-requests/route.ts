import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createPasswordResetPublicPersistence } from "@/lib/auth/password-reset-public-persistence";
import { createPasswordResetPublicRouteHandlers } from "@/lib/auth/password-reset-public-route-handler";
import {
  cancelPublicPasswordResetRequest,
  submitPublicPasswordResetRequest,
} from "@/lib/auth/password-reset-public-service";
import {
  getPasswordResetClaimGrantRecord,
  getPasswordResetReceiptRequestId,
} from "@/lib/auth/password-reset-receipt";
import { consumeRateLimitOrDeny } from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";

const handlers = createPasswordResetPublicRouteHandlers({
  getEnvironment: () => getCloudflareContext().env,
  consumeRateLimit: consumeRateLimitOrDeny,
  getTenant: getTenantContextForRequest,
  getReceiptRequestId: getPasswordResetReceiptRequestId,
  getClaimGrantRecord: getPasswordResetClaimGrantRecord,
  submit: (input, env) =>
    submitPublicPasswordResetRequest(input, {
      persistence: createPasswordResetPublicPersistence(env.DB),
    }),
  cancel: (input, env) =>
    cancelPublicPasswordResetRequest(input, {
      persistence: createPasswordResetPublicPersistence(env.DB),
    }),
});

/**
 * 공개 관리자 재설정 요청. 계정 존재 여부와 기존 open request 여부를 같은
 * 202 응답으로 숨긴다.
 */
export const POST = handlers.POST;

/** 현재 browser proof를 포기하고 recovery cookie를 제거한다. */
export const DELETE = handlers.DELETE;
