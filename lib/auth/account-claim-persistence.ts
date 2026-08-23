import type { D1Database } from "@cloudflare/workers-types";

import {
  CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL,
  COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL,
  INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL,
  INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL,
  UPDATE_USER_WITH_APPROVED_RESET_SQL,
} from "./password-reset-lifecycle-sql.ts";

export interface AccountClaimCandidate {
  id: string;
  venue_id: string | null;
  password_hash: string;
  session_version: number;
  migration_status: string;
  password_set_at: string | null;
  request_id: string | null;
  setup_method: "setup_code" | "admin_approved" | null;
  has_setup_code_history: number;
}

export interface AccountClaimPersistence {
  findBrowserReceiptCandidate(input: {
    requestId: string;
    nowIso: string;
    expectedVenueId: string | null;
  }): Promise<AccountClaimCandidate | null>;
  findSetupCodeCandidate(input: {
    email: string;
    nowIso: string;
    expectedVenueId: string | null;
  }): Promise<AccountClaimCandidate | null>;
  consumeClaim(input: {
    candidate: AccountClaimCandidate;
    expectedVenueId: string | null;
    passwordHash: string;
    credentialChangedAt: string;
    operationId: string;
    claimMethod: "browser_receipt" | "legacy_setup_code" | "manual_setup_code";
    exactRequestId: string;
  }): Promise<string | null>;
}

const SELECT_BROWSER_RECEIPT_CANDIDATE_SQL = `
  SELECT u.id,
         u.venue_id,
         u.password_hash,
         u.session_version,
         u.migration_status,
         u.password_set_at,
         pr.id AS request_id,
         pr.setup_method,
         1 AS has_setup_code_history
  FROM password_reset_requests pr
  JOIN users u ON u.id = pr.user_id
  WHERE pr.id = ?
    AND pr.source = 'self_service'
    AND pr.status = 'approved'
    AND pr.setup_method = 'admin_approved'
    AND pr.expires_at > ?
    AND pr.venue_id IS u.venue_id
    AND u.active = 1
    AND u.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM venues candidate_venue
      WHERE candidate_venue.id = u.venue_id
        AND candidate_venue.active = 1
    )
    AND u.account_kind = 'personal'
    AND u.role IN ('door_staff', 'staff', 'dj')
    AND (? IS NULL OR u.venue_id = ? OR u.role = 'super_admin')
    AND EXISTS (
      SELECT 1
      FROM users reset_actor
      WHERE reset_actor.id = pr.decided_by_user_id
        AND reset_actor.active = 1
        AND reset_actor.deleted_at IS NULL
        AND reset_actor.id <> u.id
        AND (
          reset_actor.role = 'super_admin'
          OR (
            reset_actor.role = 'venue_admin'
            AND reset_actor.venue_id IS NOT NULL
            AND reset_actor.venue_id = u.venue_id
            AND u.role IN ('door_staff', 'staff', 'dj')
          )
        )
    )
  LIMIT 1
`;

const SELECT_SETUP_CODE_CANDIDATE_SQL = `
  SELECT u.id,
         u.venue_id,
         u.password_hash,
         u.session_version,
         u.migration_status,
         u.password_set_at,
         (
           SELECT pr.id
           FROM password_reset_requests pr
           WHERE pr.user_id = u.id
             AND pr.status = 'approved'
             AND pr.setup_method = 'setup_code'
             AND pr.expires_at > ?
             AND pr.venue_id IS u.venue_id
             AND EXISTS (
               SELECT 1
               FROM users reset_actor
               WHERE reset_actor.id = pr.decided_by_user_id
                 AND reset_actor.active = 1
                 AND reset_actor.deleted_at IS NULL
                 AND reset_actor.id <> u.id
                 AND (
                   reset_actor.role = 'super_admin'
                   OR (
                     reset_actor.role = 'venue_admin'
                     AND reset_actor.venue_id IS NOT NULL
                     AND reset_actor.venue_id = u.venue_id
                     AND u.role IN ('door_staff', 'staff', 'dj')
                   )
                 )
             )
           ORDER BY pr.decided_at DESC, pr.id DESC
           LIMIT 1
         ) AS request_id,
         'setup_code' AS setup_method,
         EXISTS (
           SELECT 1 FROM password_reset_requests history
           WHERE history.user_id = u.id
             AND history.setup_method = 'setup_code'
         ) AS has_setup_code_history
  FROM users u
  WHERE u.email = ?
    AND u.active = 1
    AND u.deleted_at IS NULL
    AND (
      u.role = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM venues candidate_venue
        WHERE candidate_venue.id = u.venue_id
          AND candidate_venue.active = 1
      )
    )
    AND u.migration_status = 'pending_reset'
    AND u.password_set_at IS NULL
    AND (? IS NULL OR u.venue_id = ? OR u.role = 'super_admin')
  LIMIT 1
`;

export function createAccountClaimPersistence(
  database: D1Database,
): AccountClaimPersistence {
  return {
    async findBrowserReceiptCandidate(input) {
      return database
        .prepare(SELECT_BROWSER_RECEIPT_CANDIDATE_SQL)
        .bind(
          input.requestId,
          input.nowIso,
          input.expectedVenueId,
          input.expectedVenueId,
        )
        .first<AccountClaimCandidate>();
    },

    async findSetupCodeCandidate(input) {
      return database
        .prepare(SELECT_SETUP_CODE_CANDIDATE_SQL)
        .bind(
          input.nowIso,
          input.email,
          input.expectedVenueId,
          input.expectedVenueId,
        )
        .first<AccountClaimCandidate>();
    },

    async consumeClaim(input) {
      const [userResult] = await database.batch<{ id?: string }>([
        database.prepare(UPDATE_USER_WITH_APPROVED_RESET_SQL).bind(
          input.passwordHash,
          input.credentialChangedAt,
          input.candidate.id,
          input.candidate.password_hash,
          input.candidate.session_version,
          input.expectedVenueId,
          input.expectedVenueId,
          input.claimMethod,
          input.claimMethod,
          input.exactRequestId,
          input.candidate.setup_method ?? "setup_code",
          input.credentialChangedAt,
        ),
        database.prepare(INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL).bind(
          input.operationId,
          JSON.stringify({
            method: input.claimMethod,
            requestId: input.candidate.request_id,
          }),
          input.credentialChangedAt,
          input.candidate.id,
        ),
        database.prepare(COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL).bind(
          input.credentialChangedAt,
          input.credentialChangedAt,
          input.exactRequestId,
          input.operationId,
        ),
        database.prepare(INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL).bind(
          input.candidate.id,
          input.operationId,
        ),
        database.prepare(CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL).bind(
          input.credentialChangedAt,
          input.candidate.id,
          input.exactRequestId,
          input.operationId,
        ),
      ]);

      return (userResult.results?.[0] as { id?: string } | undefined)?.id ?? null;
    },
  };
}
