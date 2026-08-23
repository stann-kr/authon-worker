import { parseStoredSession } from "./session-policy.ts";
import type { LogoutStoredSessionIdentity } from "./session-revocation.ts";

export const REVOKE_USER_SESSIONS_SQL = `
  UPDATE users
  SET session_version = session_version + 1
  WHERE id = ? AND session_version = ?
  RETURNING session_version AS sessionVersion
`;

export interface LogoutPersistence {
  readSession(sessionId: string): Promise<LogoutStoredSessionIdentity | null>;
  revokeUserSessions(
    userId: string,
    sessionVersion: number,
  ): Promise<{ sessionVersion: number } | null>;
  deleteSession(sessionId: string): Promise<void>;
}

export function createLogoutPersistence(
  env: Pick<CloudflareEnv, "DB" | "SESSIONS">,
): LogoutPersistence {
  return {
    async readSession(sessionId) {
      const sessionRaw = await env.SESSIONS.get(`session:${sessionId}`);
      return sessionRaw ? parseStoredSession(sessionRaw) : null;
    },

    async revokeUserSessions(userId, sessionVersion) {
      return env.DB.prepare(REVOKE_USER_SESSIONS_SQL)
        .bind(userId, sessionVersion)
        .first<{ sessionVersion: number }>();
    },

    async deleteSession(sessionId) {
      await env.SESSIONS.delete(`session:${sessionId}`);
    },
  };
}
