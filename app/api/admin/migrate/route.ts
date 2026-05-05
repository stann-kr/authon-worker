import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { users, passwordResetTokens } from "@/lib/db/schema";
import { sendEmail } from "@/lib/api/email";

/**
 * 레거시 유저 마이그레이션 API (super_admin 전용)
 * - JWT 쿠키에서 역할 검증 후 실행
 * - 유저 데이터 삽입
 * - 비밀번호 재설정 토큰 생성 및 메일 발송
 */

export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();

    // ─── super_admin 역할 검증 ────────────────────────────────
    const cookieHeader = request.headers.get("cookie") || "";
    const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
    const jwtToken = tokenMatch?.[1];

    if (!jwtToken || !env.JWT_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const { payload } = await import("jose").then(({ jwtVerify }) =>
        jwtVerify(jwtToken, new TextEncoder().encode(env.JWT_SECRET))
      );
      if (payload.role !== "super_admin") {
        return NextResponse.json({ error: "Forbidden: super_admin only" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const { users: legacyUsers } = await request.json();

    if (!legacyUsers || !Array.isArray(legacyUsers)) {
      return NextResponse.json({ error: "유효한 유저 데이터가 없습니다." }, { status: 400 });
    }

    const db = drizzle(env.DB);
    const results = [];

    for (const legacyUser of legacyUsers) {
      try {
        // 1. 이미 존재하는 유저인지 확인
        const existing = await db.select().from(users).where(eq(users.email, legacyUser.email)).limit(1);
        
        if (existing.length > 0) {
          results.push({ email: legacyUser.email, status: "skipped", reason: "이미 존재함" });
          continue;
        }

        // 2. 역할 매핑
        let role = "staff";
        const legacyRole = legacyUser.role.toLowerCase();
        if (legacyRole === "dj") role = "dj";
        else if (legacyRole === "door") role = "door_staff";
        else if (legacyRole === "admin") role = "venue_admin";

        // 3. 유저 생성 (초기 비밀번호는 무작위 생성 후 해싱)
        const userId = crypto.randomUUID();
        const initialPassword = crypto.randomUUID().slice(0, 12);
        const passwordHash = await bcrypt.hash(initialPassword, 10);

        await db.insert(users).values({
          id: userId,
          email: legacyUser.email,
          name: legacyUser.name,
          passwordHash,
          role: role,
          guestLimit: legacyUser.guest_limit || 10,
          active: true,
          createdAt: new Date().toISOString(),
        });

        // 4. 비밀번호 재설정 토큰 생성 (강제 변경 유도용)
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7일 유효

        await db.insert(passwordResetTokens).values({
          id: crypto.randomUUID(),
          userId: userId,
          token,
          expiresAt,
          used: false,
          createdAt: new Date().toISOString(),
        });

        // 5. 초기 비밀번호 안내 및 재설정 링크 메일 발송
        const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const resetLink = `${appUrl}/auth/reset-password?token=${token}`;

        await sendEmail({
          to: legacyUser.email,
          subject: "[Authon] 계정 마이그레이션 및 비밀번호 설정 안내",
          body: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>계정 마이그레이션 안내</h2>
              <p>안녕하세요, ${legacyUser.name}님.</p>
              <p>기존 시스템의 계정이 새로운 Authon 플랫폼으로 성공적으로 이관되었습니다.</p>
              <p>보안을 위해 아래 링크를 클릭하여 새로운 비밀번호를 설정해주시기 바랍니다.</p>
              <div style="margin: 30px 0;">
                <a href="${resetLink}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px;">새 비밀번호 설정하기</a>
              </div>
              <p>이 링크는 7일 동안 유효합니다.</p>
              <p style="color: #666; font-size: 12px; margin-top: 40px;">본 메일은 발신 전용입니다.</p>
            </div>
          `,
        });

        results.push({ email: legacyUser.email, status: "success" });
      } catch (err: unknown) {
        console.error(`Migration failed for ${legacyUser.email}:`, err);
        results.push({ email: legacyUser.email, status: "failed", reason: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("Migration API error:", error);
    return NextResponse.json({ error: "마이그레이션 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
