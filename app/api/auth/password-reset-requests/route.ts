import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { consumeRateLimit, getRequestIp } from "@/lib/auth/rate-limit";
import {
  CANCEL_EXPIRED_ADMIN_APPROVED_RESET_REQUESTS_SQL,
  INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_SQL,
} from "@/lib/auth/password-reset-request-sql";
import { shouldCreatePasswordResetRequest } from "@/lib/auth/password-reset-request-policy";
import { getTenantContextForRequest } from "@/lib/tenant/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 공개 관리자 재설정 요청.
 * 계정 존재 여부와 기존 open request 여부를 같은 202 응답으로 숨긴다.
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const email =
      body && typeof body === "object" && "email" in body
        ? (body as { email?: unknown }).email
        : undefined;
    if (
      typeof email !== "string" ||
      !EMAIL_PATTERN.test(email.trim()) ||
      email.trim().length > 254
    ) {
      return NextResponse.json(
        { code: "INVALID_EMAIL", error: "Enter a valid email address." },
        { status: 400 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const rateLimit = await consumeRateLimit({
      namespace: "password-reset-request",
      identifier: `${getRequestIp(request)}:${normalizedEmail}`,
      limit: 3,
      windowSeconds: 60 * 60,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          code: "RATE_LIMITED",
          error: "Too many reset requests. Please try again later.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const tenant = await getTenantContextForRequest(request);
    if (!tenant.resolved) {
      return NextResponse.json(
        { code: "UNKNOWN_VENUE", error: "Unknown venue." },
        { status: 404 },
      );
    }

    const { env } = getCloudflareContext();
    const db = drizzle(env.DB);
    const [user] = await db
      .select({
        id: users.id,
        venueId: users.venueId,
        role: users.role,
        active: users.active,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (
      shouldCreatePasswordResetRequest({
        tenantResolved: tenant.resolved,
        tenantScope: tenant.scope,
        tenantVenueId: tenant.venueId,
        user,
      }) && user
    ) {
      const nowIso = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(CANCEL_EXPIRED_ADMIN_APPROVED_RESET_REQUESTS_SQL).bind(
          nowIso,
          user.id,
          nowIso,
        ),
        env.DB.prepare(INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_SQL).bind(
          crypto.randomUUID(),
          user.venueId,
          user.id,
          nowIso,
          nowIso,
        ),
      ]);
    }

    return NextResponse.json(
      {
        ok: true,
        message: "If the account can be managed here, an administrator will see the request.",
      },
      { status: 202 },
    );
  } catch (error: unknown) {
    console.error("Password reset administrator request error:", error);
    return NextResponse.json(
      { code: "REQUEST_FAILED", error: "Unable to submit the request right now." },
      { status: 500 },
    );
  }
}
