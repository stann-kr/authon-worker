import {
  COMPLETE_TOKEN_RESET_REQUESTS_SQL,
  CONSUME_EXACT_RESET_TOKEN_SQL,
  INSERT_TOKEN_RESET_AUDIT_SQL,
  INVALIDATE_ALL_USER_RESET_TOKENS_SQL,
  SELECT_VALID_RESET_TOKEN_CANDIDATE_SQL,
  UPDATE_PASSWORD_WITH_VALID_TOKEN_SQL,
} from "./credential-lifecycle-sql";

export interface ResetTokenCandidate {
  userId: string;
  migrationStatus: string;
  passwordSetAt: string | null;
}

export interface TokenPasswordResetCommitResult {
  updatedUserId: string | null;
  consumedUserId: string | null;
  auditedUserId: string | null;
}

export interface PasswordResetTokenPersistence {
  loadCandidate(input: {
    tokenHash: string;
    nowIso: string;
    expectedVenueId: string | null;
  }): Promise<ResetTokenCandidate | null>;
  commit(input: {
    tokenHash: string;
    passwordHash: string;
    expectedVenueId: string | null;
    nowIso: string;
    auditEventId: string;
    auditAction: "password_setup_completed" | "password_reset_completed";
    auditMethod: "invitation_link" | "password_reset_link";
  }): Promise<TokenPasswordResetCommitResult>;
}

export function createPasswordResetTokenPersistence(
  database: CloudflareEnv["DB"],
): PasswordResetTokenPersistence {
  return {
    async loadCandidate({ tokenHash, nowIso, expectedVenueId }) {
      const row = await database
        .prepare(SELECT_VALID_RESET_TOKEN_CANDIDATE_SQL)
        .bind(tokenHash, nowIso, expectedVenueId, expectedVenueId)
        .first<{
          user_id: string;
          migration_status: string;
          password_set_at: string | null;
        }>();
      return row?.user_id
        ? {
            userId: row.user_id,
            migrationStatus: row.migration_status,
            passwordSetAt: row.password_set_at,
          }
        : null;
    },

    async commit(input) {
      // Exact token consumption wins. Its changes() reaches the adjacent audit,
      // and later mutations are gated by that audit's unique ID.
      const [passwordResult, tokenResult, auditResult] = await database.batch<{
        id?: string;
        user_id?: string;
        target_user_id?: string;
      }>([
        database.prepare(UPDATE_PASSWORD_WITH_VALID_TOKEN_SQL).bind(
          input.passwordHash,
          input.nowIso,
          input.tokenHash,
          input.nowIso,
          input.expectedVenueId,
          input.expectedVenueId,
        ),
        database
          .prepare(CONSUME_EXACT_RESET_TOKEN_SQL)
          .bind(input.tokenHash, input.nowIso),
        database.prepare(INSERT_TOKEN_RESET_AUDIT_SQL).bind(
          input.auditEventId,
          input.auditAction,
          JSON.stringify({ method: input.auditMethod }),
          input.nowIso,
          input.tokenHash,
        ),
        database
          .prepare(INVALIDATE_ALL_USER_RESET_TOKENS_SQL)
          .bind(input.auditEventId),
        database.prepare(COMPLETE_TOKEN_RESET_REQUESTS_SQL).bind(
          input.nowIso,
          input.nowIso,
          input.auditEventId,
        ),
      ]);

      return {
        updatedUserId:
          (passwordResult.results?.[0] as { id?: string } | undefined)?.id ??
          null,
        consumedUserId:
          (tokenResult.results?.[0] as { user_id?: string } | undefined)
            ?.user_id ?? null,
        auditedUserId:
          (auditResult.results?.[0] as
            | { target_user_id?: string }
            | undefined)?.target_user_id ?? null,
      };
    },
  };
}
