import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  derivePasswordResetChallenge,
  getPasswordResetReceiptState,
  getPasswordResetReceiptRequestId,
  type PasswordResetReceiptStatusRecord,
} from "@/lib/auth/password-reset-receipt";
import {
  consumeRateLimitOrDeny,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import { getTenantContextForRequest } from "@/lib/tenant/server";

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

/**
 * 서명된 browser receipt가 가리키는 exact request의 direct 승인만 공개한다.
 * receipt 부재, decoy, tenant 불일치, 거절 및 만료는 모두 같은 waiting 응답이다.
 */
export async function GET(request: Request) {
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
        { status: 403, headers: STATUS_RESPONSE_HEADERS },
      );
    }
    const { env } = getCloudflareContext();
    if (!env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return NextResponse.json(
        { code: "SERVER_ERROR", error: "Unable to check the request right now." },
        { status: 500, headers: STATUS_RESPONSE_HEADERS },
      );
    }

    const requestId = await getPasswordResetReceiptRequestId(
      request.headers,
      env.JWT_SECRET,
    );
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
    const state = getPasswordResetReceiptState(row, tenant);

    return NextResponse.json(
      { ...state, challenge },
      { status: 200, headers: STATUS_RESPONSE_HEADERS },
    );
  } catch {
    // Receipt와 expected challenge는 로그에 포함하지 않는다.
    console.error("Password reset request status failed");
    return NextResponse.json(
      { code: "SERVER_ERROR", error: "Unable to check the request right now." },
      { status: 500, headers: STATUS_RESPONSE_HEADERS },
    );
  }
}
