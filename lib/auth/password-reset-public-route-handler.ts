import { NextResponse } from "next/server";

import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "../observability/structured-log.ts";
import { shouldUseSecureAuthCookies } from "./cookie-policy.ts";
import type {
  PublicPasswordResetSubmission,
  PublicPasswordResetTenant,
} from "./password-reset-public-service.ts";
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PasswordResetPublicRouteEnvironment {
  JWT_SECRET?: string;
}

export interface PasswordResetPublicRouteHandlerDependencies<
  Environment extends PasswordResetPublicRouteEnvironment,
> {
  getEnvironment(): Environment;
  consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult>;
  getTenant(request: Request): Promise<PublicPasswordResetTenant>;
  getReceiptRequestId(headers: Headers, secret: string): Promise<string | null>;
  getClaimGrantRecord(
    headers: Headers,
    secret: string,
  ): Promise<PasswordResetClaimGrant | null>;
  submit(
    input: {
      email: string;
      headers: Headers;
      secret: string;
      tenant: PublicPasswordResetTenant;
    },
    environment: Environment,
  ): Promise<PublicPasswordResetSubmission>;
  cancel(
    input: {
      receiptRequestId: string | null;
      claimGrant: PasswordResetClaimGrant | null;
      tenant: PublicPasswordResetTenant;
    },
    environment: Environment,
  ): Promise<void>;
  getRequestId?: typeof getRequestId;
  reportServerError?: typeof reportServerError;
  writeStructuredLog?: typeof writeStructuredLog;
}

export function createPasswordResetPublicRouteHandlers<
  Environment extends PasswordResetPublicRouteEnvironment,
>(dependencies: PasswordResetPublicRouteHandlerDependencies<Environment>) {
  const identifyRequest = dependencies.getRequestId ?? getRequestId;
  const reportError = dependencies.reportServerError ?? reportServerError;
  const writeLog = dependencies.writeStructuredLog ?? writeStructuredLog;

  return {
    POST: async (request: Request) => {
      const correlationId = identifyRequest(request);
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
        const candidateRateLimit = await dependencies.consumeRateLimit({
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

        const tenant = await dependencies.getTenant(request);
        if (!tenant.resolved) {
          return NextResponse.json(
            { code: "UNKNOWN_VENUE", error: "Unknown venue." },
            { status: 404 },
          );
        }

        const environment = dependencies.getEnvironment();
        if (!environment.JWT_SECRET) {
          await writeLog("error", {
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

        const submission = await dependencies.submit(
          {
            email: normalizedEmail,
            headers: request.headers,
            secret: environment.JWT_SECRET,
            tenant,
          },
          environment,
        );
        if (submission.persistenceError) {
          await reportError(
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
        await writeLog("info", {
          event: "auth.password_reset_request",
          requestId: correlationId,
          venueId: tenant.venueId,
          outcome: "success",
        });
        return response;
      } catch (error: unknown) {
        // Receipt와 expected challenge는 로그에 포함하지 않는다.
        await reportError("auth.password_reset_request", error, {
          requestId: correlationId,
        });
        return NextResponse.json(
          { code: "REQUEST_FAILED", error: "Unable to submit the request right now." },
          { status: 500, headers: { "Cache-Control": "no-store" } },
        );
      }
    },

    DELETE: async (request: Request) => {
      const correlationId = identifyRequest(request);
      const response = new NextResponse(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });

      try {
        if (!isTrustedMutationOrigin(request)) return response;
        const environment = dependencies.getEnvironment();
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

        if (!environment.JWT_SECRET) return response;
        const [receiptRequestId, claimGrant, tenant] = await Promise.all([
          dependencies.getReceiptRequestId(request.headers, environment.JWT_SECRET),
          dependencies.getClaimGrantRecord(request.headers, environment.JWT_SECRET),
          dependencies.getTenant(request),
        ]);
        await dependencies.cancel(
          { receiptRequestId, claimGrant, tenant },
          environment,
        );
      } catch (error: unknown) {
        await reportError("auth.password_reset_request.cancel", error, {
          requestId: correlationId,
        });
      }

      return response;
    },
  };
}
