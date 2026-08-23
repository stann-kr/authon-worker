import { NextResponse } from "next/server";

import type { TenantContext } from "../tenant/types.ts";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "../observability/structured-log.ts";
import type {
  AccountClaimResult,
  ClaimAccountInput,
} from "./account-claim-service.ts";
import { prepareAccountClaimPassword } from "./account-claim-service.ts";
import { shouldUseSecureAuthCookies } from "./cookie-policy.ts";
import {
  getPasswordResetClaimCookieOptions,
  getPasswordResetReceiptCookieOptions,
  PASSWORD_RESET_CLAIM_COOKIE_NAME,
  PASSWORD_RESET_RECEIPT_COOKIE_NAME,
  type PasswordResetClaimGrant,
} from "./password-reset-receipt.ts";
import { isTrustedMutationOrigin } from "./request-origin.ts";
import {
  getRequestIp,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rate-limit.ts";

interface AccountClaimRouteEnvironment {
  JWT_SECRET?: string;
}

export interface AccountClaimRouteHandlerDependencies<
  Environment extends AccountClaimRouteEnvironment,
> {
  getEnvironment(): Environment;
  consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult>;
  getTenant(
    request: Request,
  ): Promise<Pick<TenantContext, "resolved" | "scope" | "venueId">>;
  getReceiptRequestId(headers: Headers, secret: string): Promise<string | null>;
  getClaimGrant(
    headers: Headers,
    secret: string,
  ): Promise<PasswordResetClaimGrant | null>;
  claim(input: ClaimAccountInput, environment: Environment): Promise<AccountClaimResult>;
  now?: () => Date;
  getRequestId?: typeof getRequestId;
  reportServerError?: typeof reportServerError;
  writeStructuredLog?: typeof writeStructuredLog;
}

export function createAccountClaimPostHandler<
  Environment extends AccountClaimRouteEnvironment,
>(dependencies: AccountClaimRouteHandlerDependencies<Environment>) {
  const identifyRequest = dependencies.getRequestId ?? getRequestId;
  const reportError = dependencies.reportServerError ?? reportServerError;
  const writeLog = dependencies.writeStructuredLog ?? writeStructuredLog;

  return async function POST(request: Request) {
    const requestId = identifyRequest(request);
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

      const environment = dependencies.getEnvironment();
      if (useBrowserReceipt && !environment.JWT_SECRET) {
        await writeLog("error", {
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

      const [signedReceiptRequestId, claimGrant] = environment.JWT_SECRET
        ? await Promise.all([
            dependencies.getReceiptRequestId(request.headers, environment.JWT_SECRET),
            dependencies.getClaimGrant(request.headers, environment.JWT_SECRET),
          ])
        : [null, null];
      const receiptRequestId = useBrowserReceipt ? claimGrant?.requestId ?? null : null;
      const requestIp = getRequestIp(request);
      const rateLimitIdentifier = useBrowserReceipt
        ? `${requestIp}:receipt:${receiptRequestId ?? "invalid"}`
        : `${requestIp}:${email}`;
      const rateLimit = await dependencies.consumeRateLimit({
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

      const nowIso = (dependencies.now?.() ?? new Date()).toISOString();
      const tenant = await dependencies.getTenant(request);
      const expectedVenueId = tenant.scope === "venue" ? tenant.venueId : null;
      if (!tenant.resolved) {
        return NextResponse.json(
          { code: "UNKNOWN_VENUE", error: "Unknown venue." },
          { status: 404 },
        );
      }

      const result = await dependencies.claim(
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
        environment,
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
        signedReceiptRequestId !== null &&
        signedReceiptRequestId === result.requestId
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
      await writeLog("info", {
        event: "auth.account_claim",
        requestId,
        actorId: result.userId,
        venueId: result.venueId,
        outcome: "success",
      });
      return response;
    } catch (error: unknown) {
      await reportError("auth.account_claim", error, { requestId });
      return NextResponse.json(
        { code: "SERVER_ERROR", error: "Unable to complete account setup right now." },
        { status: 500 },
      );
    }
  };
}
