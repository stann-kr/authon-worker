import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { users, venues } from "../db/schema.ts";
import {
  CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL,
  SELECT_LATEST_SETUP_CODE_REQUEST_SQL,
  UPDATE_USER_FOR_LOGIN_SQL,
} from "./credential-lifecycle-sql.ts";

export interface LoginCandidate {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  accountKind: string;
  doorAccessEnabled: boolean;
  venueId: string | null;
  venueActive: boolean | null;
  guestLimit: number | null;
  preferredLocale: string | null;
  active: boolean;
  deletedAt: string | null;
  sessionVersion: number;
  migrationStatus: string;
  passwordSetAt: string | null;
}

export interface LatestSetupCodeRequest {
  status: string;
  setupMethod: string | null;
  expiresAt: string | null;
}

export interface LoginPersistence {
  findCandidate(email: string): Promise<LoginCandidate | null>;
  findLatestSetupCodeRequest(userId: string): Promise<LatestSetupCodeRequest | null>;
  commitLogin(input: {
    user: LoginCandidate;
    passwordHash: string;
    nowIso: string;
  }): Promise<number | null>;
}

export function createLoginPersistence(
  env: Pick<CloudflareEnv, "DB">,
): LoginPersistence {
  const db = drizzle(env.DB);
  return {
    async findCandidate(email) {
      const [result] = await db
        .select({ user: users, venueActive: venues.active })
        .from(users)
        .leftJoin(venues, eq(users.venueId, venues.id))
        .where(eq(users.email, email))
        .limit(1);
      return result
        ? { ...result.user, venueActive: result.venueActive }
        : null;
    },

    async findLatestSetupCodeRequest(userId) {
      const result = await env.DB.prepare(SELECT_LATEST_SETUP_CODE_REQUEST_SQL)
        .bind(userId)
        .first<{
          status: string;
          setup_method: string | null;
          expires_at: string | null;
        }>();
      return result
        ? {
            status: result.status,
            setupMethod: result.setup_method,
            expiresAt: result.expires_at,
          }
        : null;
    },

    async commitLogin(input) {
      const [loginResult] = await env.DB.batch<{ session_version?: number }>([
        env.DB.prepare(UPDATE_USER_FOR_LOGIN_SQL).bind(
          input.nowIso,
          input.passwordHash,
          input.user.id,
          input.user.passwordHash,
          input.user.sessionVersion,
        ),
        env.DB.prepare(CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL).bind(
          input.nowIso,
          input.user.id,
        ),
      ]);
      return (
        (loginResult.results?.[0] as { session_version?: number } | undefined)
          ?.session_version ?? null
      );
    },
  };
}
