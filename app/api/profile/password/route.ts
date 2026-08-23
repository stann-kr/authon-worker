import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createProfilePasswordPersistence } from "@/lib/auth/profile-password-persistence";
import { createProfilePasswordPutHandler } from "@/lib/auth/profile-password-route-handler";
import { changeProfilePassword } from "@/lib/auth/profile-password-service";
import { consumeRateLimitOrDeny } from "@/lib/auth/rate-limit";
import { requireAuth } from "@/lib/auth/server";

export const PUT = createProfilePasswordPutHandler({
  getEnvironment: () => getCloudflareContext().env,
  requireAuth,
  consumeRateLimit: consumeRateLimitOrDeny,
  changePassword: (input, env) =>
    changeProfilePassword(input, {
      persistence: createProfilePasswordPersistence(env),
    }),
});
