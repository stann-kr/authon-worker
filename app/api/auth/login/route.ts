import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createLoginPersistence } from "@/lib/auth/login-persistence";
import { createLoginPostHandler } from "@/lib/auth/login-route-handler";
import { createLoginSessionAdapter } from "@/lib/auth/login-session";
import { loginWithPassword } from "@/lib/auth/login-service";
import { consumeRateLimitOrDeny } from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";

export const POST = createLoginPostHandler({
  getEnvironment: () => getCloudflareContext().env,
  consumeRateLimit: consumeRateLimitOrDeny,
  getTenant: getTenantContextForRequest,
  login: (input, env) =>
    loginWithPassword(input, {
      persistence: createLoginPersistence(env),
      session: createLoginSessionAdapter(env),
    }),
});
