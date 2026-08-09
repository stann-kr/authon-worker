import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hashPassword } from "@/lib/auth/password";
import { getPasswordPolicyError } from "@/lib/auth/password-policy";
import { hashResetToken } from "@/lib/auth/token";
import { getTenantContextForRequest } from "@/lib/tenant/server";

const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const SELECT_VALID_RESET_TOKEN_CANDIDATE_SQL = `
  SELECT prt.user_id
  FROM password_reset_tokens prt
  JOIN users u ON u.id = prt.user_id
  WHERE prt.token = ?
    AND prt.used = 0
    AND prt.expires_at > ?
    AND u.active = 1
    AND u.deleted_at IS NULL
    AND (? IS NULL OR u.venue_id = ?)
  LIMIT 1
`;

const UPDATE_PASSWORD_WITH_VALID_TOKEN_SQL = `
  UPDATE users
  SET password_hash = ?,
      session_version = session_version + 1,
      migration_status = CASE
        WHEN migration_status = 'pending_reset' THEN 'active'
        ELSE migration_status
      END,
      password_set_at = ?
  WHERE id = (
    SELECT prt.user_id
    FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE prt.token = ?
      AND prt.used = 0
      AND prt.expires_at > ?
      AND u.active = 1
      AND u.deleted_at IS NULL
      AND (? IS NULL OR u.venue_id = ?)
  )
  RETURNING id
`;

const CONSUME_EXACT_RESET_TOKEN_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE token = ?
    AND used = 0
    AND expires_at > ?
    AND changes() = 1
  RETURNING user_id
`;

const INSERT_TOKEN_RESET_AUDIT_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, u.venue_id, u.id, u.id, 'password_reset_completed', ?, ?
  FROM users u
  JOIN password_reset_tokens prt ON prt.user_id = u.id
  WHERE prt.token = ?
    AND prt.used = 1
    AND changes() = 1
  RETURNING target_user_id
`;

const INVALIDATE_ALL_USER_RESET_TOKENS_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE used = 0
    AND user_id = (
      SELECT target_user_id
      FROM user_audit_events
      WHERE id = ?
        AND action = 'password_reset_completed'
    )
`;

const COMPLETE_TOKEN_RESET_REQUESTS_SQL = `
  UPDATE password_reset_requests
  SET status = 'completed',
      completed_at = ?,
      updated_at = ?
  WHERE status IN ('pending', 'approved')
    AND user_id = (
      SELECT target_user_id
      FROM user_audit_events
      WHERE id = ?
        AND action = 'password_reset_completed'
    )
`;

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
    const body: unknown = await request.json().catch(() => null);
    const token = body && typeof body === "object" && "token" in body
      ? (body as { token?: unknown }).token
      : undefined;
    const newPassword = body && typeof body === "object" && "newPassword" in body
      ? (body as { newPassword?: unknown }).newPassword
      : undefined;

    if (typeof token !== "string" || typeof newPassword !== "string") {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }

    const policyError = getPasswordPolicyError(newPassword);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const normalizedToken = token.trim();
    if (!RESET_TOKEN_PATTERN.test(normalizedToken)) {
      return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
    }

    const tokenHash = await hashResetToken(normalizedToken);
    const tenant = await getTenantContextForRequest(request);
    const expectedVenueId = tenant.scope === "venue" ? tenant.venueId : null;

    if (!tenant.resolved) {
      return NextResponse.json({ error: "Unknown venue." }, { status: 404 });
    }

    const candidate = await env.DB.prepare(
      SELECT_VALID_RESET_TOKEN_CANDIDATE_SQL,
    )
      .bind(tokenHash, nowIso, expectedVenueId, expectedVenueId)
      .first<{ user_id: string }>();
    if (!candidate?.user_id) {
      return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
    }

    // 고비용 password hash는 고엔트로피 exact token과 tenant가 먼저
    // 검증된 경우에만 계산한다. 아래 batch가 최종 경쟁 승자를 다시 판정한다.
    const passwordHash = await hashPassword(newPassword);

    // The exact token consumption is the winning operation. The immediately
    // following audit row receives changes() from that operation, and every
    // remaining mutation is gated by the audit event's unique ID.
    const auditEventId = crypto.randomUUID();
    const [passwordResult, tokenResult, auditResult] = await env.DB.batch<{
      id?: string;
      user_id?: string;
      target_user_id?: string;
    }>([
      env.DB.prepare(UPDATE_PASSWORD_WITH_VALID_TOKEN_SQL).bind(
        passwordHash,
        nowIso,
        tokenHash,
        nowIso,
        expectedVenueId,
        expectedVenueId,
      ),
      env.DB.prepare(CONSUME_EXACT_RESET_TOKEN_SQL).bind(tokenHash, nowIso),
      env.DB.prepare(INSERT_TOKEN_RESET_AUDIT_SQL).bind(
        auditEventId,
        JSON.stringify({ method: "email_token" }),
        nowIso,
        tokenHash,
      ),
      env.DB.prepare(INVALIDATE_ALL_USER_RESET_TOKENS_SQL).bind(auditEventId),
      env.DB.prepare(COMPLETE_TOKEN_RESET_REQUESTS_SQL).bind(
        nowIso,
        nowIso,
        auditEventId,
      ),
    ]);

    const updatedUserId = (passwordResult.results?.[0] as { id?: string } | undefined)?.id;
    const consumedUserId = (tokenResult.results?.[0] as { user_id?: string } | undefined)?.user_id;
    const auditedUserId = (
      auditResult.results?.[0] as { target_user_id?: string } | undefined
    )?.target_user_id;

    if (
      !updatedUserId ||
      !consumedUserId ||
      !auditedUserId ||
      updatedUserId !== consumedUserId ||
      updatedUserId !== auditedUserId
    ) {
      return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "비밀번호가 성공적으로 변경되었습니다." });
  } catch (error) {
    console.error("Password reset update error:", error);
    return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
