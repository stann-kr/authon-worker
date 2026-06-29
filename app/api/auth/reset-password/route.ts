import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users, passwordResetTokens } from "@/lib/db/schema";
import { sendEmail } from "@/lib/api/email";
import { hashPassword } from "@/lib/auth/password";
import { consumeRateLimit, getRequestIp } from "@/lib/auth/rate-limit";
import { getPasswordPolicyError } from "@/lib/auth/password-policy";

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

    const normalizedEmail = String(email).trim().toLowerCase();
    const ip = getRequestIp(request);
    const rateLimit = await consumeRateLimit({
      namespace: "password-reset",
      identifier: `${ip}:${normalizedEmail}`,
      limit: 3,
      windowSeconds: 60 * 60,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "재설정 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const db = drizzle(env.DB);
    const result = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    const user = result[0];

    // 이메일 enumeration 방지: 미가입 이메일도 동일 응답
    if (!user || !user.active) {
      return NextResponse.json({ ok: true, message: "재설정 메일이 발송되었습니다." });
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();

    await db.insert(passwordResetTokens).values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString(),
    });

    const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetLink = `${appUrl}/auth/reset-password?token=${token}`;

    await sendEmail({
      to: normalizedEmail,
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

    const policyError = getPasswordPolicyError(newPassword);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);
    const nowIso = new Date().toISOString();

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
         WHERE id = (
           SELECT prt.user_id
           FROM password_reset_tokens prt
           JOIN users u ON u.id = prt.user_id
           WHERE prt.token = ?
             AND prt.used = 0
             AND prt.expires_at > ?
             AND u.active = 1
         )
         RETURNING id`
      ).bind(passwordHash, token, nowIso),
      env.DB.prepare(
        `UPDATE password_reset_tokens
         SET used = 1
         WHERE token = ?
           AND used = 0
           AND expires_at > ?
           AND changes() = 1
         RETURNING user_id`
      ).bind(token, nowIso),
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
