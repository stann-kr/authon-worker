"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  passwordResetRequests,
  users,
  venues,
} from "../db/schema";
import { hashPassword } from "../auth/password";
import { requireRole } from "../auth/server";
import { getDb } from "../db/client";
import {
  getAdminApprovedResetExpiry,
  getPasswordResetTargetError,
  isPasswordResetRequestSource,
  isPasswordResetRequestStatus,
  isPasswordResetSetupMethod,
  type PasswordResetSetupMethod,
} from "../auth/password-reset-request-policy";
import {
  type ApiResponse,
  type PasswordResetRequest,
  type PasswordResetRequestView,
} from "./types";
import { canManageTargetAccount, isRole } from "../users/policy";

type PasswordResetActionErrorCode =
  | "CANNOT_MANAGE_SELF"
  | "FORBIDDEN"
  | "INVALID_DECISION"
  | "INVALID_SETUP_METHOD"
  | "REQUEST_ALREADY_DECIDED"
  | "REQUEST_NOT_FOUND"
  | "USER_DELETED"
  | "USER_INACTIVE"
  | "USER_NOT_FOUND"
  | "UPDATE_FAILED";

class PasswordResetActionError extends Error {
  constructor(readonly code: PasswordResetActionErrorCode) {
    super(code);
  }
}

const targetFields = {
  id: users.id,
  venueId: users.venueId,
  role: users.role,
  active: users.active,
  deletedAt: users.deletedAt,
};

function toPasswordResetRequest(
  row: typeof passwordResetRequests.$inferSelect,
): PasswordResetRequest {
  if (
    !isPasswordResetRequestSource(row.source) ||
    !isPasswordResetRequestStatus(row.status) ||
    (row.setupMethod !== null && !isPasswordResetSetupMethod(row.setupMethod))
  ) {
    throw new PasswordResetActionError("UPDATE_FAILED");
  }

  return {
    ...row,
    source: row.source,
    status: row.status,
    setupMethod: row.setupMethod,
  };
}

function getActionError(
  error: unknown,
  fallback: PasswordResetActionErrorCode,
): string {
  return error instanceof PasswordResetActionError ? error.code : fallback;
}

function generateSetupCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const value = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `AUTH-${value.slice(0, 4)}-${value.slice(4)}`;
}

async function getManagedTarget(
  actor: Awaited<ReturnType<typeof requireRole>>,
  userId: string,
) {
  const db = getDb();
  const [row] = await db
    .select(targetFields)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new PasswordResetActionError("USER_NOT_FOUND");
  if (!isRole(row.role)) throw new PasswordResetActionError("FORBIDDEN");
  const target = { ...row, role: row.role };
  const targetError = getPasswordResetTargetError({
    isSelf: actor.id === target.id,
    isDeleted: Boolean(target.deletedAt),
    isManageable: canManageTargetAccount(actor, target),
    isActive: target.active,
  });
  if (targetError) throw new PasswordResetActionError(targetError);
  return target;
}

export async function fetchPasswordResetRequests(
  venueId?: string | null,
): Promise<ApiResponse<PasswordResetRequestView[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    let query = db
      .select({
        request: passwordResetRequests,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
        venueName: venues.name,
      })
      .from(passwordResetRequests)
      .innerJoin(users, eq(passwordResetRequests.userId, users.id))
      .leftJoin(venues, eq(passwordResetRequests.venueId, venues.id))
      .$dynamic();

    if (actor.role === "super_admin") {
      if (venueId) {
        query = query.where(eq(passwordResetRequests.venueId, venueId));
      }
    } else {
      if (!actor.venueId) throw new PasswordResetActionError("FORBIDDEN");
      query = query.where(eq(passwordResetRequests.venueId, actor.venueId));
    }

    const rows = await query
      .orderBy(
        sql`CASE WHEN ${passwordResetRequests.status} = 'pending' THEN 0 ELSE 1 END`,
        desc(passwordResetRequests.createdAt),
      )
      .limit(100);

    return {
      data: rows.map((row) => {
        if (!isRole(row.userRole)) {
          throw new PasswordResetActionError("UPDATE_FAILED");
        }
        return {
          ...toPasswordResetRequest(row.request),
          userName: row.userName,
          userEmail: row.userEmail,
          userRole: row.userRole,
          venueName: row.venueName,
        };
      }),
      error: null,
    };
  } catch (error: unknown) {
    console.error("Failed to load password reset requests:", error);
    return { data: null, error: getActionError(error, "UPDATE_FAILED") };
  }
}

export async function fetchPendingPasswordResetRequestCount(): Promise<
  ApiResponse<number>
> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const where = actor.role === "super_admin"
      ? eq(passwordResetRequests.status, "pending")
      : and(
          eq(passwordResetRequests.status, "pending"),
          eq(passwordResetRequests.venueId, actor.venueId ?? ""),
        );
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(passwordResetRequests)
      .where(where);
    return { data: Number(result?.count ?? 0), error: null };
  } catch (error: unknown) {
    console.error("Failed to load pending password reset request count:", error);
    return { data: null, error: getActionError(error, "UPDATE_FAILED") };
  }
}

export async function startManagedPasswordReset(params: {
  userId: string;
  setupMethod: PasswordResetSetupMethod;
  requestId?: string | null;
}): Promise<
  ApiResponse<{
    requestId: string;
    setupMethod: PasswordResetSetupMethod;
    setupCode: string | null;
    expiresAt: string | null;
  }>
> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    if (
      typeof params.userId !== "string" ||
      !params.userId.trim() ||
      (params.requestId !== undefined &&
        params.requestId !== null &&
        (typeof params.requestId !== "string" || !params.requestId.trim()))
    ) {
      throw new PasswordResetActionError("INVALID_DECISION");
    }
    if (!isPasswordResetSetupMethod(params.setupMethod)) {
      throw new PasswordResetActionError("INVALID_SETUP_METHOD");
    }
    const target = await getManagedTarget(actor, params.userId);
    const { env } = getCloudflareContext();
    const nowIso = new Date().toISOString();
    const requestId = params.requestId || crypto.randomUUID();
    const setupCode = params.setupMethod === "setup_code" ? generateSetupCode() : null;
    const temporarySecret = setupCode ?? crypto.randomUUID();
    const passwordHash = await hashPassword(temporarySecret);
    const expiresAt = params.setupMethod === "admin_approved"
      ? getAdminApprovedResetExpiry(Date.parse(nowIso))
      : null;
    const auditDetails = JSON.stringify({
      requestId,
      setupMethod: params.setupMethod,
      delivery:
        params.setupMethod === "setup_code"
          ? "manual_setup_code"
          : "admin_approved",
    });

    if (params.requestId) {
      const [request] = await getDb()
        .select({
          id: passwordResetRequests.id,
          userId: passwordResetRequests.userId,
          status: passwordResetRequests.status,
        })
        .from(passwordResetRequests)
        .where(eq(passwordResetRequests.id, params.requestId))
        .limit(1);
      if (!request || request.userId !== target.id) {
        throw new PasswordResetActionError("REQUEST_NOT_FOUND");
      }
      if (request.status !== "pending") {
        throw new PasswordResetActionError("REQUEST_ALREADY_DECIDED");
      }

      const [userResult, requestResult] = await env.DB.batch<{
        id?: string;
        user_id?: string;
      }>([
        env.DB.prepare(
          `UPDATE users
           SET password_hash = ?,
               migration_status = 'pending_reset',
               password_set_at = NULL,
               session_version = session_version + 1
           WHERE id = ?
             AND active = 1
             AND deleted_at IS NULL
             AND EXISTS (
               SELECT 1
               FROM password_reset_requests
               WHERE id = ?
                 AND user_id = ?
                 AND status = 'pending'
             )
           RETURNING id`,
        ).bind(passwordHash, target.id, requestId, target.id),
        env.DB.prepare(
          `UPDATE password_reset_requests
           SET status = 'approved',
               setup_method = ?,
               decided_by_user_id = ?,
               decided_at = ?,
               expires_at = ?,
               updated_at = ?
           WHERE id = ?
             AND user_id = ?
             AND status = 'pending'
             AND changes() = 1
           RETURNING user_id`,
        ).bind(
          params.setupMethod,
          actor.id,
          nowIso,
          expiresAt,
          nowIso,
          requestId,
          target.id,
        ),
        env.DB.prepare(
          `UPDATE password_reset_tokens
           SET used = 1
           WHERE user_id = ?
             AND EXISTS (
               SELECT 1 FROM password_reset_requests
               WHERE id = ?
                 AND status = 'approved'
                 AND decided_by_user_id = ?
                 AND decided_at = ?
             )`,
        ).bind(target.id, requestId, actor.id, nowIso),
        env.DB.prepare(
          `INSERT INTO user_audit_events (
             id, venue_id, actor_user_id, target_user_id, action, details, created_at
           )
           SELECT ?, venue_id, ?, id, 'password_reset_required', ?, ?
           FROM users
           WHERE id = ?
             AND EXISTS (
               SELECT 1 FROM password_reset_requests
               WHERE id = ?
                 AND status = 'approved'
                 AND decided_by_user_id = ?
                 AND decided_at = ?
             )`,
        ).bind(
          crypto.randomUUID(),
          actor.id,
          auditDetails,
          nowIso,
          target.id,
          requestId,
          actor.id,
          nowIso,
        ),
      ]);

      const updatedUserId = (userResult.results?.[0] as { id?: string } | undefined)?.id;
      const approvedUserId = (
        requestResult.results?.[0] as { user_id?: string } | undefined
      )?.user_id;
      if (!updatedUserId || approvedUserId !== updatedUserId) {
        throw new PasswordResetActionError("REQUEST_ALREADY_DECIDED");
      }
    } else {
      const [userResult, , requestResult] = await env.DB.batch<{
        id?: string;
        user_id?: string;
      }>([
        env.DB.prepare(
          `UPDATE users
           SET password_hash = ?,
               migration_status = 'pending_reset',
               password_set_at = NULL,
               session_version = session_version + 1
           WHERE id = ?
             AND active = 1
             AND deleted_at IS NULL
           RETURNING id`,
        ).bind(passwordHash, target.id),
        env.DB.prepare(
          `UPDATE password_reset_requests
           SET status = 'cancelled',
               updated_at = ?
           WHERE user_id = ?
             AND status IN ('pending', 'approved')`,
        ).bind(nowIso, target.id),
        env.DB.prepare(
          `INSERT INTO password_reset_requests (
             id, venue_id, user_id, source, status, setup_method,
             decided_by_user_id, decided_at, expires_at, created_at, updated_at
           )
           SELECT ?, venue_id, id, 'admin', 'approved', ?, ?, ?, ?, ?, ?
           FROM users
           WHERE id = ?
             AND active = 1
             AND deleted_at IS NULL
             AND password_hash = ?
           RETURNING user_id`,
        ).bind(
          requestId,
          params.setupMethod,
          actor.id,
          nowIso,
          expiresAt,
          nowIso,
          nowIso,
          target.id,
          passwordHash,
        ),
        env.DB.prepare(
          `UPDATE password_reset_tokens
           SET used = 1
           WHERE user_id = ?
             AND EXISTS (
               SELECT 1 FROM password_reset_requests
               WHERE id = ? AND status = 'approved'
             )`,
        ).bind(target.id, requestId),
        env.DB.prepare(
          `INSERT INTO user_audit_events (
             id, venue_id, actor_user_id, target_user_id, action, details, created_at
           )
           SELECT ?, venue_id, ?, id, 'password_reset_required', ?, ?
           FROM users
           WHERE id = ?
             AND EXISTS (
               SELECT 1 FROM password_reset_requests
               WHERE id = ? AND status = 'approved'
             )`,
        ).bind(
          crypto.randomUUID(),
          actor.id,
          auditDetails,
          nowIso,
          target.id,
          requestId,
        ),
      ]);

      const updatedUserId = (userResult.results?.[0] as { id?: string } | undefined)?.id;
      const approvedUserId = (
        requestResult.results?.[0] as { user_id?: string } | undefined
      )?.user_id;
      if (!updatedUserId || approvedUserId !== updatedUserId) {
        throw new PasswordResetActionError("UPDATE_FAILED");
      }
    }

    return {
      data: {
        requestId,
        setupMethod: params.setupMethod,
        setupCode,
        expiresAt,
      },
      error: null,
    };
  } catch (error: unknown) {
    console.error("Failed to start managed password reset:", error);
    return { data: null, error: getActionError(error, "UPDATE_FAILED") };
  }
}

export async function rejectPasswordResetRequest(
  requestId: string,
): Promise<ApiResponse<PasswordResetRequest>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    if (typeof requestId !== "string" || !requestId.trim()) {
      throw new PasswordResetActionError("INVALID_DECISION");
    }
    const db = getDb();
    const [request] = await db
      .select()
      .from(passwordResetRequests)
      .where(eq(passwordResetRequests.id, requestId))
      .limit(1);
    if (!request) throw new PasswordResetActionError("REQUEST_NOT_FOUND");
    await getManagedTarget(actor, request.userId);
    if (request.status !== "pending") {
      throw new PasswordResetActionError("REQUEST_ALREADY_DECIDED");
    }

    const { env } = getCloudflareContext();
    const nowIso = new Date().toISOString();
    const [requestResult] = await env.DB.batch<{ id?: string }>([
      env.DB.prepare(
        `UPDATE password_reset_requests
         SET status = 'rejected',
             decided_by_user_id = ?,
             decided_at = ?,
             updated_at = ?
         WHERE id = ?
           AND status = 'pending'
         RETURNING id`,
      ).bind(actor.id, nowIso, nowIso, requestId),
      env.DB.prepare(
        `INSERT INTO user_audit_events (
           id, venue_id, actor_user_id, target_user_id, action, details, created_at
         )
         SELECT ?, venue_id, ?, user_id, 'password_reset_request_rejected', ?, ?
         FROM password_reset_requests
         WHERE id = ?
           AND status = 'rejected'
           AND decided_by_user_id = ?
           AND decided_at = ?
           AND changes() = 1`,
      ).bind(
        crypto.randomUUID(),
        actor.id,
        JSON.stringify({ requestId }),
        nowIso,
        requestId,
        actor.id,
        nowIso,
      ),
    ]);
    const rejectedRequestId = (
      requestResult.results?.[0] as { id?: string } | undefined
    )?.id;
    if (rejectedRequestId !== requestId) {
      throw new PasswordResetActionError("REQUEST_ALREADY_DECIDED");
    }

    const [updated] = await db
      .select()
      .from(passwordResetRequests)
      .where(eq(passwordResetRequests.id, requestId))
      .limit(1);
    if (!updated) throw new PasswordResetActionError("UPDATE_FAILED");

    return { data: toPasswordResetRequest(updated), error: null };
  } catch (error: unknown) {
    console.error("Failed to reject password reset request:", error);
    return { data: null, error: getActionError(error, "UPDATE_FAILED") };
  }
}
