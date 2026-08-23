import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
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
  accountClaimPasswordDependencies,
  claimAccount,
  prepareAccountClaimPassword,
} from "@/lib/auth/account-claim-service";
import { createAccountClaimPersistence } from "@/lib/auth/account-claim-persistence";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

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
    const preparedPassword = prepareAccountClaimPassword(input.newPassword);

    if (
      preparedPassword.status === "missing" ||
      (!useBrowserReceipt && !email)
    ) {
      return NextResponse.json(
        { code: "MISSING_SETUP_FIELDS", error: "Email and a new password are required." },
        { status: 400 },
      );
    }

    if (preparedPassword.status === "policy_error") {
      return NextResponse.json(
        {
          code: preparedPassword.code,
          error:
            preparedPassword.code === "PASSWORD_TOO_SHORT"
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

    const result = await claimAccount(
      {
        useBrowserReceipt,
        email,
        setupCode,
        newPassword: preparedPassword.password,
        receiptRequestId,
        claimGrantExpiresAt: claimGrant?.expiresAt ?? null,
        nowIso,
        expectedVenueId,
      },
      {
        persistence: createAccountClaimPersistence(env.DB),
        ...accountClaimPasswordDependencies,
        createOperationId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      },
    );
    if (result.status === "not_eligible") {
      return NextResponse.json(
        {
          code: "ACCOUNT_NOT_ELIGIBLE",
          error: "The administrator approval or setup code is invalid, expired, or already used.",
        },
        { status: 400 },
      );
    }

    if (result.status === "grant_expired") {
      return NextResponse.json(
        {
          code: "ACCOUNT_NOT_ELIGIBLE",
          error: "The administrator approval has expired.",
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
        signedReceiptRequestId === result.requestId)
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
      actorId: result.userId,
      venueId: result.venueId,
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
