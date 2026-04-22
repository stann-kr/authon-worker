import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { users } from "@/lib/db/schema";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
}

export async function POST(request: Request) {
  try {
    const { env } = getRequestContext() as unknown as { env: Env };
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

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json(
        { error: "비밀번호가 일치하지 않습니다." },
        { status: 401 }
      );
    }

    // JWT 생성
    const secret = new TextEncoder().encode(env.JWT_SECRET || "default_secret_for_local_dev");
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

    // KV에 세션 저장 (선택적이지만 요구사항에 포함)
    const sessionId = crypto.randomUUID();
    await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({ userId: user.id, token }), {
      expirationTtl: 60 * 60 * 24, // 24 hours
    });

    const response = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, role: user.role, name: user.name } });

    // 쿠키 설정
    response.cookies.set({
      name: "token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 1 day
      path: "/",
    });
    
    // session id cookie (optional, but good for KV revoking later)
    response.cookies.set({
      name: "sessionId",
      value: sessionId,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 1 day
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
