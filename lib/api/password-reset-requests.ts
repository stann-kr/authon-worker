"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  passwordResetRequests,
  users,
  venues,
} from "../db/schema";
import { hashPassword } from "../auth/password";
import { requireRole } from "../auth/server";
import { getDb } from "../db/client";
import {
  getAdminApprovedResetPolicyError,
  getPasswordResetApprovalExpiry,
  getPasswordResetTargetError,
  isPasswordResetRequestSource,
  isPasswordResetRequestStatus,
  isPasswordResetSetupMethod,
  isPasswordResetVerificationMethod,
  type PasswordResetSetupMethod,
  type PasswordResetVerificationMethod,
} from "../auth/password-reset-request-policy";
import { verifyPasswordResetChallenge } from "../auth/password-reset-receipt";
import {
  APPROVE_SETUP_CODE_REQUEST_SQL,
  APPROVE_BROWSER_PASSWORD_RESET_SQL,
  INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL,
  INVALIDATE_RESET_TOKENS_AFTER_AUDIT_SQL,
  MANAGEABLE_PASSWORD_RESET_TARGET_SQL,
  SET_USER_SETUP_CODE_FOR_REQUEST_SQL,
} from "../auth/password-reset-lifecycle-sql";
import {
  type ApiResponse,
  type PasswordResetRequest,
  type PasswordResetRequestView,
} from "./types";
import {
  canManageTargetAccount,
  isAccountKind,
  isRole,
  VENUE_MANAGED_ROLES,
} from "../users/policy";

type PasswordResetActionErrorCode =
  | "CANNOT_MANAGE_SELF"
  | "DIRECT_RESET_NOT_ALLOWED"
  | "EXACT_SELF_SERVICE_REQUEST_REQUIRED"
  | "FORBIDDEN"
  | "INVALID_DECISION"
  | "INVALID_SETUP_METHOD"
  | "REQUEST_ALREADY_DECIDED"
  | "REQUEST_EXPIRED"
  | "REQUEST_NOT_FOUND"
  | "SIGNED_RECEIPT_REQUIRED"
  | "USER_DELETED"
  | "USER_INACTIVE"
  | "USER_NOT_FOUND"
  | "VERIFICATION_FAILED"
  | "VERIFICATION_REQUIRED"
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
  accountKind: users.accountKind,
  active: users.active,
  deletedAt: users.deletedAt,
  passwordHash: users.passwordHash,
  sessionVersion: users.sessionVersion,
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
  if (!isRole(row.role) || !isAccountKind(row.accountKind)) {
    throw new PasswordResetActionError("FORBIDDEN");
  }
  const target = {
    ...row,
    role: row.role,
    accountKind: row.accountKind,
  };
  const targetError = getPasswordResetTargetError({
    isSelf: actor.id === target.id,
    isDeleted: Boolean(target.deletedAt),
    isManageable: canManageTargetAccount(actor, target),
    isActive: target.active,
  });
  if (targetError) throw new PasswordResetActionError(targetError);
  return target;
}

function getRequestVisibilityWhere(
  actor: Awaited<ReturnType<typeof requireRole>>,
  venueId?: string | null,
) {
  if (actor.role === "super_admin") {
    return venueId
      ? and(
          eq(passwordResetRequests.venueId, venueId),
          ne(users.id, actor.id),
        )
      : ne(users.id, actor.id);
  }

  if (!actor.venueId) throw new PasswordResetActionError("FORBIDDEN");
  return and(
    eq(passwordResetRequests.venueId, actor.venueId),
    ne(users.id, actor.id),
    inArray(users.role, VENUE_MANAGED_ROLES),
  );
}

export async function fetchPasswordResetRequests(
  venueId?: string | null,
): Promise<ApiResponse<PasswordResetRequestView[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const nowIso = new Date().toISOString();
    const db = getDb();
    const rows = await db
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
          getRequestVisibilityWhere(actor, venueId),
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

    return {
      data: rows.map((row) => {
        if (!isRole(row.userRole) || !isAccountKind(row.userAccountKind)) {
          throw new PasswordResetActionError("UPDATE_FAILED");
        }
        const request = toPasswordResetRequest(row.request);
        return {
          ...request,
          userName: row.userName,
          userEmail: row.userEmail,
          userRole: row.userRole,
          userAccountKind: row.userAccountKind,
          venueName: row.venueName,
          codeFreeEligible:
            request.source === "self_service" &&
            Boolean(request.expiresAt) &&
            row.userAccountKind === "personal" &&
            VENUE_MANAGED_ROLES.some((role) => role === row.userRole),
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
    const nowIso = new Date().toISOString();
    const db = getDb();
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(passwordResetRequests)
      .innerJoin(users, eq(passwordResetRequests.userId, users.id))
      .where(
        and(
          getRequestVisibilityWhere(actor),
          eq(passwordResetRequests.status, "pending"),
          or(
            isNull(passwordResetRequests.expiresAt),
            gt(passwordResetRequests.expiresAt, nowIso),
          ),
        ),
      );
    return { data: Number(result?.count ?? 0), error: null };
  } catch (error: unknown) {
    console.error("Failed to load pending password reset request count:", error);
    return { data: null, error: getActionError(error, "UPDATE_FAILED") };
  }
}

export async function startManagedPasswordReset(params: {
  userId?: string | null;
  setupMethod: PasswordResetSetupMethod;
  requestId?: string | null;
  verificationMethod?: PasswordResetVerificationMethod | null;
  verificationChallenge?: string | null;
  verificationAttested?: boolean;
}): Promise<
  ApiResponse<{
    requestId: string;
    setupMethod: PasswordResetSetupMethod;
    setupCode: string | null;
    expiresAt: string;
  }>
> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    if (!isPasswordResetSetupMethod(params.setupMethod)) {
      throw new PasswordResetActionError("INVALID_SETUP_METHOD");
    }

    const requestId = typeof params.requestId === "string"
      ? params.requestId.trim()
      : "";
    const requestedUserId = typeof params.userId === "string"
      ? params.userId.trim()
      : "";
    if (!requestId && !requestedUserId) {
      throw new PasswordResetActionError("INVALID_DECISION");
    }

    const { env } = getCloudflareContext();
    const nowIso = new Date().toISOString();
    const expiresAt = getPasswordResetApprovalExpiry(
      params.setupMethod,
      Date.parse(nowIso),
    );

    if (requestId) {
      const [request] = await getDb()
        .select({
          id: passwordResetRequests.id,
          userId: passwordResetRequests.userId,
          source: passwordResetRequests.source,
          status: passwordResetRequests.status,
          expiresAt: passwordResetRequests.expiresAt,
        })
        .from(passwordResetRequests)
        .where(eq(passwordResetRequests.id, requestId))
        .limit(1);
      if (!request) throw new PasswordResetActionError("REQUEST_NOT_FOUND");
      if (requestedUserId && requestedUserId !== request.userId) {
        throw new PasswordResetActionError("REQUEST_NOT_FOUND");
      }
      if (request.status !== "pending") {
        throw new PasswordResetActionError("REQUEST_ALREADY_DECIDED");
      }
      if (request.expiresAt && request.expiresAt <= nowIso) {
        throw new PasswordResetActionError("REQUEST_EXPIRED");
      }

      const target = await getManagedTarget(actor, request.userId);
      let verificationMethod: PasswordResetVerificationMethod | null = null;
      if (params.setupMethod === "admin_approved") {
        if (params.verificationAttested !== true) {
          throw new PasswordResetActionError("VERIFICATION_REQUIRED");
        }
        if (!env.JWT_SECRET) {
          console.error("JWT_SECRET is not configured");
          throw new PasswordResetActionError("UPDATE_FAILED");
        }
        const challengeMatches = await verifyPasswordResetChallenge(
          request.id,
          params.verificationChallenge,
          env.JWT_SECRET,
        );
        if (!challengeMatches) {
          throw new PasswordResetActionError("VERIFICATION_FAILED");
        }
        const policyError = getAdminApprovedResetPolicyError({
          isSelf: actor.id === target.id,
          isManageable: canManageTargetAccount(actor, target),
          isExactRequest: true,
          hasSignedReceipt: true,
          requestSource: request.source,
          targetRole: target.role,
          targetAccountKind: target.accountKind,
          verificationMethod: params.verificationMethod,
        });
        if (policyError) throw new PasswordResetActionError(policyError);
        if (!isPasswordResetVerificationMethod(params.verificationMethod)) {
          throw new PasswordResetActionError("VERIFICATION_REQUIRED");
        }
        verificationMethod = params.verificationMethod;
      }

      const setupCode = params.setupMethod === "setup_code"
        ? generateSetupCode()
        : null;
      const operationId = crypto.randomUUID();
      const auditDetails = JSON.stringify({
        requestId,
        setupMethod: params.setupMethod,
        delivery:
          params.setupMethod === "setup_code"
            ? "manual_setup_code"
            : "browser_receipt",
        verificationMethod,
        verificationAttested: params.setupMethod === "admin_approved",
      });

      if (params.setupMethod === "admin_approved") {
        const [requestResult] = await env.DB.batch<{ user_id?: string }>([
          env.DB.prepare(
            APPROVE_BROWSER_PASSWORD_RESET_SQL,
          ).bind(
            actor.id,
            nowIso,
            expiresAt,
            nowIso,
            requestId,
            target.id,
            nowIso,
            target.id,
            actor.id,
            actor.sessionVersion,
          ),
          env.DB.prepare(
            INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL,
          ).bind(
            operationId,
            actor.id,
            auditDetails,
            nowIso,
            target.id,
          ),
        ]);
        const approvedUserId = (
          requestResult.results?.[0] as { user_id?: string } | undefined
        )?.user_id;
        if (approvedUserId !== target.id) {
          throw new PasswordResetActionError("REQUEST_ALREADY_DECIDED");
        }
      } else {
        const passwordHash = await hashPassword(setupCode!);
        const [userResult, requestResult] = await env.DB.batch<{
          id?: string;
          user_id?: string;
        }>([
          env.DB.prepare(
            SET_USER_SETUP_CODE_FOR_REQUEST_SQL,
          ).bind(
            passwordHash,
            target.id,
            target.passwordHash,
            target.sessionVersion ?? 0,
            requestId,
            target.id,
            nowIso,
            target.id,
            actor.id,
            actor.sessionVersion,
          ),
          env.DB.prepare(
            APPROVE_SETUP_CODE_REQUEST_SQL,
          ).bind(
            actor.id,
            nowIso,
            expiresAt,
            nowIso,
            requestId,
            target.id,
          ),
          env.DB.prepare(
            INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL,
          ).bind(
            operationId,
            actor.id,
            auditDetails,
            nowIso,
            target.id,
          ),
          env.DB.prepare(
            INVALIDATE_RESET_TOKENS_AFTER_AUDIT_SQL,
          ).bind(target.id, operationId),
        ]);

        const updatedUserId = (
          userResult.results?.[0] as { id?: string } | undefined
        )?.id;
        const approvedUserId = (
          requestResult.results?.[0] as { user_id?: string } | undefined
        )?.user_id;
        if (!updatedUserId || approvedUserId !== updatedUserId) {
          throw new PasswordResetActionError("REQUEST_ALREADY_DECIDED");
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
    }

    if (!requestedUserId || params.setupMethod !== "setup_code") {
      throw new PasswordResetActionError("DIRECT_RESET_NOT_ALLOWED");
    }

    const target = await getManagedTarget(actor, requestedUserId);
    const manualRequestId = crypto.randomUUID();
    const setupCode = generateSetupCode();
    const passwordHash = await hashPassword(setupCode);
    const operationId = crypto.randomUUID();
    const auditDetails = JSON.stringify({
      requestId: manualRequestId,
      setupMethod: "setup_code",
      delivery: "manual_setup_code",
    });

    const [userResult, , , requestResult] = await env.DB.batch<{
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
           AND password_hash = ?
           AND session_version = ?
           AND active = 1
           AND deleted_at IS NULL
           AND ${MANAGEABLE_PASSWORD_RESET_TARGET_SQL}
         RETURNING id`,
      ).bind(
        passwordHash,
        target.id,
        target.passwordHash,
        target.sessionVersion ?? 0,
        target.id,
        actor.id,
        actor.sessionVersion,
      ),
      env.DB.prepare(
        `INSERT INTO user_audit_events (
           id, venue_id, actor_user_id, target_user_id, action, details, created_at
         )
         SELECT ?, venue_id, ?, id, 'password_reset_required', ?, ?
         FROM users
         WHERE id = ?
           AND changes() = 1`,
      ).bind(operationId, actor.id, auditDetails, nowIso, target.id),
      env.DB.prepare(
        `UPDATE password_reset_requests
         SET status = 'cancelled',
             updated_at = ?
         WHERE user_id = ?
           AND status IN ('pending', 'approved')
           AND EXISTS (
             SELECT 1 FROM user_audit_events WHERE id = ?
           )`,
      ).bind(nowIso, target.id, operationId),
      env.DB.prepare(
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
        manualRequestId,
        actor.id,
        nowIso,
        expiresAt,
        nowIso,
        nowIso,
        target.id,
        operationId,
      ),
      env.DB.prepare(
        `UPDATE password_reset_tokens
         SET used = 1
         WHERE user_id = ?
           AND EXISTS (
             SELECT 1 FROM user_audit_events WHERE id = ?
           )`,
      ).bind(target.id, operationId),
    ]);

    const updatedUserId = (
      userResult.results?.[0] as { id?: string } | undefined
    )?.id;
    const approvedUserId = (
      requestResult.results?.[0] as { user_id?: string } | undefined
    )?.user_id;
    if (!updatedUserId || approvedUserId !== updatedUserId) {
      throw new PasswordResetActionError("UPDATE_FAILED");
    }

    return {
      data: {
        requestId: manualRequestId,
        setupMethod: "setup_code",
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
    const target = await getManagedTarget(actor, request.userId);
    if (request.status !== "pending") {
      throw new PasswordResetActionError("REQUEST_ALREADY_DECIDED");
    }

    const { env } = getCloudflareContext();
    const nowIso = new Date().toISOString();
    const operationId = crypto.randomUUID();
    const [requestResult] = await env.DB.batch<{ id?: string }>([
      env.DB.prepare(
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
        actor.id,
        nowIso,
        nowIso,
        requestId,
        target.id,
        target.id,
        actor.id,
        actor.sessionVersion,
      ),
      env.DB.prepare(
        `INSERT INTO user_audit_events (
           id, venue_id, actor_user_id, target_user_id, action, details, created_at
         )
         SELECT ?, venue_id, ?, user_id, 'password_reset_request_rejected', ?, ?
         FROM password_reset_requests
         WHERE id = ?
           AND changes() = 1`,
      ).bind(
        operationId,
        actor.id,
        JSON.stringify({ requestId }),
        nowIso,
        requestId,
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
