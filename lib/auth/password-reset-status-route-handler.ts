import { NextResponse } from "next/server";

import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "../observability/structured-log.ts";
import type { PublicPasswordResetTenant } from "./password-reset-public-service.ts";
import type { PublicPasswordResetStatus } from "./password-reset-public-service.ts";
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

const STATUS_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

interface PasswordResetStatusRouteEnvironment {
  JWT_SECRET?: string;
}

export interface PasswordResetStatusRouteHandlerDependencies<
  Environment extends PasswordResetStatusRouteEnvironment,
> {
  getEnvironment(): Environment;
  consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult>;
  getTenant(request: Request): Promise<PublicPasswordResetTenant>;
  getReceiptRequestId(headers: Headers, secret: string): Promise<string | null>;
  getClaimGrantRecord(
    headers: Headers,
    secret: string,
  ): Promise<PasswordResetClaimGrant | null>;
  getStatus(
    input: {
      receiptRequestId: string | null;
      claimGrant: PasswordResetClaimGrant | null;
      secret: string;
      tenant: PublicPasswordResetTenant;
    },
    environment: Environment,
  ): Promise<PublicPasswordResetStatus>;
  getRequestId?: typeof getRequestId;
  reportServerError?: typeof reportServerError;
  writeStructuredLog?: typeof writeStructuredLog;
}

export function createPasswordResetStatusGetHandler<
  Environment extends PasswordResetStatusRouteEnvironment,
>(dependencies: PasswordResetStatusRouteHandlerDependencies<Environment>) {
  const identifyRequest = dependencies.getRequestId ?? getRequestId;
  const reportError = dependencies.reportServerError ?? reportServerError;
  const writeLog = dependencies.writeStructuredLog ?? writeStructuredLog;

  return async function GET(request: Request) {
    const correlationId = identifyRequest(request);
    try {
      if (!isTrustedMutationOrigin(request)) {
        return NextResponse.json(
          { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
          { status: 403, headers: STATUS_RESPONSE_HEADERS },
        );
      }
      const environment = dependencies.getEnvironment();
      if (!environment.JWT_SECRET) {
        await writeLog("error", {
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
        dependencies.getClaimGrantRecord(request.headers, environment.JWT_SECRET),
        dependencies.getReceiptRequestId(request.headers, environment.JWT_SECRET),
      ]);
      const requestId = claimGrant?.requestId ?? receiptRequestId;
      if (!requestId) return waitingResponse();

      const requestIp = getRequestIp(request);
      const receiptRateLimit = await dependencies.consumeRateLimit({
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

      const tenant = await dependencies.getTenant(request);
      const status = await dependencies.getStatus(
        {
          receiptRequestId,
          claimGrant,
          secret: environment.JWT_SECRET,
          tenant,
        },
        environment,
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
      await reportError("auth.password_reset_status", error, {
        requestId: correlationId,
      });
      return NextResponse.json(
        { code: "SERVER_ERROR", error: "Unable to check the request right now." },
        { status: 500, headers: STATUS_RESPONSE_HEADERS },
      );
    }
  };
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
