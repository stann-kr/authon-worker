import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // ─── 공개 경로 (인증 불필요) ────────────────────────────────
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon.ico") ||
    pathname === "/auth/login" ||
    pathname === "/auth/reset-password"
  ) {
    return NextResponse.next();
  }

  // ─── 외부 DJ 토큰 링크: /guest?token=xxx ────────────────────
  // 토큰 기반 접근은 로그인 없이 허용 (ExternalDJGuestView가 토큰 검증 처리)
  if (pathname === "/guest" && searchParams.has("token")) {
    return NextResponse.next();
  }

  // ─── JWT 검증 ────────────────────────────────────────────────
  const token = request.cookies.get("token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error("JWT_SECRET is not configured");
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);

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
    /*
     * 아래 경로를 제외한 모든 요청에 미들웨어 적용:
     * - api/auth      (로그인/로그아웃 API)
     * - api/internal  (Service Binding 전용 내부 API)
     * - _next/static  (정적 파일)
     * - _next/image   (이미지 최적화)
     * - favicon.ico
     */
    "/((?!api/auth|api/internal|_next/static|_next/image|favicon.ico).*)",
  ],
};
