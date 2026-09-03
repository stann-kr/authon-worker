import { SignJWT } from "jose";

import {
  createLoginSessionLifetime,
  createStoredSession,
  type SessionLifetime,
} from "./session-policy.ts";

export interface LoginSessionUser {
  id: string;
  email: string;
  role: string;
  venueId: string | null;
}

export interface CreatedLoginSession {
  token: string;
  sessionId: string;
  lifetime: SessionLifetime;
}

export interface LoginSessionAdapter {
  isConfigured(): boolean;
  createSession(input: {
    user: LoginSessionUser;
    sessionVersion: number;
    keepSignedIn: boolean;
  }): Promise<CreatedLoginSession>;
}

export function createLoginSessionAdapter(
  env: Pick<CloudflareEnv, "JWT_SECRET" | "SESSIONS">,
): LoginSessionAdapter {
  return {
    isConfigured() {
      return Boolean(env.JWT_SECRET);
    },

    async createSession(input) {
      if (!env.JWT_SECRET) throw new Error("JWT secret is required");

      const lifetime = createLoginSessionLifetime(input.keepSignedIn === true);
      const token = await new SignJWT({
        sub: input.user.id,
        email: input.user.email,
        role: input.user.role,
        venueId: input.user.venueId,
        sv: input.sessionVersion,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(lifetime.issuedAtSeconds)
        .setExpirationTime(lifetime.expiresAtSeconds)
        .sign(new TextEncoder().encode(env.JWT_SECRET));

      const sessionId = crypto.randomUUID();
      await env.SESSIONS.put(
        `session:${sessionId}`,
        JSON.stringify(createStoredSession(input.user.id, input.sessionVersion, lifetime)),
        { expirationTtl: lifetime.storageTtlSeconds },
      );
      return { token, sessionId, lifetime };
    },
  };
}
