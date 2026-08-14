import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  createPasswordResetClaimGrant,
  derivePasswordResetChallenge,
  getPasswordResetClaimCookieOptions,
  getPasswordResetClaimGrantRecord,
  getPasswordResetReceiptState,
  getPasswordResetReceiptRequestId,
  PASSWORD_RESET_CLAIM_COOKIE_NAME,
  PASSWORD_RESET_CLAIM_MAX_AGE_SECONDS,
  PASSWORD_RESET_RECEIPT_COOKIE_NAME,
  getPasswordResetReceiptCookieOptions,
  type PasswordResetReceiptStatusRecord,
} from "@/lib/auth/password-reset-receipt";
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

function waitingResponse(challenge: string | null = null) {
  return NextResponse.json(
    { state: "waiting", challenge, expiresAt: null },
    { status: 200, headers: STATUS_RESPONSE_HEADERS },
  );
}

function expiredResponse() {
  return NextResponse.json(
    { state: "expired", challenge: null, expiresAt: null },
    { status: 200, headers: STATUS_RESPONSE_HEADERS },
  );
}

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

    const nowMs = Date.now();
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

    const challenge = await derivePasswordResetChallenge(
      requestId,
      env.JWT_SECRET,
    );
    const tenant = await getTenantContextForRequest(request);
    if (!tenant.resolved) return waitingResponse(challenge);

    const row = await env.DB.prepare(
      `SELECT pr.venue_id AS venueId,
              u.role AS userRole,
              pr.status AS status,
              pr.setup_method AS setupMethod,
              pr.expires_at AS expiresAt
       FROM password_reset_requests pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.id = ?
         AND pr.source = 'self_service'
         AND pr.venue_id IS u.venue_id
         AND u.active = 1
         AND u.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM venues request_venue
           WHERE request_venue.id = u.venue_id
             AND request_venue.active = 1
         )
         AND u.account_kind = 'personal'
         AND u.role IN ('door_staff', 'staff', 'dj')
         AND EXISTS (
           SELECT 1
           FROM users reset_actor
           WHERE reset_actor.id = pr.decided_by_user_id
             AND reset_actor.active = 1
             AND reset_actor.deleted_at IS NULL
             AND reset_actor.id <> u.id
             AND (
               reset_actor.role = 'super_admin'
               OR (
                 reset_actor.role = 'venue_admin'
                 AND reset_actor.venue_id IS NOT NULL
                 AND reset_actor.venue_id = u.venue_id
                 AND u.role IN ('door_staff', 'staff', 'dj')
               )
             )
         )
       LIMIT 1`,
    )
      .bind(requestId)
      .first<PasswordResetReceiptStatusRecord>();
    const state = getPasswordResetReceiptState(row, tenant, nowMs);

    const secureCookies = shouldUseSecureAuthCookies(request);
    const clearRecoveryCookies = (response: NextResponse) => {
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
    };

    if (claimGrant && Date.parse(claimGrant.expiresAt) <= nowMs) {
      await env.DB.prepare(
        `UPDATE password_reset_requests
         SET status = 'cancelled',
             updated_at = ?
         WHERE id = ?
           AND source = 'self_service'
           AND status = 'approved'
           AND setup_method = 'admin_approved'`,
      )
        .bind(new Date(nowMs).toISOString(), requestId)
        .run();
      return clearRecoveryCookies(expiredResponse());
    }

    if (state.state !== "approved") {
      if (claimGrant) return clearRecoveryCookies(expiredResponse());
      return NextResponse.json(
        { ...state, challenge },
        { status: 200, headers: STATUS_RESPONSE_HEADERS },
      );
    }

    if (claimGrant?.requestId === requestId) {
      const expiresAt = new Date(
        Math.min(Date.parse(claimGrant.expiresAt), Date.parse(state.expiresAt)),
      ).toISOString();
      return NextResponse.json(
        { state: "approved", challenge, expiresAt },
        { status: 200, headers: STATUS_RESPONSE_HEADERS },
      );
    }

    const databaseExpiryMs = Date.parse(state.expiresAt);
    const claimExpiresAtMs = Math.min(
      nowMs + PASSWORD_RESET_CLAIM_MAX_AGE_SECONDS * 1000,
      databaseExpiryMs,
    );
    if (claimExpiresAtMs <= nowMs + 1000) {
      await env.DB.prepare(
        `UPDATE password_reset_requests
         SET status = 'cancelled',
             updated_at = ?
         WHERE id = ?
           AND source = 'self_service'
           AND status = 'approved'
           AND setup_method = 'admin_approved'`,
      )
        .bind(new Date(nowMs).toISOString(), requestId)
        .run();
      return clearRecoveryCookies(expiredResponse());
    }
    const claim = await createPasswordResetClaimGrant(
      requestId,
      claimExpiresAtMs,
      env.JWT_SECRET,
    );
    const response = NextResponse.json(
      {
        state: "approved",
        challenge,
        expiresAt: new Date(claimExpiresAtMs).toISOString(),
      },
      { status: 200, headers: STATUS_RESPONSE_HEADERS },
    );
    response.cookies.set({
      name: PASSWORD_RESET_CLAIM_COOKIE_NAME,
      value: claim,
      ...getPasswordResetClaimCookieOptions(
        secureCookies,
        Math.max(1, Math.ceil((databaseExpiryMs - nowMs) / 1000)),
      ),
    });
    response.cookies.set({
      name: PASSWORD_RESET_RECEIPT_COOKIE_NAME,
      value: "",
      ...getPasswordResetReceiptCookieOptions(secureCookies),
      maxAge: 0,
    });

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
