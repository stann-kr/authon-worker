import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 허용되는 공개 경로
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon.ico") ||
    pathname === "/auth/login"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default_secret_for_local_dev");
    const { payload } = await jwtVerify(token, secret);
    
    // RBAC 로직 구현
    // /admin 경로는 super_admin, venue_admin만 접근 가능
    if (pathname.startsWith("/admin")) {
      const allowedRoles = ["super_admin", "venue_admin"];
      if (!allowedRoles.includes(payload.role as string)) {
        return NextResponse.redirect(new URL("/door", request.url)); // 권한 없음 시 /door로 리다이렉트
      }
    }

    // 그 외 권한 기반 라우트 제어가 필요하다면 여기에 추가
    
    // 인증 성공, 요청 진행
    return NextResponse.next();
  } catch (error) {
    console.error("JWT Verify Error:", error);
    // 토큰이 유효하지 않거나 만료된 경우 로그인 페이지로 리다이렉트
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth routes)
     * - api/internal (internal service routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api/auth|api/internal|_next/static|_next/image|favicon.ico).*)",
  ],
};
