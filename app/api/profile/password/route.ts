import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { requireAuth } from "@/lib/auth/server";
import { getPasswordPolicyError } from "@/lib/auth/password-policy";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

const UPDATE_PROFILE_PASSWORD_CAS_SQL = `
  UPDATE users
  SET password_hash = ?,
      password_set_at = ?,
      session_version = session_version + 1
  WHERE id = ?
    AND password_hash = ?
    AND session_version = ?
    AND active = 1
    AND deleted_at IS NULL
  RETURNING id
`;

const INSERT_PROFILE_PASSWORD_AUDIT_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, venue_id, id, id, 'password_changed', ?, ?
  FROM users
  WHERE id = ?
    AND changes() = 1
  RETURNING target_user_id
`;

const INVALIDATE_PROFILE_RESET_TOKENS_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE user_id = ?
    AND used = 0
    AND EXISTS (
      SELECT 1
      FROM user_audit_events
      WHERE id = ?
        AND target_user_id = ?
        AND action = 'password_changed'
    )
`;

const CANCEL_PROFILE_RESET_REQUESTS_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND EXISTS (
      SELECT 1
      FROM user_audit_events
      WHERE id = ?
        AND target_user_id = ?
        AND action = 'password_changed'
    )
`;

function getAuthErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "Unauthorized" || error.message === "Session expired") return 401;
  if (error.message === "Forbidden") return 403;
  return null;
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    const { env } = getCloudflareContext();
    const authUser = await requireAuth();
    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Passwords are required" }, { status: 400 });
    }

    const policyError = getPasswordPolicyError(newPassword);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const db = drizzle(env.DB);
    const result = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
    const user = result[0];

    if (!user || !user.active) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const isMatch = await verifyPassword(currentPassword, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 400 });
    }

    const hashedPassword = await hashPassword(newPassword);
    const nowIso = new Date().toISOString();
    const auditEventId = crypto.randomUUID();
    const [passwordResult, auditResult] = await env.DB.batch<{
      id?: string;
      target_user_id?: string;
    }>([
      env.DB.prepare(UPDATE_PROFILE_PASSWORD_CAS_SQL).bind(
        hashedPassword,
        nowIso,
        user.id,
        user.passwordHash,
        user.sessionVersion,
      ),
      env.DB.prepare(INSERT_PROFILE_PASSWORD_AUDIT_SQL).bind(
        auditEventId,
        JSON.stringify({ method: "authenticated_profile" }),
        nowIso,
        user.id,
      ),
      env.DB.prepare(INVALIDATE_PROFILE_RESET_TOKENS_SQL).bind(
        user.id,
        auditEventId,
        user.id,
      ),
      env.DB.prepare(CANCEL_PROFILE_RESET_REQUESTS_SQL).bind(
        nowIso,
        user.id,
        auditEventId,
        user.id,
      ),
    ]);

    const updatedUserId = (
      passwordResult.results?.[0] as { id?: string } | undefined
    )?.id;
    const auditedUserId = (
      auditResult.results?.[0] as { target_user_id?: string } | undefined
    )?.target_user_id;
    if (updatedUserId !== user.id || auditedUserId !== user.id) {
      return NextResponse.json(
        { error: "계정 상태가 변경되었습니다. 다시 로그인한 뒤 시도해주세요." },
        { status: 409 },
      );
    }

    const cookieHeader = request.headers.get("cookie") || "";
    const sessionId = cookieHeader.match(/(?:^|;\s*)sessionId=([^;]+)/)?.[1];
    if (sessionId) {
      try {
        await env.SESSIONS.delete(`session:${sessionId}`);
      } catch (error: unknown) {
        // DB session_version is authoritative, so KV cleanup failure must not
        // turn an already-committed password change into a client-visible failure.
        await reportServerError("auth.profile_password.session_cleanup", error, {
          requestId,
          actorId: user.id,
          venueId: user.venueId,
        });
      }
    }

    const response = NextResponse.json({
      ok: true,
      message: "비밀번호가 변경되어 다시 로그인해야 합니다.",
      reauthRequired: true,
    });
    const secureCookies = shouldUseSecureAuthCookies(request);
    response.cookies.set({
      name: "token",
      value: "",
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    response.cookies.set({
      name: "sessionId",
      value: "",
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    await writeStructuredLog("info", {
      event: "auth.profile_password",
      requestId,
      actorId: user.id,
      venueId: user.venueId,
      outcome: "success",
    });
    return response;
  } catch (error: unknown) {
    await reportServerError("auth.profile_password", error, { requestId });
    const authStatus = getAuthErrorStatus(error);
    if (authStatus) {
      return NextResponse.json({ error: "Unauthorized" }, { status: authStatus });
    }
    return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
