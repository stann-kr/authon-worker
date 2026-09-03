import type { D1Database } from "@cloudflare/workers-types";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  APPROVE_BROWSER_PASSWORD_RESET_SQL,
  APPROVE_SETUP_CODE_REQUEST_SQL,
  INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL,
  INVALIDATE_RESET_TOKENS_AFTER_AUDIT_SQL,
  MANAGEABLE_PASSWORD_RESET_TARGET_SQL,
  SET_USER_SETUP_CODE_FOR_REQUEST_SQL,
} from "./password-reset-lifecycle-sql.ts";
import type { PasswordResetAdminActor } from "./password-reset-admin-types.ts";
import { passwordResetRequests, users, venues } from "../db/schema.ts";
import { VENUE_MANAGED_ROLES } from "../users/policy.ts";

export interface PasswordResetAdminRequestRecord {
  id: string;
  venueId: string | null;
  userId: string;
  source: string;
  status: string;
  setupMethod: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordResetAdminRequestViewRecord {
  request: PasswordResetAdminRequestRecord;
  userName: string;
  userEmail: string;
  userRole: string;
  userAccountKind: string;
  venueName: string | null;
}

export interface PasswordResetAdminTarget {
  id: string;
  venueId: string | null;
  role: string;
  accountKind: string;
  active: boolean;
  deletedAt: string | null;
  passwordHash: string;
  sessionVersion: number | null;
}

export interface PasswordResetAdminVisibility {
  kind: "platform" | "venue";
  venueId: string | null;
  excludedActorId: string;
}

export interface PasswordResetAdminPersistence {
  listRequests(input: {
    visibility: PasswordResetAdminVisibility;
    nowIso: string;
  }): Promise<PasswordResetAdminRequestViewRecord[]>;
  countPendingRequests(input: {
    visibility: PasswordResetAdminVisibility;
    nowIso: string;
  }): Promise<number>;
  loadRequest(requestId: string): Promise<PasswordResetAdminRequestRecord | null>;
  loadTarget(userId: string): Promise<PasswordResetAdminTarget | null>;
  approveBrowserRequest(input: {
    actor: PasswordResetAdminActor;
    target: PasswordResetAdminTarget;
    requestId: string;
    expiresAt: string;
    nowIso: string;
    operationId: string;
    auditDetails: string;
  }): Promise<{ approvedUserId: string | null }>;
  approveSetupCodeRequest(input: {
    actor: PasswordResetAdminActor;
    target: PasswordResetAdminTarget;
    requestId: string;
    passwordHash: string;
    expiresAt: string;
    nowIso: string;
    operationId: string;
    auditDetails: string;
  }): Promise<{ updatedUserId: string | null; approvedUserId: string | null }>;
  createDirectSetupCodeReset(input: {
    actor: PasswordResetAdminActor;
    target: PasswordResetAdminTarget;
    manualRequestId: string;
    setupCodeHash: string;
    operationId: string;
    nowIso: string;
    expiresAt: string;
    auditDetails: string;
  }): Promise<{ updatedUserId: string | null; approvedUserId: string | null }>;
  rejectRequest(input: {
    actor: PasswordResetAdminActor;
    target: PasswordResetAdminTarget;
    requestId: string;
    nowIso: string;
    operationId: string;
  }): Promise<string | null>;
}

function visibilityWhere(visibility: PasswordResetAdminVisibility) {
  if (visibility.kind === "platform") {
    return visibility.venueId
      ? and(
          eq(passwordResetRequests.venueId, visibility.venueId),
          ne(users.id, visibility.excludedActorId),
        )
      : ne(users.id, visibility.excludedActorId);
  }
  return and(
    eq(passwordResetRequests.venueId, visibility.venueId!),
    ne(users.id, visibility.excludedActorId),
    inArray(users.role, VENUE_MANAGED_ROLES),
  );
}

function targetFields() {
  return {
    id: users.id,
    venueId: users.venueId,
    role: users.role,
    accountKind: users.accountKind,
    active: users.active,
    deletedAt: users.deletedAt,
    passwordHash: users.passwordHash,
    sessionVersion: users.sessionVersion,
  };
}

export function createPasswordResetAdminPersistence(
  database: D1Database,
): PasswordResetAdminPersistence {
  const db = drizzle(database);
  return {
    async listRequests({ visibility, nowIso }) {
      return db
        .select({
          request: passwordResetRequests,
          userName: users.name,
          userEmail: users.email,
          userRole: users.role,
          userAccountKind: users.accountKind,
          venueName: venues.name,
        })
        .from(passwordResetRequests)
        .innerJoin(users, eq(passwordResetRequests.userId, users.id))
        .leftJoin(venues, eq(passwordResetRequests.venueId, venues.id))
        .where(
          and(
            visibilityWhere(visibility),
            or(
              ne(passwordResetRequests.status, "pending"),
              isNull(passwordResetRequests.expiresAt),
              gt(passwordResetRequests.expiresAt, nowIso),
            ),
          ),
        )
        .orderBy(
          sql`CASE WHEN ${passwordResetRequests.status} = 'pending' THEN 0 ELSE 1 END`,
          desc(passwordResetRequests.createdAt),
        )
        .limit(100);
    },

    async countPendingRequests({ visibility, nowIso }) {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(passwordResetRequests)
        .innerJoin(users, eq(passwordResetRequests.userId, users.id))
        .where(
          and(
            visibilityWhere(visibility),
            eq(passwordResetRequests.status, "pending"),
            or(
              isNull(passwordResetRequests.expiresAt),
              gt(passwordResetRequests.expiresAt, nowIso),
            ),
          ),
        );
      return Number(result?.count ?? 0);
    },

    async loadRequest(requestId) {
      const [request] = await db
        .select()
        .from(passwordResetRequests)
        .where(eq(passwordResetRequests.id, requestId))
        .limit(1);
      return request ?? null;
    },

    async loadTarget(userId) {
      const [target] = await db
        .select(targetFields())
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return target ?? null;
    },

    async approveBrowserRequest(input) {
      const [requestResult] = await database.batch<{ user_id?: string }>([
        database.prepare(APPROVE_BROWSER_PASSWORD_RESET_SQL).bind(
          input.actor.id,
          input.nowIso,
          input.expiresAt,
          input.nowIso,
          input.requestId,
          input.target.id,
          input.nowIso,
          input.target.id,
          input.actor.id,
          input.actor.sessionVersion,
        ),
        database.prepare(INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL).bind(
          input.operationId,
          input.actor.id,
          input.auditDetails,
          input.nowIso,
          input.target.id,
        ),
      ]);
      return {
        approvedUserId:
          (requestResult.results?.[0] as { user_id?: string } | undefined)?.user_id ?? null,
      };
    },

    async approveSetupCodeRequest(input) {
      const [userResult, requestResult] = await database.batch<{
        id?: string;
        user_id?: string;
      }>([
        database.prepare(SET_USER_SETUP_CODE_FOR_REQUEST_SQL).bind(
          input.passwordHash,
          input.target.id,
          input.target.passwordHash,
          input.target.sessionVersion ?? 0,
          input.requestId,
          input.target.id,
          input.nowIso,
          input.target.id,
          input.actor.id,
          input.actor.sessionVersion,
        ),
        database.prepare(APPROVE_SETUP_CODE_REQUEST_SQL).bind(
          input.actor.id,
          input.nowIso,
          input.expiresAt,
          input.nowIso,
          input.requestId,
          input.target.id,
        ),
        database.prepare(INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL).bind(
          input.operationId,
          input.actor.id,
          input.auditDetails,
          input.nowIso,
          input.target.id,
        ),
        database.prepare(INVALIDATE_RESET_TOKENS_AFTER_AUDIT_SQL).bind(
          input.target.id,
          input.operationId,
        ),
      ]);
      return {
        updatedUserId:
          (userResult.results?.[0] as { id?: string } | undefined)?.id ?? null,
        approvedUserId:
          (requestResult.results?.[0] as { user_id?: string } | undefined)?.user_id ?? null,
      };
    },

    async createDirectSetupCodeReset(input) {
      const [userResult, , , requestResult] = await database.batch<{
        id?: string;
        user_id?: string;
      }>([
        database.prepare(
          `UPDATE users
           SET password_hash = ?,
               migration_status = 'pending_reset',
               password_set_at = NULL,
               session_version = session_version + 1
           WHERE id = ?
             AND password_hash = ?
             AND session_version = ?
             AND active = 1
             AND deleted_at IS NULL
             AND ${MANAGEABLE_PASSWORD_RESET_TARGET_SQL}
           RETURNING id`,
        ).bind(
          input.setupCodeHash,
          input.target.id,
          input.target.passwordHash,
          input.target.sessionVersion ?? 0,
          input.target.id,
          input.actor.id,
          input.actor.sessionVersion,
        ),
        database.prepare(
          `INSERT INTO user_audit_events (
             id, venue_id, actor_user_id, target_user_id, action, details, created_at
           )
           SELECT ?, venue_id, ?, id, 'password_reset_required', ?, ?
           FROM users
           WHERE id = ?
             AND changes() = 1`,
        ).bind(
          input.operationId,
          input.actor.id,
          input.auditDetails,
          input.nowIso,
          input.target.id,
        ),
        database.prepare(
          `UPDATE password_reset_requests
           SET status = 'cancelled',
               updated_at = ?
           WHERE user_id = ?
             AND status IN ('pending', 'approved')
             AND EXISTS (
               SELECT 1 FROM user_audit_events WHERE id = ?
             )`,
        ).bind(input.nowIso, input.target.id, input.operationId),
        database.prepare(
          `INSERT INTO password_reset_requests (
             id, venue_id, user_id, source, status, setup_method,
             decided_by_user_id, decided_at, expires_at, created_at, updated_at
           )
           SELECT ?, venue_id, id, 'admin', 'approved', 'setup_code', ?, ?, ?, ?, ?
           FROM users
           WHERE id = ?
             AND EXISTS (
               SELECT 1 FROM user_audit_events WHERE id = ?
             )
           RETURNING user_id`,
        ).bind(
          input.manualRequestId,
          input.actor.id,
          input.nowIso,
          input.expiresAt,
          input.nowIso,
          input.nowIso,
          input.target.id,
          input.operationId,
        ),
        database.prepare(
          `UPDATE password_reset_tokens
           SET used = 1
           WHERE user_id = ?
             AND EXISTS (
               SELECT 1 FROM user_audit_events WHERE id = ?
             )`,
        ).bind(input.target.id, input.operationId),
      ]);
      return {
        updatedUserId:
          (userResult.results?.[0] as { id?: string } | undefined)?.id ?? null,
        approvedUserId:
          (requestResult.results?.[0] as { user_id?: string } | undefined)?.user_id ?? null,
      };
    },

    async rejectRequest(input) {
      const [requestResult] = await database.batch<{ id?: string }>([
        database.prepare(
          `UPDATE password_reset_requests
           SET status = 'rejected',
               decided_by_user_id = ?,
               decided_at = ?,
               updated_at = ?
           WHERE id = ?
             AND user_id = ?
             AND status = 'pending'
             AND ${MANAGEABLE_PASSWORD_RESET_TARGET_SQL}
           RETURNING id`,
        ).bind(
          input.actor.id,
          input.nowIso,
          input.nowIso,
          input.requestId,
          input.target.id,
          input.target.id,
          input.actor.id,
          input.actor.sessionVersion,
        ),
        database.prepare(
          `INSERT INTO user_audit_events (
             id, venue_id, actor_user_id, target_user_id, action, details, created_at
           )
           SELECT ?, venue_id, ?, user_id, 'password_reset_request_rejected', ?, ?
           FROM password_reset_requests
           WHERE id = ?
             AND changes() = 1`,
        ).bind(
          input.operationId,
          input.actor.id,
          JSON.stringify({ requestId: input.requestId }),
          input.nowIso,
          input.requestId,
        ),
      ]);
      return (requestResult.results?.[0] as { id?: string } | undefined)?.id ?? null;
    },
  };
}
