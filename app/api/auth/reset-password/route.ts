import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createPasswordResetTokenPersistence } from "@/lib/auth/password-reset-token-persistence";
import { createPasswordResetTokenRouteHandlers } from "@/lib/auth/password-reset-token-route-handler";
import { resetPasswordWithToken } from "@/lib/auth/password-reset-token-service";
import { consumeRateLimitOrDeny } from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";

const handlers = createPasswordResetTokenRouteHandlers({
  getEnvironment: () => getCloudflareContext().env,
  consumeRateLimit: consumeRateLimitOrDeny,
  getTenant: getTenantContextForRequest,
  reset: (input, env, operationNow) =>
    resetPasswordWithToken(input, {
      persistence: createPasswordResetTokenPersistence(env.DB),
      now: () => operationNow,
    }),
});

/** 자가 이메일 token 발급은 비활성화되어 있다. */
export const POST = handlers.POST;

/** 이미 발급된 one-time token을 소비한다. */
export const PUT = handlers.PUT;
