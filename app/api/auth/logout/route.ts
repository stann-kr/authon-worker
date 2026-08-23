import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { errors as joseErrors, jwtVerify } from "jose";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import { parseLogoutAuthCookies } from "@/lib/auth/session-revocation";
import { createLogoutPersistence } from "@/lib/auth/logout-persistence";
import { logoutSession } from "@/lib/auth/logout-service";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json(
      { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
      { status: 403 },
    );
  }
  try {
    const { env } = getCloudflareContext();

    const { sessionId, token } = parseLogoutAuthCookies(
      request.headers.get("cookie"),
    );

    if (token && sessionId && (!env.JWT_SECRET || !env.SESSIONS || !env.DB)) {
      throw new Error("Auth logout bindings are unavailable");
    }
    const result = await logoutSession(
      { token, sessionId },
      {
        persistence: createLogoutPersistence(env),
        verifyToken: async (candidateToken) => {
          const { payload } = await jwtVerify(
            candidateToken,
            new TextEncoder().encode(env.JWT_SECRET),
            { algorithms: ["HS256"], clockTolerance: 60 },
          );
          return { userId: payload.sub, sessionVersion: payload.sv };
        },
        isInvalidTokenError: (error) => error instanceof joseErrors.JOSEError,
      },
    );

    for (const failure of result.failures) {
      try {
        await reportServerError(failure.event, failure.error, { requestId });
      } catch {
        // Logout semantics must survive telemetry failure.
      }
    }

    try {
      await writeStructuredLog(result.cleanupFailed ? "warn" : "info", {
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
      await reportServerError("auth.logout", error, { requestId });
    } catch {
      // The credential-preserving pending response must survive telemetry failure.
    }
    return createLogoutResponse(request, true);
  }
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
