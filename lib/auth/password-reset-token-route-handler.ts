import { NextResponse } from "next/server";

import type { TenantContext } from "../tenant/types.ts";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "../observability/structured-log.ts";
import {
  prepareTokenPasswordReset,
  type TokenPasswordResetResult,
} from "./password-reset-token-service.ts";
import { isTrustedMutationOrigin } from "./request-origin.ts";
import {
  getRequestIp,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rate-limit.ts";

export interface PasswordResetTokenRouteHandlerDependencies<Environment> {
  getEnvironment(): Environment;
  consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult>;
  getTenant(
    request: Request,
  ): Promise<Pick<TenantContext, "resolved" | "scope" | "venueId">>;
  reset(
    input: {
      token: string;
      newPassword: string;
      expectedVenueId: string | null;
    },
    environment: Environment,
    operationNow: Date,
  ): Promise<TokenPasswordResetResult>;
  now?: () => Date;
  getRequestId?: typeof getRequestId;
  reportServerError?: typeof reportServerError;
  writeStructuredLog?: typeof writeStructuredLog;
}

export function createPasswordResetTokenRouteHandlers<Environment>(
  dependencies: PasswordResetTokenRouteHandlerDependencies<Environment>,
) {
  const identifyRequest = dependencies.getRequestId ?? getRequestId;
  const reportError = dependencies.reportServerError ?? reportServerError;
  const writeLog = dependencies.writeStructuredLog ?? writeStructuredLog;

  return {
    POST: async () => NextResponse.json(
      {
        code: "EMAIL_RESET_DISABLED",
        error: "Email password reset is disabled. Request help from an administrator.",
      },
      { status: 410, headers: { Allow: "PUT" } },
    ),

    PUT: async (request: Request) => {
      const requestId = identifyRequest(request);
      try {
        if (!isTrustedMutationOrigin(request)) {
          return NextResponse.json(
            { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
            { status: 403 },
          );
        }
        const environment = dependencies.getEnvironment();
        const body: unknown = await request.json().catch(() => null);
        const token = body && typeof body === "object" && "token" in body
          ? (body as { token?: unknown }).token
          : undefined;
        const newPassword = body && typeof body === "object" && "newPassword" in body
          ? (body as { newPassword?: unknown }).newPassword
          : undefined;

        const prepared = prepareTokenPasswordReset({ token, newPassword });
        if (prepared.status === "missing") {
          return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
        }
        if (prepared.status === "policy_error") {
          return NextResponse.json({ error: prepared.error }, { status: 400 });
        }
        if (prepared.status === "invalid_token") {
          return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
        }
        const operationNow = dependencies.now?.() ?? new Date();

        const rateLimit = await dependencies.consumeRateLimit({
          namespace: "password-reset-token",
          identifier: getRequestIp(request),
          limit: 20,
          windowSeconds: 60 * 15,
        });
        if (!rateLimit.allowed) {
          return NextResponse.json(
            {
              code: "RATE_LIMITED",
              error: "Too many password reset attempts. Please try again later.",
            },
            {
              status: 429,
              headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
            },
          );
        }

        const tenant = await dependencies.getTenant(request);
        const expectedVenueId = tenant.scope === "venue" ? tenant.venueId : null;

        if (!tenant.resolved) {
          return NextResponse.json({ error: "Unknown venue." }, { status: 404 });
        }

        const result = await dependencies.reset(
          {
            token: prepared.token,
            newPassword: prepared.newPassword,
            expectedVenueId,
          },
          environment,
          operationNow,
        );
        if (result.status === "invalid_token") {
          return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
        }

        await writeLog("info", {
          event: result.isInitialSetup ? "auth.account_invitation" : "auth.password_reset",
          requestId,
          actorId: result.userId,
          venueId: expectedVenueId,
          outcome: "success",
        });
        return NextResponse.json({ ok: true, message: "비밀번호가 성공적으로 변경되었습니다." });
      } catch (error) {
        await reportError("auth.password_reset", error, { requestId });
        return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
      }
    },
  };
}
