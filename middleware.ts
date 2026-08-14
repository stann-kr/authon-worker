import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { users, venueDomains, venues } from "@/lib/db/schema";
import { isPlatformHostname, normalizeHostname } from "@/lib/tenant/host";
import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  REQUEST_LOCALE_HEADER,
} from "@/i18n/config";
import { hasAccess, isAccountKind, isRole } from "@/lib/users/policy";
import { hasActiveVenueAccess } from "@/lib/tenant/active-policy";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

function parseStoredSession(raw: string): { userId?: string; sessionVersion?: number } | null {
  try {
    const parsed = JSON.parse(raw) as { userId?: string; sessionVersion?: number };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const requestId = getRequestId(request);
  const { pathname, searchParams } = request.nextUrl;
  const explicitLocale = searchParams.get("lang");
  const requestHeaders = new Headers(request.headers);
  if (isLocale(explicitLocale)) {
    requestHeaders.set(REQUEST_LOCALE_HEADER, explicitLocale);
  }

  const continueRequest = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (isLocale(explicitLocale)) {
      response.cookies.set({
        name: LOCALE_COOKIE_NAME,
        value: explicitLocale,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        path: "/",
      });
    }
    return response;
  };

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return continueRequest();
  }

  const { env } = getCloudflareContext();
  const db = drizzle(env.DB);
  const hostname = normalizeHostname(request.headers.get("host"));
  let requestVenueId: string | null = null;

  if (!hostname || !isPlatformHostname(hostname)) {
    const [domain] = hostname
      ? await db
          .select({
            scope: venueDomains.scope,
            venueId: venueDomains.venueId,
            venueActive: venues.active,
          })
          .from(venueDomains)
          .leftJoin(venues, eq(venueDomains.venueId, venues.id))
          .where(
            and(
              eq(venueDomains.hostname, hostname),
              eq(venueDomains.active, true),
            ),
          )
          .limit(1)
      : [];

    if (!domain || (domain.scope === "venue" && (!domain.venueId || !domain.venueActive))) {
      return new NextResponse("Unknown venue", { status: 404 });
    }
    if (domain.scope === "venue") requestVenueId = domain.venueId;
  }

  // ─── 공개 경로 (인증 불필요) ────────────────────────────────
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/internal/") ||
    pathname === "/api/locale" ||
    pathname === "/auth/login" ||
    pathname === "/auth/reset-password" ||
    pathname === "/auth/setup-password" ||
    pathname === "/auth/register"
  ) {
    return continueRequest();
  }

  // ─── 외부 DJ 토큰 링크: /guest?token=xxx ────────────────────
  if (pathname === "/guest" && searchParams.has("token")) {
    return continueRequest();
  }

  // ─── JWT + 세션 검증 ──────────────────────────────────────
  const token = request.cookies.get("token")?.value;
  const sessionId = request.cookies.get("sessionId")?.value;

  if (!token || !sessionId) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (!env.JWT_SECRET) {
    await writeStructuredLog("error", {
      event: "auth.middleware",
      requestId,
      outcome: "unavailable",
      errorKind: "MissingConfiguration",
    });
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
    const userRows = await db
      .select({
        role: users.role,
        accountKind: users.accountKind,
        doorAccessEnabled: users.doorAccessEnabled,
        venueId: users.venueId,
        active: users.active,
        deletedAt: users.deletedAt,
        sessionVersion: users.sessionVersion,
        venueActive: venues.active,
      })
      .from(users)
      .leftJoin(venues, eq(users.venueId, venues.id))
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    const currentRole = user?.role;
    const currentAccountKind = user?.accountKind;
    if (
      !user?.active ||
      user.deletedAt ||
      !isRole(currentRole) ||
      !isAccountKind(currentAccountKind) ||
      !hasActiveVenueAccess({
        role: currentRole,
        venueId: user.venueId,
        venueActive: user.venueActive,
      })
    ) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
    const accessSubject = {
      role: currentRole,
      accountKind: currentAccountKind,
      doorAccessEnabled: user.doorAccessEnabled,
    };

    if (requestVenueId && user.role !== "super_admin" && user.venueId !== requestVenueId) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    const expectedSessionVersion = user.sessionVersion ?? 0;
    if (sessionVersion !== expectedSessionVersion || session.sessionVersion !== expectedSessionVersion) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    // ─── RBAC: /admin 경로는 super_admin, venue_admin만 접근 ──
    if (pathname.startsWith("/admin")) {
      if (!hasAccess(accessSubject, ["admin"])) {
        return NextResponse.redirect(new URL("/door", request.url));
      }
    }

    // ─── RBAC: /door 경로는 door_staff, venue_admin, super_admin ──
    if (pathname.startsWith("/door")) {
      if (!hasAccess(accessSubject, ["door"])) {
        return NextResponse.redirect(new URL("/guest", request.url));
      }
    }

    return continueRequest();
  } catch (error) {
    await reportServerError("auth.middleware", error, { requestId });
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
}

export const config = {
  matcher: [
    "/((?!api/auth|api/internal|_next/static|_next/image|favicon.ico).*)",
  ],
};
