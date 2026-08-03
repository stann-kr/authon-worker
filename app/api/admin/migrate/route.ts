import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users, passwordResetTokens, userAuditEvents } from "@/lib/db/schema";
import { escapeHtml, sendEmail } from "@/lib/api/email";
import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/server";
import { generateResetToken, hashResetToken } from "@/lib/auth/token";
import { getVenueDeliveryContext } from "@/lib/tenant/server";

/**
 * 레거시 유저 마이그레이션 API (super_admin 전용)
 * - 공통 `requireRole(["super_admin"])` 경로로 인증/세션/활성 사용자 검증 후 실행
 * - 유저 데이터 삽입 + 비밀번호 재설정 토큰 생성
 * - sendEmail 실패는 user 생성을 롤백하지 않고 별도 상태로 반환
 */

function getAuthErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "Unauthorized" || error.message === "Session expired") return 401;
  if (error.message === "Forbidden") return 403;
  return null;
}

export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const actor = await requireRole(["super_admin"]);

    const { users: legacyUsers } = await request.json();

    if (!legacyUsers || !Array.isArray(legacyUsers)) {
      return NextResponse.json({ error: "유효한 유저 데이터가 없습니다." }, { status: 400 });
    }

    const db = drizzle(env.DB);
    const results = [];

    for (const legacyUser of legacyUsers) {
      try {
        const normalizedEmail = String(legacyUser.email).trim().toLowerCase();
        const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

        if (existing.length > 0) {
          results.push({ email: normalizedEmail, status: "skipped", reason: "이미 존재함" });
          continue;
        }

        // 역할 매핑
        let role = "staff";
        const legacyRole = legacyUser.role.toLowerCase();
        if (legacyRole === "dj") role = "dj";
        else if (legacyRole === "door") role = "door_staff";
        else if (legacyRole === "admin") role = "venue_admin";

        // 유저 생성
        const userId = legacyUser.id || crypto.randomUUID();
        const initialPassword = crypto.randomUUID().slice(0, 12);
        const passwordHash = await hashPassword(initialPassword);
        const nowIso = new Date().toISOString();

        const venueId = legacyUser.venue_id || legacyUser.venueId || null;
        await db.batch([
          db.insert(users).values({
            id: userId,
            legacyAuthUserId: legacyUser.auth_user_id || legacyUser.legacy_auth_user_id || null,
            email: normalizedEmail,
            name: legacyUser.name,
            passwordHash,
            role,
            venueId,
            guestLimit: legacyUser.guest_limit || 10,
            active: legacyUser.active !== false,
            migrationStatus: "pending_reset",
            migratedAt: nowIso,
            passwordSetAt: null,
            createdAt: legacyUser.created_at || nowIso,
          }),
          db.insert(userAuditEvents).values({
            id: crypto.randomUUID(),
            venueId,
            actorUserId: actor.id,
            targetUserId: userId,
            action: "created",
            details: JSON.stringify({ role, source: "legacy_migration" }),
            createdAt: nowIso,
          }),
        ]);

        // 비밀번호 재설정 토큰 생성
        const token = generateResetToken();
        const tokenHash = await hashResetToken(token);
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

        await db.insert(passwordResetTokens).values({
          id: crypto.randomUUID(),
          userId,
          token: tokenHash,
          expiresAt,
          used: false,
          createdAt: nowIso,
        });

        // 이메일 발송 (실패해도 user 생성 롤백 없이 상태만 기록)
        const delivery = await getVenueDeliveryContext(
          venueId,
          env.NEXT_PUBLIC_APP_URL,
        );
        const resetLink = `${delivery.baseUrl}/auth/reset-password?token=${token}`;
        const safeName = escapeHtml(String(legacyUser.name));
        const safeResetLink = escapeHtml(resetLink);
        let emailSent = false;

        try {
          await sendEmail({
            to: normalizedEmail,
            subject: `[${delivery.brand.name}] 계정 마이그레이션 및 비밀번호 설정 안내`,
            body: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>계정 마이그레이션 안내</h2>
                <p>안녕하세요, ${safeName}님.</p>
                <p>기존 시스템의 계정이 새로운 ${escapeHtml(delivery.brand.name)} 플랫폼으로 성공적으로 이관되었습니다.</p>
                <p>보안을 위해 아래 링크를 클릭하여 새로운 비밀번호를 설정해주시기 바랍니다.</p>
                <div style="margin: 30px 0;">
                  <a href="${safeResetLink}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px;">새 비밀번호 설정하기</a>
                </div>
                <p>이 링크는 7일 동안 유효합니다.</p>
                <p style="color: #666; font-size: 12px; margin-top: 40px;">본 메일은 발신 전용입니다.</p>
              </div>
            `,
          });
          emailSent = true;
        } catch (emailErr) {
          console.error(`[migrate] Email failed for ${normalizedEmail}:`, emailErr);
        }

        results.push({ email: normalizedEmail, id: userId, status: "success", emailSent });
      } catch (err: unknown) {
        console.error(`Migration failed for ${legacyUser.email}:`, err);
        results.push({
          email: legacyUser.email,
          status: "failed",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("Migration API error:", error);
    const authStatus = getAuthErrorStatus(error);
    if (authStatus) {
      return NextResponse.json({ error: authStatus === 403 ? "Forbidden" : "Unauthorized" }, { status: authStatus });
    }
    return NextResponse.json({ error: "마이그레이션 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
