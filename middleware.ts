import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getCloudflareContext } from "@opennextjs/cloudflare";

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

    // ─── KV 세션 존재 여부 확인 (revocation) ─────────────────
    const session = await env.SESSIONS.get(`session:${sessionId}`);
    if (!session) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    // ─── RBAC: /admin 경로는 super_admin, venue_admin만 접근 ──
    if (pathname.startsWith("/admin")) {
      const allowedRoles = ["super_admin", "venue_admin"];
      if (!allowedRoles.includes(payload.role as string)) {
        return NextResponse.redirect(new URL("/door", request.url));
      }
    }

    // ─── RBAC: /door 경로는 door_staff, venue_admin, super_admin ──
    if (pathname.startsWith("/door")) {
      const allowedRoles = ["super_admin", "venue_admin", "door_staff"];
      if (!allowedRoles.includes(payload.role as string)) {
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
