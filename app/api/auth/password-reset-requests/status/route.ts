import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  getPasswordResetClaimCookieOptions,
  getPasswordResetClaimGrantRecord,
  getPasswordResetReceiptCookieOptions,
  getPasswordResetReceiptRequestId,
  PASSWORD_RESET_CLAIM_COOKIE_NAME,
  PASSWORD_RESET_RECEIPT_COOKIE_NAME,
} from "@/lib/auth/password-reset-receipt";
import {
  getPublicPasswordResetStatus,
} from "@/lib/auth/password-reset-public-service";
import { createPasswordResetPublicPersistence } from "@/lib/auth/password-reset-public-persistence";
import {
  consumeRateLimitOrDeny,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

const STATUS_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

/**
 * 서명된 browser receipt가 가리키는 exact request의 direct 승인만 공개한다.
 * receipt 부재, decoy, tenant 불일치, 거절 및 만료는 모두 같은 waiting 응답이다.
 */
export async function GET(request: Request) {
  const correlationId = getRequestId(request);
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
        { status: 403, headers: STATUS_RESPONSE_HEADERS },
      );
    }
    const { env } = getCloudflareContext();
    if (!env.JWT_SECRET) {
      await writeStructuredLog("error", {
        event: "auth.password_reset_status",
        requestId: correlationId,
        outcome: "unavailable",
        errorKind: "MissingConfiguration",
      });
      return NextResponse.json(
        { code: "SERVER_ERROR", error: "Unable to check the request right now." },
        { status: 500, headers: STATUS_RESPONSE_HEADERS },
      );
    }

    const [claimGrant, receiptRequestId] = await Promise.all([
      getPasswordResetClaimGrantRecord(request.headers, env.JWT_SECRET),
      getPasswordResetReceiptRequestId(request.headers, env.JWT_SECRET),
    ]);
    const requestId = claimGrant?.requestId ?? receiptRequestId;
    if (!requestId) return waitingResponse();

    const requestIp = getRequestIp(request);
    const receiptRateLimit = await consumeRateLimitOrDeny({
      namespace: "password-reset-status",
      identifier: `${requestIp}:${requestId}`,
      limit: 240,
      windowSeconds: 30 * 60,
    });
    if (!receiptRateLimit.allowed) {
      return NextResponse.json(
        { code: "RATE_LIMITED", error: "Too many status checks." },
        {
          status: 429,
          headers: {
            ...STATUS_RESPONSE_HEADERS,
            "Retry-After": String(receiptRateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const tenant = await getTenantContextForRequest(request);
    const status = await getPublicPasswordResetStatus(
      { receiptRequestId, claimGrant, secret: env.JWT_SECRET, tenant },
      { persistence: createPasswordResetPublicPersistence(env.DB) },
    );
    const response = NextResponse.json(
      {
        state: status.state,
        challenge: status.challenge,
        expiresAt: status.expiresAt,
      },
      { status: 200, headers: STATUS_RESPONSE_HEADERS },
    );
    const secureCookies = shouldUseSecureAuthCookies(request);
    if (status.shouldClearRecoveryCookies) {
      clearRecoveryCookies(response, secureCookies);
    } else if (status.claim) {
      response.cookies.set({
        name: PASSWORD_RESET_CLAIM_COOKIE_NAME,
        value: status.claim,
        ...getPasswordResetClaimCookieOptions(
          secureCookies,
          status.claimCookieMaxAge ?? undefined,
        ),
      });
      if (status.shouldClearReceiptCookie) {
        response.cookies.set({
          name: PASSWORD_RESET_RECEIPT_COOKIE_NAME,
          value: "",
          ...getPasswordResetReceiptCookieOptions(secureCookies),
          maxAge: 0,
        });
      }
    }
    return response;
  } catch (error: unknown) {
    // Receipt와 expected challenge는 로그에 포함하지 않는다.
    await reportServerError("auth.password_reset_status", error, {
      requestId: correlationId,
    });
    return NextResponse.json(
      { code: "SERVER_ERROR", error: "Unable to check the request right now." },
      { status: 500, headers: STATUS_RESPONSE_HEADERS },
    );
  }
}

function waitingResponse(challenge: string | null = null) {
  return NextResponse.json(
    { state: "waiting", challenge, expiresAt: null },
    { status: 200, headers: STATUS_RESPONSE_HEADERS },
  );
}

function clearRecoveryCookies(response: NextResponse, secureCookies: boolean) {
  response.cookies.set({
    name: PASSWORD_RESET_CLAIM_COOKIE_NAME,
    value: "",
    ...getPasswordResetClaimCookieOptions(secureCookies),
    maxAge: 0,
  });
  response.cookies.set({
    name: PASSWORD_RESET_RECEIPT_COOKIE_NAME,
    value: "",
    ...getPasswordResetReceiptCookieOptions(secureCookies),
    maxAge: 0,
  });
  return response;
}
