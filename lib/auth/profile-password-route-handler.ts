import { NextResponse } from "next/server";

import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "../observability/structured-log.ts";
import { shouldUseSecureAuthCookies } from "./cookie-policy.ts";
import type { ProfilePasswordChangeResult } from "./profile-password-service.ts";
import { isTrustedMutationOrigin } from "./request-origin.ts";
import {
  getRequestIp,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rate-limit.ts";

function getAuthErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "Unauthorized" || error.message === "Session expired") return 401;
  if (error.message === "Forbidden") return 403;
  return null;
}

export interface ProfilePasswordRouteHandlerDependencies<Environment> {
  getEnvironment(): Environment;
  requireAuth(): Promise<{ id: string }>;
  consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult>;
  changePassword(
    input: {
      actorUserId: string;
      currentPassword: unknown;
      newPassword: unknown;
      sessionId?: string;
    },
    environment: Environment,
  ): Promise<ProfilePasswordChangeResult>;
  getRequestId?: typeof getRequestId;
  reportServerError?: typeof reportServerError;
  writeStructuredLog?: typeof writeStructuredLog;
}

export function createProfilePasswordPutHandler<Environment>(
  dependencies: ProfilePasswordRouteHandlerDependencies<Environment>,
) {
  const identifyRequest = dependencies.getRequestId ?? getRequestId;
  const reportError = dependencies.reportServerError ?? reportServerError;
  const writeLog = dependencies.writeStructuredLog ?? writeStructuredLog;

  return async function PUT(request: Request) {
    const requestId = identifyRequest(request);
    try {
      if (!isTrustedMutationOrigin(request)) {
        return NextResponse.json(
          { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
          { status: 403 },
        );
      }

      const environment = dependencies.getEnvironment();
      const authUser = await dependencies.requireAuth();
      const rateLimit = await dependencies.consumeRateLimit({
        namespace: "profile-password",
        identifier: `${authUser.id}:${getRequestIp(request)}`,
        limit: 5,
        windowSeconds: 60 * 15,
      });
      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            code: "RATE_LIMITED",
            error: "Too many password change attempts. Please try again later.",
          },
          {
            status: 429,
            headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
          },
        );
      }

      const { currentPassword, newPassword } = await request.json() as {
        currentPassword?: unknown;
        newPassword?: unknown;
      };
      const sessionId = (request.headers.get("cookie") || "").match(
        /(?:^|;\s*)sessionId=([^;]+)/,
      )?.[1];
      const result = await dependencies.changePassword(
        {
          actorUserId: authUser.id,
          currentPassword,
          newPassword,
          sessionId,
        },
        environment,
      );

      if (result.status === "missing") {
        return NextResponse.json({ error: "Passwords are required" }, { status: 400 });
      }
      if (result.status === "policy_error") {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      if (result.status === "user_not_found") {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      if (result.status === "password_mismatch") {
        return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 400 });
      }
      if (result.status === "conflict") {
        return NextResponse.json(
          { error: "계정 상태가 변경되었습니다. 다시 로그인한 뒤 시도해주세요." },
          { status: 409 },
        );
      }

      if (result.sessionCleanupError) {
        await reportError(
          "auth.profile_password.session_cleanup",
          result.sessionCleanupError,
          {
            requestId,
            actorId: result.user.id,
            venueId: result.user.venueId,
          },
        );
      }

      const response = NextResponse.json({
        ok: true,
        message: "비밀번호가 변경되어 다시 로그인해야 합니다.",
        reauthRequired: true,
      });
      const secureCookies = shouldUseSecureAuthCookies(request);
      response.cookies.set({
        name: "token",
        value: "",
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        maxAge: 0,
        path: "/",
      });
      response.cookies.set({
        name: "sessionId",
        value: "",
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        maxAge: 0,
        path: "/",
      });

      await writeLog("info", {
        event: "auth.profile_password",
        requestId,
        actorId: result.user.id,
        venueId: result.user.venueId,
        outcome: "success",
      });
      return response;
    } catch (error: unknown) {
      await reportError("auth.profile_password", error, { requestId });
      const authStatus = getAuthErrorStatus(error);
      if (authStatus) {
        return NextResponse.json({ error: "Unauthorized" }, { status: authStatus });
      }
      return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
    }
  };
}
