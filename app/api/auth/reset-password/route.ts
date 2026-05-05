import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { users, passwordResetTokens } from "@/lib/db/schema";
import { sendEmail } from "@/lib/api/email";

/**
 * 비밀번호 재설정 요청 (POST) 및 재설정 실행 (PUT)
 */

export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "이메일을 입력해주세요." }, { status: 400 });
    }

    const db = drizzle(env.DB);
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = result[0];

    // 보안상 사용자가 없더라도 성공 메시지를 보낼 수도 있지만, 여기서는 명시적으로 처리
    if (!user) {
      return NextResponse.json({ error: "등록되지 않은 이메일입니다." }, { status: 404 });
    }

    // 토큰 생성 (UUID 기반)
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // 1시간 후 만료

    await db.insert(passwordResetTokens).values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString(),
    });

    // 재설정 링크 이메일 발송
    const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetLink = `${appUrl}/auth/reset-password?token=${token}`;
    
    await sendEmail({
      to: email,
      subject: "[Authon] 비밀번호 재설정 안내",
      body: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>비밀번호 재설정 안내</h2>
          <p>안녕하세요, ${user.name}님.</p>
          <p>비밀번호 재설정을 위해 아래 링크를 클릭해주세요. 이 링크는 1시간 동안 유효합니다.</p>
          <div style="margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px;">비밀번호 재설정하기</a>
          </div>
          <p>만약 본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.</p>
          <p style="color: #666; font-size: 12px; margin-top: 40px;">본 메일은 발신 전용입니다.</p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true, message: "재설정 메일이 발송되었습니다." });
  } catch (error) {
    console.error("Password reset request error:", error);
    return NextResponse.json({ error: "요청 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const { token, newPassword } = await request.json();

    if (!token || !newPassword) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }

    const db = drizzle(env.DB);
    
    // 토큰 검증
    const tokenResult = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token))
      .limit(1);
    
    const resetToken = tokenResult[0];

    if (!resetToken || resetToken.used || new Date(resetToken.expiresAt) < new Date()) {
      return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
    }

    // 비밀번호 해싱 및 업데이트
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    // 유저 비밀번호 업데이트 및 토큰 사용 처리 (트랜잭션 권장되나 D1 API 특성상 단순 순차 실행)
    await db.update(users).set({ passwordHash }).where(eq(users.id, resetToken.userId));
    await db.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.id, resetToken.id));

    return NextResponse.json({ ok: true, message: "비밀번호가 성공적으로 변경되었습니다." });
  } catch (error) {
    console.error("Password reset update error:", error);
    return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
