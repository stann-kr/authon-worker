import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  consumeRateLimitOrDeny,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import {
  getPasswordResetClaimCookieOptions,
  getPasswordResetClaimGrantRecord,
  getPasswordResetReceiptCookieOptions,
  getPasswordResetReceiptRequestId,
  PASSWORD_RESET_CLAIM_COOKIE_NAME,
  PASSWORD_RESET_RECEIPT_COOKIE_NAME,
} from "@/lib/auth/password-reset-receipt";
import {
  cancelPublicPasswordResetRequest,
  submitPublicPasswordResetRequest,
} from "@/lib/auth/password-reset-public-service";
import { createPasswordResetPublicPersistence } from "@/lib/auth/password-reset-public-persistence";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 공개 관리자 재설정 요청.
 * 계정 존재 여부와 기존 open request 여부를 같은 202 응답으로 숨긴다.
 */
export async function POST(request: Request) {
  const correlationId = getRequestId(request);
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
          headers: { "Retry-After": String(candidateRateLimit.retryAfterSeconds) },
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
      await writeStructuredLog("error", {
        event: "auth.password_reset_request",
        requestId: correlationId,
        venueId: tenant.venueId,
        outcome: "unavailable",
        errorKind: "MissingConfiguration",
      });
      return NextResponse.json(
        { code: "SERVER_ERROR", error: "Unable to submit the request right now." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    const submission = await submitPublicPasswordResetRequest(
      {
        email: normalizedEmail,
        headers: request.headers,
        secret: env.JWT_SECRET,
        tenant,
      },
      { persistence: createPasswordResetPublicPersistence(env.DB) },
    );
    if (submission.persistenceError) {
      await reportServerError(
        "auth.password_reset_request.persist",
        submission.persistenceError,
        { requestId: correlationId, venueId: tenant.venueId },
      );
    }

    const response = NextResponse.json(
      {
        ok: true,
        message: "If the account can be managed here, an administrator will see the request.",
        challenge: submission.challenge,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set({
      name: PASSWORD_RESET_RECEIPT_COOKIE_NAME,
      value: submission.receipt,
      ...getPasswordResetReceiptCookieOptions(
        shouldUseSecureAuthCookies(request),
      ),
    });
    await writeStructuredLog("info", {
      event: "auth.password_reset_request",
      requestId: correlationId,
      venueId: tenant.venueId,
      outcome: "success",
    });
    return response;
  } catch (error: unknown) {
    // Receipt와 expected challenge는 로그에 포함하지 않는다.
    await reportServerError("auth.password_reset_request", error, {
      requestId: correlationId,
    });
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
  const correlationId = getRequestId(request);
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
    await cancelPublicPasswordResetRequest(
      { receiptRequestId, claimGrant, tenant },
      { persistence: createPasswordResetPublicPersistence(env.DB) },
    );
  } catch (error: unknown) {
    await reportServerError("auth.password_reset_request.cancel", error, {
      requestId: correlationId,
    });
  }

  return response;
}
