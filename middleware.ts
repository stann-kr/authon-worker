import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";

function parseStoredSession(raw: string): { userId?: string; sessionVersion?: number } | null {
  try {
    const parsed = JSON.parse(raw) as { userId?: string; sessionVersion?: number };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // ─── 공개 경로 (인증 불필요) ────────────────────────────────
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon.ico") ||
    pathname === "/auth/login" ||
    pathname === "/auth/reset-password" ||
    pathname === "/auth/register"
  ) {
    return NextResponse.next();
  }

  // ─── 외부 DJ 토큰 링크: /guest?token=xxx ────────────────────
  if (pathname === "/guest" && searchParams.has("token")) {
    return NextResponse.next();
  }

  // ─── JWT + 세션 검증 ──────────────────────────────────────
  const token = request.cookies.get("token")?.value;
  const sessionId = request.cookies.get("sessionId")?.value;

  if (!token || !sessionId) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const { env } = getCloudflareContext();

  if (!env.JWT_SECRET) {
    console.error("JWT_SECRET is not configured");
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.sub as string | undefined;
    const role = payload.role as string | undefined;
    const sessionVersion = payload.sv as number | undefined;

    if (!userId || !role) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    // ─── KV 세션 존재 및 JWT subject 바인딩 확인 ───────────────
    const sessionRaw = await env.SESSIONS.get(`session:${sessionId}`);
    const session = sessionRaw ? parseStoredSession(sessionRaw) : null;
    if (!session?.userId || session.userId !== userId) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    // ─── DB 사용자 상태/현재 role 확인 ────────────────────────
    const db = drizzle(env.DB);
    const userRows = await db
      .select({ role: users.role, active: users.active, sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user?.active) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    const expectedSessionVersion = user.sessionVersion ?? 0;
    if (sessionVersion !== expectedSessionVersion || session.sessionVersion !== expectedSessionVersion) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    // ─── RBAC: /admin 경로는 super_admin, venue_admin만 접근 ──
    if (pathname.startsWith("/admin")) {
      const allowedRoles = ["super_admin", "venue_admin"];
      if (!allowedRoles.includes(user.role)) {
        return NextResponse.redirect(new URL("/door", request.url));
      }
    }

    // ─── RBAC: /door 경로는 door_staff, venue_admin, super_admin ──
    if (pathname.startsWith("/door")) {
      const allowedRoles = ["super_admin", "venue_admin", "door_staff"];
      if (!allowedRoles.includes(user.role)) {
        return NextResponse.redirect(new URL("/guest", request.url));
      }
    }

    return NextResponse.next();
  } catch (error) {
    console.error("JWT Verify Error:", error);
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
}

export const config = {
  matcher: [
    "/((?!api/auth|api/internal|_next/static|_next/image|favicon.ico).*)",
  ],
};
