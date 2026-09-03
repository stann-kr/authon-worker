import { NextResponse } from "next/server";

import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "../observability/structured-log.ts";
import { shouldUseSecureAuthCookies } from "./cookie-policy.ts";
import type { LogoutServiceResult } from "./logout-service.ts";
import { isTrustedMutationOrigin } from "./request-origin.ts";
import { parseLogoutAuthCookies } from "./session-revocation.ts";

interface LogoutRouteEnvironment {
  JWT_SECRET?: string;
  SESSIONS?: unknown;
  DB?: unknown;
}

export interface LogoutRouteHandlerDependencies<
  Environment extends LogoutRouteEnvironment,
> {
  getEnvironment(): Environment;
  logout(
    input: { token?: string; sessionId?: string },
    environment: Environment,
  ): Promise<LogoutServiceResult>;
  getRequestId?: typeof getRequestId;
  reportServerError?: typeof reportServerError;
  writeStructuredLog?: typeof writeStructuredLog;
}

export function createLogoutPostHandler<Environment extends LogoutRouteEnvironment>(
  dependencies: LogoutRouteHandlerDependencies<Environment>,
) {
  const identifyRequest = dependencies.getRequestId ?? getRequestId;
  const reportError = dependencies.reportServerError ?? reportServerError;
  const writeLog = dependencies.writeStructuredLog ?? writeStructuredLog;

  return async function POST(request: Request) {
    const requestId = identifyRequest(request);
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
        { status: 403 },
      );
    }
    try {
      const environment = dependencies.getEnvironment();
      const { sessionId, token } = parseLogoutAuthCookies(
        request.headers.get("cookie"),
      );

      if (
        token &&
        sessionId &&
        (!environment.JWT_SECRET || !environment.SESSIONS || !environment.DB)
      ) {
        throw new Error("Auth logout bindings are unavailable");
      }
      const result = await dependencies.logout(
        { token, sessionId },
        environment,
      );

      for (const failure of result.failures) {
        try {
          await reportError(failure.event, failure.error, { requestId });
        } catch {
          // Logout semantics must survive telemetry failure.
        }
      }

      try {
        await writeLog(result.cleanupFailed ? "warn" : "info", {
          event: "auth.logout",
          requestId,
          outcome: result.cleanupFailed ? "failure" : "success",
          ...(result.cleanupFailed
            ? {
                errorKind: result.revocationPending
                  ? "SessionRevocationPending"
                  : "SessionCleanupFailed",
              }
            : {}),
        });
      } catch {
        // Logout semantics must survive telemetry failure.
      }
      return createLogoutResponse(request, result.revocationPending);
    } catch (error) {
      try {
        await reportError("auth.logout", error, { requestId });
      } catch {
        // The credential-preserving pending response must survive telemetry failure.
      }
      return createLogoutResponse(request, true);
    }
  };
}

function createLogoutResponse(request: Request, revocationPending: boolean) {
  if (revocationPending) {
    return NextResponse.json(
      {
        ok: false,
        code: "SESSION_REVOCATION_PENDING",
        error: "Sign-out could not be completed securely. Please try again.",
        revocationPending: true,
      },
      { status: 503 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    message: "Logged out successfully",
  });
  const secureCookies = shouldUseSecureAuthCookies(request);

  for (const name of ["token", "sessionId"] as const) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
  }

  return response;
}
