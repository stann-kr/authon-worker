import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import {
  consumeRateLimitOrDeny,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import {
  createPasswordResetReceipt,
  derivePasswordResetChallenge,
  getPasswordResetClaimCookieOptions,
  getPasswordResetClaimGrantRecord,
  getPasswordResetReceiptCookieOptions,
  getPasswordResetReceiptRequestId,
  getPasswordResetReceiptRequestIdForCandidate,
  getPasswordResetRequestExpiry,
  PASSWORD_RESET_RECEIPT_COOKIE_NAME,
  PASSWORD_RESET_CLAIM_COOKIE_NAME,
} from "@/lib/auth/password-reset-receipt";
import { shouldCreatePasswordResetRequest } from "@/lib/auth/password-reset-request-policy";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import {
  CANCEL_EXPIRED_OPEN_PASSWORD_RESET_REQUESTS_SQL,
  INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_WITH_EXPIRY_SQL,
  SELECT_EXISTING_BROWSER_PASSWORD_RESET_REQUEST_SQL,
} from "@/lib/auth/password-reset-request-sql";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 공개 관리자 재설정 요청.
 * 계정 존재 여부와 기존 open request 여부를 같은 202 응답으로 숨긴다.
 */
export async function POST(request: Request) {
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
        { status: 403 },
      );
    }
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
    const requestIp = getRequestIp(request);
    const candidateRateLimit = await consumeRateLimitOrDeny({
      namespace: "password-reset-request",
      identifier: `${requestIp}:${normalizedEmail}`,
      limit: 3,
      windowSeconds: 60 * 60,
    });
    if (!candidateRateLimit.allowed) {
      return NextResponse.json(
        {
          code: "RATE_LIMITED",
          error: "Too many reset requests. Please try again later.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(candidateRateLimit.retryAfterSeconds),
          },
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
    if (!env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return NextResponse.json(
        { code: "SERVER_ERROR", error: "Unable to submit the request right now." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

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

    const eligibleUserId =
      shouldCreatePasswordResetRequest({
        tenantResolved: tenant.resolved,
        tenantScope: tenant.scope,
        tenantVenueId: tenant.venueId,
        user,
      }) && user
        ? user.id
        : crypto.randomUUID();
    const existingReceiptRequestId = await getPasswordResetReceiptRequestIdForCandidate(
      request.headers,
      normalizedEmail,
      env.JWT_SECRET,
    );
    const nowIso = new Date().toISOString();
    const requestId = existingReceiptRequestId ?? crypto.randomUUID();
    let receiptRequestId = requestId;
    const expiresAt = getPasswordResetRequestExpiry(Date.parse(nowIso));
    try {
      const [, insertResult, existingResult] = await env.DB.batch<{ id: string }>([
        env.DB.prepare(CANCEL_EXPIRED_OPEN_PASSWORD_RESET_REQUESTS_SQL).bind(
          nowIso,
          eligibleUserId,
          nowIso,
        ),
        env.DB.prepare(
          INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_WITH_EXPIRY_SQL,
        ).bind(
          requestId,
          expiresAt,
          nowIso,
          nowIso,
          eligibleUserId,
          tenant.scope,
          tenant.venueId,
        ),
        env.DB.prepare(
          SELECT_EXISTING_BROWSER_PASSWORD_RESET_REQUEST_SQL,
        ).bind(
          existingReceiptRequestId ?? crypto.randomUUID(),
          eligibleUserId,
          nowIso,
          tenant.scope,
          tenant.venueId,
        ),
      ]);

      const insertedId = (
        insertResult.results?.[0] as { id?: string } | undefined
      )?.id ?? null;
      const existingId = (
        existingResult.results?.[0] as { id?: string } | undefined
      )?.id ?? null;
      if (insertedId === requestId) {
        receiptRequestId = requestId;
      } else if (
        existingReceiptRequestId &&
        existingId === existingReceiptRequestId
      ) {
        receiptRequestId = existingReceiptRequestId;
      }
    } catch (error: unknown) {
      // 계정 존재 여부에 따라 write 실패 응답이 달라지지 않게 decoy
      // receipt와 공통 202를 유지한다. 원문 이메일은 로그에 남기지 않는다.
      console.error("Password reset request persistence failed:", error);
    }
    const [receipt, challenge] = await Promise.all([
      createPasswordResetReceipt(
        receiptRequestId,
        env.JWT_SECRET,
        normalizedEmail,
      ),
      derivePasswordResetChallenge(receiptRequestId, env.JWT_SECRET),
    ]);
    const response = NextResponse.json(
      {
        ok: true,
        message: "If the account can be managed here, an administrator will see the request.",
        challenge,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set({
      name: PASSWORD_RESET_RECEIPT_COOKIE_NAME,
      value: receipt,
      ...getPasswordResetReceiptCookieOptions(
        shouldUseSecureAuthCookies(request),
      ),
    });
    return response;
  } catch {
    // Receipt와 expected challenge는 로그에 포함하지 않는다.
    console.error("Password reset administrator request failed");
    return NextResponse.json(
      { code: "REQUEST_FAILED", error: "Unable to submit the request right now." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/**
 * 현재 browser receipt의 요청을 포기하고 cookie를 제거한다. receipt가
 * 없거나 유효하지 않아도 같은 204를 반환한다.
 */
export async function DELETE(request: Request) {
  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });

  try {
    if (!isTrustedMutationOrigin(request)) return response;
    const { env } = getCloudflareContext();
    const secureCookies = shouldUseSecureAuthCookies(request);
    response.cookies.set({
      name: PASSWORD_RESET_RECEIPT_COOKIE_NAME,
      value: "",
      ...getPasswordResetReceiptCookieOptions(secureCookies),
      maxAge: 0,
    });
    response.cookies.set({
      name: PASSWORD_RESET_CLAIM_COOKIE_NAME,
      value: "",
      ...getPasswordResetClaimCookieOptions(secureCookies),
      maxAge: 0,
    });

    if (!env.JWT_SECRET) return response;
    const [receiptRequestId, claimGrant, tenant] = await Promise.all([
      getPasswordResetReceiptRequestId(request.headers, env.JWT_SECRET),
      getPasswordResetClaimGrantRecord(request.headers, env.JWT_SECRET),
      getTenantContextForRequest(request),
    ]);
    const requestId = claimGrant?.requestId ?? receiptRequestId;
    if (!requestId || !tenant.resolved) return response;

    await env.DB.prepare(
      `UPDATE password_reset_requests
       SET status = 'cancelled',
           updated_at = ?
       WHERE id = ?
         AND source = 'self_service'
         AND status IN ('pending', 'approved')
         AND (
           ? = 'platform'
           OR venue_id = ?
         )`,
    )
      .bind(new Date().toISOString(), requestId, tenant.scope, tenant.venueId)
      .run();
  } catch (error: unknown) {
    console.error("Password reset request cancellation failed:", error);
  }

  return response;
}
