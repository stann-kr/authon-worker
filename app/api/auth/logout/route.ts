import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
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

    // Delete session from KV if exists
    if (sessionId && env.SESSIONS) {
      await env.SESSIONS.delete(`session:${sessionId}`);
    }

    const response = NextResponse.json({ ok: true, message: "Logged out successfully" });
    const secureCookies = shouldUseSecureAuthCookies(request);

    // Invalidate cookies
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

    await writeStructuredLog("info", {
      event: "auth.logout",
      requestId,
      outcome: "success",
    });
    return response;
  } catch (error) {
    await reportServerError("auth.logout", error, { requestId });
    return NextResponse.json(
      { error: "로그아웃 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
