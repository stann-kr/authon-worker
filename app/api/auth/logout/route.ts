import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { jwtVerify } from "jose";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import { REVOKE_USER_SESSIONS_SQL } from "@/lib/auth/session-revocation";
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
  const response = NextResponse.json({ ok: true, message: "Logged out successfully" });
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

  let cleanupFailed = false;
  try {
    const { env } = getCloudflareContext();

    // Parse cookies from request header
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map((c) => {
        const parts = c.trim().split("=");
        return [parts[0], parts.slice(1).join("=")];
      })
    );

    const sessionId = cookies.sessionId;
    const token = cookies.token;

    if (token && sessionId && env.JWT_SECRET) {
      try {
        const [{ payload }, sessionRaw] = await Promise.all([
          jwtVerify(
            token,
            new TextEncoder().encode(env.JWT_SECRET),
            { algorithms: ["HS256"], clockTolerance: 60 },
          ),
          env.SESSIONS.get(`session:${sessionId}`),
        ]);
        const userId = payload.sub;
        const sessionVersion = payload.sv;
        const session = sessionRaw ? parseStoredSession(sessionRaw) : null;
        if (
          typeof userId === "string" &&
          typeof sessionVersion === "number" &&
          Number.isSafeInteger(sessionVersion) &&
          sessionVersion >= 0 &&
          session?.userId === userId &&
          session.sessionVersion === sessionVersion
        ) {
          await env.DB.prepare(REVOKE_USER_SESSIONS_SQL)
            .bind(userId, sessionVersion)
            .first<{ sessionVersion: number }>();
        }
      } catch (error) {
        cleanupFailed = true;
        try {
          await reportServerError("auth.logout.session_revocation", error, {
            requestId,
          });
        } catch {
          // The client-side termination response must survive observability failure.
        }
      }
    }

    // Delete session from KV if exists
    if (sessionId && env.SESSIONS) {
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
        ...(cleanupFailed ? { errorKind: "SessionCleanupFailed" } : {}),
      });
    } catch {
      // Cookie clearing is the logout contract even when telemetry is unavailable.
    }
    return response;
  } catch (error) {
    try {
      await reportServerError("auth.logout", error, { requestId });
    } catch {
      // Cookie clearing is the logout contract even when telemetry is unavailable.
    }
    return response;
  }
}
