import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { users } from "@/lib/db/schema";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/auth/password";

export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "이메일과 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    const db = drizzle(env.DB);
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = result[0];

    if (!user || !user.active) {
      return NextResponse.json(
        { error: "존재하지 않거나 비활성화된 계정입니다." },
        { status: 401 }
      );
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json(
        { error: "비밀번호가 일치하지 않습니다." },
        { status: 401 }
      );
    }

    // bcrypt 해시 → PBKDF2 자동 재해시
    if (needsRehash(user.passwordHash)) {
      const newHash = await hashPassword(password);
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
    }

    if (!env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({
      sub: user.id,
      email: user.email,
      role: user.role,
      venueId: user.venueId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(secret);

    const sessionId = crypto.randomUUID();
    await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({ userId: user.id }), {
      expirationTtl: 60 * 60 * 24,
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        venueId: user.venueId ?? null,
        guestLimit: user.guestLimit ?? 0,
      },
    });

    response.cookies.set({
      name: "token",
      value: token,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    response.cookies.set({
      name: "sessionId",
      value: sessionId,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "로그인 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
