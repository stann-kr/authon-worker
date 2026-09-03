import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { users } from "../db/schema";
import {
  CANCEL_PROFILE_RESET_REQUESTS_SQL,
  INSERT_PROFILE_PASSWORD_AUDIT_SQL,
  INVALIDATE_PROFILE_RESET_TOKENS_SQL,
  UPDATE_PROFILE_PASSWORD_CAS_SQL,
} from "./credential-lifecycle-sql";

export interface ProfilePasswordUser {
  id: string;
  venueId: string | null;
  passwordHash: string;
  sessionVersion: number;
  active: boolean;
}

export interface ProfilePasswordPersistence {
  loadUser(userId: string): Promise<ProfilePasswordUser | null>;
  commitChange(input: {
    user: ProfilePasswordUser;
    passwordHash: string;
    nowIso: string;
    auditEventId: string;
  }): Promise<{ updatedUserId: string | null; auditedUserId: string | null }>;
  deleteSession(sessionId: string): Promise<void>;
}

export function createProfilePasswordPersistence(
  env: Pick<CloudflareEnv, "DB" | "SESSIONS">,
): ProfilePasswordPersistence {
  const db = drizzle(env.DB);
  return {
    async loadUser(userId) {
      const [user] = await db
        .select({
          id: users.id,
          venueId: users.venueId,
          passwordHash: users.passwordHash,
          sessionVersion: users.sessionVersion,
          active: users.active,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return user ?? null;
    },

    async commitChange(input) {
      const [passwordResult, auditResult] = await env.DB.batch<{
        id?: string;
        target_user_id?: string;
      }>([
        env.DB.prepare(UPDATE_PROFILE_PASSWORD_CAS_SQL).bind(
          input.passwordHash,
          input.nowIso,
          input.user.id,
          input.user.passwordHash,
          input.user.sessionVersion,
        ),
        env.DB.prepare(INSERT_PROFILE_PASSWORD_AUDIT_SQL).bind(
          input.auditEventId,
          JSON.stringify({ method: "authenticated_profile" }),
          input.nowIso,
          input.user.id,
        ),
        env.DB.prepare(INVALIDATE_PROFILE_RESET_TOKENS_SQL).bind(
          input.user.id,
          input.auditEventId,
          input.user.id,
        ),
        env.DB.prepare(CANCEL_PROFILE_RESET_REQUESTS_SQL).bind(
          input.nowIso,
          input.user.id,
          input.auditEventId,
          input.user.id,
        ),
      ]);
      return {
        updatedUserId:
          (passwordResult.results?.[0] as { id?: string } | undefined)?.id ??
          null,
        auditedUserId:
          (auditResult.results?.[0] as
            | { target_user_id?: string }
            | undefined)?.target_user_id ?? null,
      };
    },

    async deleteSession(sessionId) {
      await env.SESSIONS.delete(`session:${sessionId}`);
    },
  };
}
