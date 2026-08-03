import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hashPassword } from "@/lib/auth/password";
import { getPasswordPolicyError } from "@/lib/auth/password-policy";
import {
  clearRateLimit,
  consumeRateLimit,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";

/**
 * 이관 사용자 전용 1회성 비밀번호 설정.
 * 운영 전환 기간에만 사용하는 내부 계정 복구 예외이며, pending_reset 상태를
 * 원자적으로 소비해 동일 계정에서 두 번 실행할 수 없게 한다.
 */
export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const { email, newPassword } = await request.json();

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof newPassword !== "string"
    ) {
      return NextResponse.json(
        { error: "Email and a new password are required." },
        { status: 400 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordPolicyError = getPasswordPolicyError(newPassword);
    if (passwordPolicyError) {
      return NextResponse.json(
        { error: passwordPolicyError },
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
        { error: "Too many setup attempts. Please try again later." },
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
      return NextResponse.json({ error: "Unknown venue." }, { status: 404 });
    }

    const [userResult] = await env.DB.batch<{ id: string } | { user_id: string }>([
      env.DB.prepare(
        `UPDATE users
         SET password_hash = ?,
             migration_status = 'active',
             password_set_at = ?,
             session_version = session_version + 1
         WHERE email = ?
           AND active = 1
           AND migration_status = 'pending_reset'
           AND password_set_at IS NULL
           AND (? IS NULL OR venue_id = ?)
         RETURNING id`,
      ).bind(passwordHash, nowIso, normalizedEmail, expectedVenueId, expectedVenueId),
      env.DB.prepare(
        `UPDATE password_reset_tokens
         SET used = 1
         WHERE user_id = (SELECT id FROM users WHERE email = ?)
           AND used = 0
           AND changes() = 1
         RETURNING user_id`,
      ).bind(normalizedEmail),
    ]);

    const claimedUserId = (
      userResult.results?.[0] as { id?: string } | undefined
    )?.id;

    if (!claimedUserId) {
      return NextResponse.json(
        {
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
      { error: "Unable to complete first-time setup right now." },
      { status: 500 },
    );
  }
}
