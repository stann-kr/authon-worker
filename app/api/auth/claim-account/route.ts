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

/**
 * 관리자 발급 설정 코드 또는 이관용 설정 코드의 1회성 비밀번호 설정.
 * pending_reset 상태와 현재 설정 코드 hash를 함께 확인해 재사용을 막는다.
 */
export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const { email, setupCode, newPassword } = await request.json();

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof setupCode !== "string" ||
      !setupCode ||
      typeof newPassword !== "string"
    ) {
      return NextResponse.json(
        { code: "MISSING_SETUP_FIELDS", error: "Email, setup code, and a new password are required." },
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
      `SELECT id, venue_id, password_hash
       FROM users
       WHERE email = ?
         AND active = 1
         AND deleted_at IS NULL
         AND migration_status = 'pending_reset'
         AND password_set_at IS NULL
         AND (? IS NULL OR venue_id = ?)
       LIMIT 1`,
    )
      .bind(normalizedEmail, expectedVenueId, expectedVenueId)
      .first<{ id: string; venue_id: string | null; password_hash: string }>();

    if (!candidate || !(await verifyPassword(setupCode, candidate.password_hash))) {
      return NextResponse.json(
        {
          code: "ACCOUNT_NOT_ELIGIBLE",
          error: "The setup code is invalid or this account is not eligible for first-time setup.",
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
         RETURNING id`,
      ).bind(
        passwordHash,
        nowIso,
        candidate.id,
        candidate.password_hash,
        expectedVenueId,
        expectedVenueId,
      ),
      env.DB.prepare(
        `UPDATE password_reset_tokens
         SET used = 1
         WHERE user_id = ?
           AND used = 0
           AND changes() = 1
         RETURNING user_id`,
      ).bind(candidate.id),
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
        JSON.stringify({ method: "manual_setup_code" }),
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
