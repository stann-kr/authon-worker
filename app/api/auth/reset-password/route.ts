import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hashPassword } from "@/lib/auth/password";
import { getPasswordPolicyError } from "@/lib/auth/password-policy";
import { hashResetToken } from "@/lib/auth/token";
import { getTenantContextForRequest } from "@/lib/tenant/server";

/**
 * 자가 이메일 요청 차단 (POST) 및 이미 발급된 token 재설정 실행 (PUT)
 */

export async function POST() {
  return NextResponse.json(
    {
      code: "EMAIL_RESET_DISABLED",
      error: "Email password reset is disabled. Request help from an administrator.",
    },
    { status: 410, headers: { Allow: "PUT" } },
  );
}

export async function PUT(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const { token, newPassword } = await request.json();

    if (!token || !newPassword) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }

    const policyError = getPasswordPolicyError(newPassword);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);
    const nowIso = new Date().toISOString();
    const tokenHash = await hashResetToken(token);
    const tenant = await getTenantContextForRequest(request);
    const expectedVenueId = tenant.scope === "venue" ? tenant.venueId : null;

    if (!tenant.resolved) {
      return NextResponse.json({ error: "Unknown venue." }, { status: 404 });
    }

    // Execute as a D1 batch (transactional) and make the success path depend on
    // both statements succeeding in sequence:
    // 1) update the active target user selected by a still-valid, unused token
    // 2) mark that exact token as used only if step 1 changed a row
    const [passwordResult, tokenResult] = await env.DB.batch<
      { id: string } | { user_id: string }
    >([
      env.DB.prepare(
        `UPDATE users
         SET password_hash = ?, session_version = session_version + 1
             , migration_status = CASE WHEN migration_status = 'pending_reset' THEN 'active' ELSE migration_status END
             , password_set_at = ?
         WHERE id = (
           SELECT prt.user_id
           FROM password_reset_tokens prt
           JOIN users u ON u.id = prt.user_id
           WHERE prt.token = ?
             AND prt.used = 0
             AND prt.expires_at > ?
             AND u.active = 1
             AND (? IS NULL OR u.venue_id = ?)
         )
         RETURNING id`
      ).bind(passwordHash, nowIso, tokenHash, nowIso, expectedVenueId, expectedVenueId),
      env.DB.prepare(
        `UPDATE password_reset_tokens
         SET used = 1
         WHERE token = ?
           AND used = 0
           AND expires_at > ?
           AND changes() = 1
         RETURNING user_id`
      ).bind(tokenHash, nowIso),
      env.DB.prepare(
        `UPDATE password_reset_requests
         SET status = 'completed',
             completed_at = ?,
             updated_at = ?
         WHERE user_id = (
           SELECT user_id FROM password_reset_tokens WHERE token = ?
         )
           AND status IN ('pending', 'approved')
           AND changes() = 1`,
      ).bind(nowIso, nowIso, tokenHash),
      env.DB.prepare(
        `INSERT INTO user_audit_events (
           id, venue_id, actor_user_id, target_user_id, action, details, created_at
         )
         SELECT ?, u.venue_id, u.id, u.id, 'password_reset_completed', ?, ?
         FROM users u
         JOIN password_reset_tokens prt ON prt.user_id = u.id
         WHERE prt.token = ?
           AND u.password_set_at = ?`,
      ).bind(
        crypto.randomUUID(),
        JSON.stringify({ method: "email_token" }),
        nowIso,
        tokenHash,
        nowIso,
      ),
    ]);

    const updatedUserId = (passwordResult.results?.[0] as { id?: string } | undefined)?.id;
    const consumedUserId = (tokenResult.results?.[0] as { user_id?: string } | undefined)?.user_id;

    if (!updatedUserId || !consumedUserId || updatedUserId !== consumedUserId) {
      return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "비밀번호가 성공적으로 변경되었습니다." });
  } catch (error) {
    console.error("Password reset update error:", error);
    return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
