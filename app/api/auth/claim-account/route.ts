import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getPasswordPolicyErrorCode } from "@/lib/auth/password-policy";
import {
  clearRateLimit,
  consumeRateLimit,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import {
  canStartFirstLoginSetup,
  getFirstLoginSetupMethod,
} from "@/lib/auth/first-login-policy";
import { COMPLETE_OPEN_PASSWORD_RESET_REQUEST_AFTER_USER_UPDATE_SQL } from "@/lib/auth/password-reset-request-sql";

/**
 * 관리자 발급 설정 코드 또는 유효한 관리자 승인 기반 비밀번호 설정.
 * pending_reset 상태와 현재 credential/grant를 조건부 소비해 재사용을 막는다.
 */
export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const {
      email,
      setupCode: rawSetupCode,
      newPassword,
    } = await request.json();
    const setupCode = typeof rawSetupCode === "string" ? rawSetupCode : "";

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof newPassword !== "string"
    ) {
      return NextResponse.json(
        { code: "MISSING_SETUP_FIELDS", error: "Email and a new password are required." },
        { status: 400 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordPolicyErrorCode = getPasswordPolicyErrorCode(newPassword);
    if (passwordPolicyErrorCode) {
      return NextResponse.json(
        {
          code: passwordPolicyErrorCode,
          error:
            passwordPolicyErrorCode === "PASSWORD_TOO_SHORT"
              ? "Password must be at least 8 characters."
              : "Password must include both letters and numbers.",
        },
        { status: 400 },
      );
    }

    const ip = getRequestIp(request);
    const identifier = `${ip}:${normalizedEmail}`;
    const rateLimit = await consumeRateLimit({
      namespace: "claim-account",
      identifier,
      limit: 5,
      windowSeconds: 60 * 15,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { code: "RATE_LIMITED", error: "Too many setup attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const passwordHash = await hashPassword(newPassword);
    const nowIso = new Date().toISOString();
    const tenant = await getTenantContextForRequest(request);
    const expectedVenueId = tenant.scope === "venue" ? tenant.venueId : null;

    if (!tenant.resolved) {
      return NextResponse.json({ code: "UNKNOWN_VENUE", error: "Unknown venue." }, { status: 404 });
    }

    const candidate = await env.DB.prepare(
      `SELECT id,
              venue_id,
              password_hash,
              migration_status,
              password_set_at,
              (
                SELECT id
                FROM password_reset_requests
                WHERE user_id = users.id
                  AND status = 'approved'
                  AND setup_method = 'admin_approved'
                  AND expires_at > ?
                ORDER BY decided_at DESC, id DESC
                LIMIT 1
              ) AS admin_approved_request_id
       FROM users
       WHERE email = ?
         AND active = 1
         AND deleted_at IS NULL
         AND migration_status = 'pending_reset'
         AND password_set_at IS NULL
         AND (? IS NULL OR venue_id = ?)
       LIMIT 1`,
    )
      .bind(nowIso, normalizedEmail, expectedVenueId, expectedVenueId)
      .first<{
        id: string;
        venue_id: string | null;
        password_hash: string;
        migration_status: string;
        password_set_at: string | null;
        admin_approved_request_id: string | null;
      }>();

    const firstLoginSetupMethod = candidate
      ? getFirstLoginSetupMethod({
          migrationStatus: candidate.migration_status,
          passwordSetAt: candidate.password_set_at,
          adminApprovedReset: Boolean(candidate.admin_approved_request_id),
        })
      : null;
    const setupCodeMatches = candidate && firstLoginSetupMethod === "setup_code"
      ? await verifyPassword(setupCode, candidate.password_hash)
      : false;

    if (
      !candidate ||
      !firstLoginSetupMethod ||
      !canStartFirstLoginSetup(firstLoginSetupMethod, setupCodeMatches)
    ) {
      return NextResponse.json(
        {
          code: "ACCOUNT_NOT_ELIGIBLE",
          error: "The administrator approval or setup code is invalid, expired, or already used.",
        },
        { status: 400 },
      );
    }

    const [userResult] = await env.DB.batch<{ id: string } | { user_id: string }>([
      env.DB.prepare(
        `UPDATE users
         SET password_hash = ?,
             migration_status = 'active',
             password_set_at = ?,
             session_version = session_version + 1
         WHERE id = ?
           AND password_hash = ?
           AND active = 1
           AND deleted_at IS NULL
           AND migration_status = 'pending_reset'
           AND password_set_at IS NULL
           AND (? IS NULL OR venue_id = ?)
           AND (
             ? = 'setup_code'
             OR EXISTS (
               SELECT 1
               FROM password_reset_requests
               WHERE id = ?
                 AND user_id = users.id
                 AND status = 'approved'
                 AND setup_method = 'admin_approved'
                 AND expires_at > ?
             )
           )
         RETURNING id`,
      ).bind(
        passwordHash,
        nowIso,
        candidate.id,
        candidate.password_hash,
        expectedVenueId,
        expectedVenueId,
        firstLoginSetupMethod,
        candidate.admin_approved_request_id,
        nowIso,
      ),
      env.DB.prepare(
        COMPLETE_OPEN_PASSWORD_RESET_REQUEST_AFTER_USER_UPDATE_SQL,
      ).bind(nowIso, nowIso, candidate.id),
      env.DB.prepare(
        `UPDATE password_reset_tokens
         SET used = 1
         WHERE user_id = ?
           AND used = 0
           AND EXISTS (
             SELECT 1 FROM users
             WHERE id = ?
               AND migration_status = 'active'
               AND password_set_at = ?
           )
         RETURNING user_id`,
      ).bind(candidate.id, candidate.id, nowIso),
      env.DB.prepare(
        `INSERT INTO user_audit_events (
           id, venue_id, actor_user_id, target_user_id, action, details, created_at
         )
         SELECT ?, venue_id, id, id, 'password_setup_completed', ?, ?
         FROM users
         WHERE id = ?
           AND migration_status = 'active'
           AND password_set_at = ?`,
      ).bind(
        crypto.randomUUID(),
        JSON.stringify({
          method:
            firstLoginSetupMethod === "admin_approved"
              ? "admin_approved"
              : "manual_setup_code",
        }),
        nowIso,
        candidate.id,
        nowIso,
      ),
    ]);

    const claimedUserId = (
      userResult.results?.[0] as { id?: string } | undefined
    )?.id;

    if (!claimedUserId) {
      return NextResponse.json(
        {
          code: "ACCOUNT_NOT_ELIGIBLE",
          error:
            "This account is not eligible for first-time setup. Sign in normally or contact an administrator.",
        },
        { status: 400 },
      );
    }

    await Promise.all([
      clearRateLimit("claim-account", identifier),
      clearRateLimit("login", identifier),
    ]);

    return NextResponse.json({
      ok: true,
      message: "Your password has been set. Signing you in now.",
    });
  } catch (error) {
    console.error("Account claim error:", error);
    return NextResponse.json(
      { code: "SERVER_ERROR", error: "Unable to complete first-time setup right now." },
      { status: 500 },
    );
  }
}
