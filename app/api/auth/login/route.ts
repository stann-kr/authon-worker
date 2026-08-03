import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { users } from "@/lib/db/schema";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/auth/password";
import { clearRateLimit, consumeRateLimit, getRequestIp } from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@/i18n/config";

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
        { code: "MISSING_CREDENTIALS", error: "Email and password are required." },
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
        { code: "RATE_LIMITED", error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const db = drizzle(env.DB);
    const result = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    const user = result[0];
    const tenant = await getTenantContextForRequest(request);

    const invalidCredentialsResponse = () => NextResponse.json(
      { code: "INVALID_CREDENTIALS", error: "Invalid email or password." },
      { status: 401 }
    );

    if (
      !tenant.resolved ||
      !user ||
      !user.active ||
      user.deletedAt ||
      (tenant.scope === "venue" && user.role !== "super_admin" && user.venueId !== tenant.venueId)
    ) {
      return invalidCredentialsResponse();
    }

    const isMatch = await verifyPassword(password, user.passwordHash);

    if (user.migrationStatus === "pending_reset" && !user.passwordSetAt) {
      if (!isMatch) return invalidCredentialsResponse();
      return NextResponse.json(
        {
          error: "First-time password setup is required.",
          code: "PASSWORD_SETUP_REQUIRED",
        },
        { status: 409 },
      );
    }

    if (!isMatch) {
      return invalidCredentialsResponse();
    }

    if (!env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return NextResponse.json({ code: "SERVER_ERROR", error: "Unable to sign in right now." }, { status: 500 });
    }

    // 성공한 로그인 시각 기록 + bcrypt 해시 → PBKDF2 자동 재해시
    const loginUpdates: Partial<typeof users.$inferInsert> = {
      lastLoginAt: new Date().toISOString(),
    };
    if (needsRehash(user.passwordHash)) loginUpdates.passwordHash = await hashPassword(password);
    await db.update(users).set(loginUpdates).where(eq(users.id, user.id));

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
        preferredLocale: isLocale(user.preferredLocale) ? user.preferredLocale : null,
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

    if (isLocale(user.preferredLocale)) {
      response.cookies.set({
        name: LOCALE_COOKIE_NAME,
        value: user.preferredLocale,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        path: "/",
      });
    }

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { code: "SERVER_ERROR", error: "Unable to sign in right now." },
      { status: 500 }
    );
  }
}
