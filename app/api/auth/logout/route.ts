import { getCloudflareContext } from "@opennextjs/cloudflare";
import { errors as joseErrors, jwtVerify } from "jose";

import { createLogoutPersistence } from "@/lib/auth/logout-persistence";
import { createLogoutPostHandler } from "@/lib/auth/logout-route-handler";
import { logoutSession } from "@/lib/auth/logout-service";

export const POST = createLogoutPostHandler({
  getEnvironment: () => getCloudflareContext().env,
  logout: (input, env) =>
    logoutSession(input, {
      persistence: createLogoutPersistence(env),
      verifyToken: async (candidateToken) => {
        const { payload } = await jwtVerify(
          candidateToken,
          new TextEncoder().encode(env.JWT_SECRET),
          { algorithms: ["HS256"], clockTolerance: 60 },
        );
        return { userId: payload.sub, sessionVersion: payload.sv };
      },
      isInvalidTokenError: (error) => error instanceof joseErrors.JOSEError,
    }),
});
