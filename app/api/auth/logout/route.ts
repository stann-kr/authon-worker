import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface Env {
  SESSIONS: KVNamespace;
}

export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext() as unknown as { env: Env };

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

    // Invalidate cookies
    response.cookies.set({
      name: "token",
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    
    response.cookies.set({
      name: "sessionId",
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "로그아웃 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
