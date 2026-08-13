import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { users, venues } from "@/lib/db/schema";
import {
  DUMMY_PASSWORD_HASH,
  verifyPassword,
  hashPassword,
  needsRehash,
} from "@/lib/auth/password";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import {
  consumeRateLimitOrDeny,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@/i18n/config";
import { isAccountKind, isRole } from "@/lib/users/policy";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import { hasActiveVenueAccess } from "@/lib/tenant/active-policy";

const UPDATE_USER_FOR_LOGIN_SQL = `
  UPDATE users
  SET last_login_at = ?,
      password_hash = ?
  WHERE id = ?
    AND password_hash = ?
    AND session_version = ?
    AND active = 1
    AND deleted_at IS NULL
    AND (
      role = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM venues login_venue
        WHERE login_venue.id = users.venue_id
          AND login_venue.active = 1
      )
    )
  RETURNING session_version
`;

const CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND changes() = 1
`;

const SELECT_LATEST_SETUP_CODE_REQUEST_SQL = `
  SELECT status, setup_method, expires_at
  FROM password_reset_requests
  WHERE user_id = ?
    AND setup_method = 'setup_code'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`;

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
        { status: 403 },
      );
    }
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
    const credentialRateLimit = await consumeRateLimitOrDeny({
      namespace: "login",
      identifier: `${ip}:${normalizedEmail}`,
      limit: 5,
      windowSeconds: 60 * 15,
    });

    if (!credentialRateLimit.allowed) {
      return NextResponse.json(
        { code: "RATE_LIMITED", error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(credentialRateLimit.retryAfterSeconds),
          },
        }
      );
    }

    const db = drizzle(env.DB);
    const result = await db
      .select({ user: users, venueActive: venues.active })
      .from(users)
      .leftJoin(venues, eq(users.venueId, venues.id))
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    const user = result[0]?.user;
    const venueActive = result[0]?.venueActive;
    const tenant = await getTenantContextForRequest(request);

    const invalidCredentialsResponse = () => NextResponse.json(
      { code: "INVALID_CREDENTIALS", error: "Invalid email or password." },
      { status: 401 }
    );

    const userIsEligible = Boolean(
      tenant.resolved &&
      user &&
      user.active &&
      !user.deletedAt &&
      isRole(user.role) &&
      isAccountKind(user.accountKind) &&
      hasActiveVenueAccess({
        role: user.role,
        venueId: user.venueId,
        venueActive,
      }) &&
      !(
        tenant.scope === "venue" &&
        user.role !== "super_admin" &&
        user.venueId !== tenant.venueId
      ),
    );

    const nowIso = new Date().toISOString();
    const lookupUserId = userIsEligible && user ? user.id : crypto.randomUUID();
    const [latestSetupCodeRequest, passwordMatches] = await Promise.all([
      env.DB.prepare(SELECT_LATEST_SETUP_CODE_REQUEST_SQL)
        .bind(lookupUserId)
        .first<{
          status: string;
          setup_method: string | null;
          expires_at: string | null;
        }>(),
      verifyPassword(
        password,
        userIsEligible && user ? user.passwordHash : DUMMY_PASSWORD_HASH,
      ),
    ]);

    if (!userIsEligible || !user) return invalidCredentialsResponse();

    const isPendingSetup =
      user.migrationStatus === "pending_reset" && !user.passwordSetAt;

    if (isPendingSetup) {
      const isLegacySetup = !latestSetupCodeRequest;
      const hasUsableSetupCodeApproval =
        latestSetupCodeRequest?.status === "approved" &&
        latestSetupCodeRequest.setup_method === "setup_code" &&
        typeof latestSetupCodeRequest.expires_at === "string" &&
        latestSetupCodeRequest.expires_at > nowIso;
      if ((!isLegacySetup && !hasUsableSetupCodeApproval) || !passwordMatches) {
        return invalidCredentialsResponse();
      }
      return NextResponse.json(
        {
          error: "First-time password setup is required.",
          code: "PASSWORD_SETUP_REQUIRED",
          setupMethod: "setup_code",
        },
        { status: 409 },
      );
    }

    if (!passwordMatches) {
      return invalidCredentialsResponse();
    }

    if (!env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return NextResponse.json({ code: "SERVER_ERROR", error: "Unable to sign in right now." }, { status: 500 });
    }

    // 성공한 로그인 시각 기록 + bcrypt 해시 → PBKDF2 자동 재해시
    const nextPasswordHash = needsRehash(user.passwordHash)
      ? await hashPassword(password)
      : user.passwordHash;
    const [loginResult] = await env.DB.batch<{ session_version?: number }>([
      env.DB.prepare(UPDATE_USER_FOR_LOGIN_SQL).bind(
        nowIso,
        nextPasswordHash,
        user.id,
        user.passwordHash,
        user.sessionVersion ?? 0,
      ),
      env.DB.prepare(CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL).bind(
        nowIso,
        user.id,
      ),
    ]);
    const updatedSessionVersion = (
      loginResult.results?.[0] as { session_version?: number } | undefined
    )?.session_version;

    if (typeof updatedSessionVersion !== "number") {
      return invalidCredentialsResponse();
    }

    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({
      sub: user.id,
      email: user.email,
      role: user.role,
      venueId: user.venueId,
      sv: updatedSessionVersion,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(secret);

    const sessionId = crypto.randomUUID();
    await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({
      userId: user.id,
      sessionVersion: updatedSessionVersion,
    }), {
      expirationTtl: 60 * 60 * 24,
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        accountKind: user.accountKind,
        doorAccessEnabled: user.doorAccessEnabled,
        name: user.name,
        venueId: user.venueId ?? null,
        guestLimit: user.guestLimit ?? null,
        preferredLocale: isLocale(user.preferredLocale) ? user.preferredLocale : null,
      },
    });
    const secureCookies = shouldUseSecureAuthCookies(request);

    response.cookies.set({
      name: "token",
      value: token,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    response.cookies.set({
      name: "sessionId",
      value: sessionId,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    if (isLocale(user.preferredLocale)) {
      response.cookies.set({
        name: LOCALE_COOKIE_NAME,
        value: user.preferredLocale,
        sameSite: "lax",
        secure: secureCookies,
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
