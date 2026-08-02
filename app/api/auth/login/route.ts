import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { users } from "@/lib/db/schema";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/auth/password";
import { clearRateLimit, consumeRateLimit, getRequestIp } from "@/lib/auth/rate-limit";

export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const { email, password } = await request.json();

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return NextResponse.json(
        { error: "이메일과 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const ip = getRequestIp(request);
    const rateLimit = await consumeRateLimit({
      namespace: "login",
      identifier: `${ip}:${normalizedEmail}`,
      limit: 5,
      windowSeconds: 60 * 15,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const db = drizzle(env.DB);
    const result = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    const user = result[0];

    const invalidCredentialsResponse = () => NextResponse.json(
      { error: "이메일 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );

    if (!user || !user.active) {
      return invalidCredentialsResponse();
    }

    if (
      user.migrationStatus === "pending_reset" &&
      !user.passwordSetAt
    ) {
      return NextResponse.json(
        {
          error: "First-time password setup is required.",
          code: "PASSWORD_SETUP_REQUIRED",
        },
        { status: 409 },
      );
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      return invalidCredentialsResponse();
    }

    // bcrypt 해시 → PBKDF2 자동 재해시
    if (needsRehash(user.passwordHash)) {
      const newHash = await hashPassword(password);
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
    }

    if (!env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return NextResponse.json({ error: "로그인 처리 중 오류가 발생했습니다." }, { status: 500 });
    }
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({
      sub: user.id,
      email: user.email,
      role: user.role,
      venueId: user.venueId,
      sv: user.sessionVersion ?? 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(secret);

    const sessionId = crypto.randomUUID();
    await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({
      userId: user.id,
      sessionVersion: user.sessionVersion ?? 0,
    }), {
      expirationTtl: 60 * 60 * 24,
    });

    await clearRateLimit("login", `${ip}:${normalizedEmail}`);

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
