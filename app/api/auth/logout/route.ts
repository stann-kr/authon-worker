import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { errors as joseErrors, jwtVerify } from "jose";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import {
  parseLogoutAuthCookies,
  REVOKE_USER_SESSIONS_SQL,
  resolveLogoutSessionBinding,
  retrySessionRevocation,
} from "@/lib/auth/session-revocation";
import { parseStoredSession } from "@/lib/auth/session-policy";
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
  let cleanupFailed = false;
  let revocationPending = false;
  try {
    const { env } = getCloudflareContext();

    const { sessionId, token } = parseLogoutAuthCookies(
      request.headers.get("cookie"),
    );

    if (token && sessionId) {
      if (!env.JWT_SECRET || !env.SESSIONS || !env.DB) {
        throw new Error("Auth logout bindings are unavailable");
      }

      const binding = await resolveLogoutSessionBinding(
        async () => {
          const { payload } = await jwtVerify(
            token,
            new TextEncoder().encode(env.JWT_SECRET),
            { algorithms: ["HS256"], clockTolerance: 60 },
          );
          return { userId: payload.sub, sessionVersion: payload.sv };
        },
        async () => {
          const sessionRaw = await env.SESSIONS.get(`session:${sessionId}`);
          return sessionRaw ? parseStoredSession(sessionRaw) : null;
        },
        (error) => error instanceof joseErrors.JOSEError,
      );

      if (binding.status === "pending") {
        cleanupFailed = true;
        revocationPending = true;
        try {
          await reportServerError(
            "auth.logout.session_binding",
            binding.error,
            { requestId },
          );
        } catch {
          // The credential-preserving pending response must survive telemetry failure.
        }
      } else if (binding.status === "bound") {
        // D1 invalidates every device and any late refresh response. KV deletion
        // below removes only this session key and is not a substitute for it.
        const revocation = await retrySessionRevocation(() =>
          env.DB.prepare(REVOKE_USER_SESSIONS_SQL)
            .bind(binding.userId, binding.sessionVersion)
            .first<{ sessionVersion: number }>(),
        );
        if (!revocation.ok) {
          cleanupFailed = true;
          revocationPending = true;
          try {
            await reportServerError(
              "auth.logout.session_revocation",
              revocation.error,
              { requestId },
            );
          } catch {
            // The credential-preserving pending response must survive telemetry failure.
          }
        }
      }
    }

    // Once durable revocation is known or no valid binding exists, removing the
    // current KV key is best-effort local cleanup. Pending paths preserve it so
    // the same credential can retry the all-device D1 revocation.
    if (!revocationPending && sessionId && env.SESSIONS) {
      try {
        await env.SESSIONS.delete(`session:${sessionId}`);
      } catch (error) {
        cleanupFailed = true;
        try {
          await reportServerError("auth.logout.session_cleanup", error, { requestId });
        } catch {
          // The client-side termination response must survive observability failure.
        }
      }
    }

    try {
      await writeStructuredLog(cleanupFailed ? "warn" : "info", {
        event: "auth.logout",
        requestId,
        outcome: cleanupFailed ? "failure" : "success",
        ...(cleanupFailed
          ? {
              errorKind: revocationPending
                ? "SessionRevocationPending"
                : "SessionCleanupFailed",
            }
          : {}),
      });
    } catch {
      // Logout semantics must survive telemetry failure.
    }
    return createLogoutResponse(request, revocationPending);
  } catch (error) {
    cleanupFailed = true;
    revocationPending = true;
    try {
      await reportServerError("auth.logout", error, { requestId });
    } catch {
      // The credential-preserving pending response must survive telemetry failure.
    }
    return createLogoutResponse(request, revocationPending);
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
