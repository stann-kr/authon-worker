import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { getPasswordPolicyErrorCode } from "@/lib/auth/password-policy";
import {
  consumeRateLimitOrDeny,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import {
  getPasswordResetClaimCookieOptions,
  getPasswordResetClaimGrant,
  getPasswordResetReceiptCookieOptions,
  getPasswordResetReceiptRequestId,
  PASSWORD_RESET_CLAIM_COOKIE_NAME,
  PASSWORD_RESET_RECEIPT_COOKIE_NAME,
} from "@/lib/auth/password-reset-receipt";
import {
  CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL,
  COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL,
  INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL,
  INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL,
  UPDATE_USER_WITH_APPROVED_RESET_SQL,
} from "@/lib/auth/password-reset-lifecycle-sql";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

interface ClaimCandidate {
  id: string;
  venue_id: string | null;
  password_hash: string;
  session_version: number;
  migration_status: string;
  password_set_at: string | null;
  request_id: string | null;
  setup_method: "setup_code" | "admin_approved" | null;
  has_setup_code_history: number;
}

/**
 * Browser-bound 관리자 승인 또는 유효한 1회용 설정 코드를 원자적으로 소비한다.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
        { status: 403 },
      );
    }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { code: "MISSING_SETUP_FIELDS", error: "A new password is required." },
        { status: 400 },
      );
    }

    const input = body as {
      email?: unknown;
      setupCode?: unknown;
      newPassword?: unknown;
      recoveryReceipt?: unknown;
    };
    const useBrowserReceipt = input.recoveryReceipt === true;
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const setupCode = typeof input.setupCode === "string" ? input.setupCode : "";
    const newPassword = input.newPassword;

    if (
      typeof newPassword !== "string" ||
      (!useBrowserReceipt && !email)
    ) {
      return NextResponse.json(
        { code: "MISSING_SETUP_FIELDS", error: "Email and a new password are required." },
        { status: 400 },
      );
    }

    const passwordPolicyErrorCode = getPasswordPolicyErrorCode(newPassword);
    if (passwordPolicyErrorCode) {
      return NextResponse.json(
        {
          code: passwordPolicyErrorCode,
          error:
            passwordPolicyErrorCode === "PASSWORD_TOO_SHORT"
              ? "Password must be at least 8 characters."
              : "Password must include both letters and numbers.",
        },
        { status: 400 },
      );
    }

    const { env } = getCloudflareContext();
    if (useBrowserReceipt && !env.JWT_SECRET) {
      await writeStructuredLog("error", {
        event: "auth.account_claim",
        requestId,
        outcome: "unavailable",
        errorKind: "MissingConfiguration",
      });
      return NextResponse.json(
        { code: "SERVER_ERROR", error: "Unable to complete account setup right now." },
        { status: 500 },
      );
    }

    const [signedReceiptRequestId, claimGrant] = env.JWT_SECRET
      ? await Promise.all([
          getPasswordResetReceiptRequestId(request.headers, env.JWT_SECRET),
          getPasswordResetClaimGrant(request.headers, env.JWT_SECRET),
        ])
      : [null, null];
    const receiptRequestId = useBrowserReceipt ? claimGrant?.requestId ?? null : null;
    const requestIp = getRequestIp(request);
    const rateLimitIdentifier = useBrowserReceipt
      ? `${requestIp}:receipt:${receiptRequestId ?? "invalid"}`
      : `${requestIp}:${email}`;
    const rateLimit = await consumeRateLimitOrDeny({
      namespace: "claim-account",
      identifier: rateLimitIdentifier,
      limit: 5,
      windowSeconds: 60 * 15,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { code: "RATE_LIMITED", error: "Too many setup attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const nowIso = new Date().toISOString();
    const tenant = await getTenantContextForRequest(request);
    const expectedVenueId = tenant.scope === "venue" ? tenant.venueId : null;
    if (!tenant.resolved) {
      return NextResponse.json(
        { code: "UNKNOWN_VENUE", error: "Unknown venue." },
        { status: 404 },
      );
    }

    let candidate: ClaimCandidate | null = null;
    if (useBrowserReceipt && receiptRequestId) {
      candidate = await env.DB.prepare(
        `SELECT u.id,
                u.venue_id,
                u.password_hash,
                u.session_version,
                u.migration_status,
                u.password_set_at,
                pr.id AS request_id,
                pr.setup_method,
                1 AS has_setup_code_history
         FROM password_reset_requests pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.id = ?
           AND pr.source = 'self_service'
           AND pr.status = 'approved'
           AND pr.setup_method = 'admin_approved'
           AND pr.expires_at > ?
           AND pr.venue_id IS u.venue_id
           AND u.active = 1
           AND u.deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM venues candidate_venue
             WHERE candidate_venue.id = u.venue_id
               AND candidate_venue.active = 1
           )
           AND u.account_kind = 'personal'
           AND u.role IN ('door_staff', 'staff', 'dj')
           AND (? IS NULL OR u.venue_id = ? OR u.role = 'super_admin')
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
        .bind(receiptRequestId, nowIso, expectedVenueId, expectedVenueId)
        .first<ClaimCandidate>();
    } else if (!useBrowserReceipt) {
      candidate = await env.DB.prepare(
        `SELECT u.id,
                u.venue_id,
                u.password_hash,
                u.session_version,
                u.migration_status,
                u.password_set_at,
                (
                  SELECT pr.id
                  FROM password_reset_requests pr
                  WHERE pr.user_id = u.id
                    AND pr.status = 'approved'
                    AND pr.setup_method = 'setup_code'
                    AND pr.expires_at > ?
                    AND pr.venue_id IS u.venue_id
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
                  ORDER BY pr.decided_at DESC, pr.id DESC
                  LIMIT 1
                ) AS request_id,
                'setup_code' AS setup_method,
                EXISTS (
                  SELECT 1 FROM password_reset_requests history
                  WHERE history.user_id = u.id
                    AND history.setup_method = 'setup_code'
                ) AS has_setup_code_history
         FROM users u
         WHERE u.email = ?
           AND u.active = 1
           AND u.deleted_at IS NULL
           AND (
             u.role = 'super_admin'
             OR EXISTS (
               SELECT 1 FROM venues candidate_venue
               WHERE candidate_venue.id = u.venue_id
                 AND candidate_venue.active = 1
             )
           )
           AND u.migration_status = 'pending_reset'
           AND u.password_set_at IS NULL
           AND (? IS NULL OR u.venue_id = ? OR u.role = 'super_admin')
         LIMIT 1`,
      )
        .bind(nowIso, email, expectedVenueId, expectedVenueId)
        .first<ClaimCandidate>();
    }

    const isLegacySetup =
      !useBrowserReceipt &&
      candidate !== null &&
      !candidate.request_id &&
      candidate.has_setup_code_history === 0;
    const setupCodeMatches = !useBrowserReceipt
      ? await verifyPassword(
          setupCode,
          candidate && (Boolean(candidate.request_id) || isLegacySetup)
            ? candidate.password_hash
            : DUMMY_PASSWORD_HASH,
        )
      : false;

    if (
      !candidate ||
      (useBrowserReceipt && !candidate.request_id) ||
      (!useBrowserReceipt && !setupCodeMatches)
    ) {
      return NextResponse.json(
        {
          code: "ACCOUNT_NOT_ELIGIBLE",
          error: "The administrator approval or setup code is invalid, expired, or already used.",
        },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(newPassword);
    const credentialChangedAt = new Date().toISOString();
    if (
      useBrowserReceipt &&
      (!claimGrant || claimGrant.expiresAt <= credentialChangedAt)
    ) {
      return NextResponse.json(
        {
          code: "ACCOUNT_NOT_ELIGIBLE",
          error: "The administrator approval has expired.",
        },
        { status: 400 },
      );
    }
    const operationId = crypto.randomUUID();
    const claimMethod = useBrowserReceipt
      ? "browser_receipt"
      : isLegacySetup
        ? "legacy_setup_code"
        : "manual_setup_code";
    const exactRequestId = candidate.request_id ?? "";

    const [userResult] = await env.DB.batch<{ id?: string }>([
      env.DB.prepare(
        UPDATE_USER_WITH_APPROVED_RESET_SQL,
      ).bind(
        passwordHash,
        credentialChangedAt,
        candidate.id,
        candidate.password_hash,
        candidate.session_version,
        expectedVenueId,
        expectedVenueId,
        claimMethod,
        claimMethod,
        exactRequestId,
        candidate.setup_method ?? "setup_code",
        credentialChangedAt,
      ),
      env.DB.prepare(
        INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL,
      ).bind(
        operationId,
        JSON.stringify({ method: claimMethod, requestId: candidate.request_id }),
        credentialChangedAt,
        candidate.id,
      ),
      env.DB.prepare(
        COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL,
      ).bind(
        credentialChangedAt,
        credentialChangedAt,
        exactRequestId,
        operationId,
      ),
      env.DB.prepare(
        INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL,
      ).bind(candidate.id, operationId),
      env.DB.prepare(
        CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL,
      ).bind(credentialChangedAt, candidate.id, exactRequestId, operationId),
    ]);

    const claimedUserId = (
      userResult.results?.[0] as { id?: string } | undefined
    )?.id;
    if (!claimedUserId) {
      return NextResponse.json(
        {
          code: "ACCOUNT_NOT_ELIGIBLE",
          error: "This account is not eligible for setup. Contact an administrator.",
        },
        { status: 400 },
      );
    }

    const response = NextResponse.json({
      ok: true,
      message: "Your password has been set.",
    });
    if (useBrowserReceipt) {
      const secureCookies = shouldUseSecureAuthCookies(request);
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
    } else if (
      (signedReceiptRequestId !== null &&
        signedReceiptRequestId === candidate.request_id)
    ) {
      response.cookies.set({
        name: PASSWORD_RESET_RECEIPT_COOKIE_NAME,
        value: "",
        ...getPasswordResetReceiptCookieOptions(
          shouldUseSecureAuthCookies(request),
        ),
        maxAge: 0,
      });
    }
    await writeStructuredLog("info", {
      event: "auth.account_claim",
      requestId,
      actorId: candidate.id,
      venueId: candidate.venue_id,
      outcome: "success",
    });
    return response;
  } catch (error: unknown) {
    await reportServerError("auth.account_claim", error, { requestId });
    return NextResponse.json(
      { code: "SERVER_ERROR", error: "Unable to complete account setup right now." },
      { status: 500 },
    );
  }
}
