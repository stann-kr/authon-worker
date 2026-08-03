import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { getDb } from "../db/client";
import { getRequestTenantContext } from "../tenant/server";
import { isLocale, type Locale } from "@/i18n/config";
import { isRole, type Role } from "@/lib/users/policy";

export type { Role } from "@/lib/users/policy";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  venueId: string | null;
  preferredLocale: Locale | null;
}

interface StoredSession {
  userId?: string;
  sessionVersion?: number;
}

function parseStoredSession(raw: string): StoredSession | null {
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** JWT + KV 세션 + DB 사용자 상태 검증. 실패 시 Error throw. */
export async function requireAuth(): Promise<SessionUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  const sessionId = cookieStore.get("sessionId")?.value;

  if (!token || !sessionId) throw new Error("Unauthorized");

  const { env } = getCloudflareContext();
  if (!env.JWT_SECRET) throw new Error("Server configuration error");

  let payload: { sub?: string; email?: string; role?: string; venueId?: string | null; sv?: number };
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    payload = result.payload as typeof payload;
  } catch {
    throw new Error("Unauthorized");
  }

  if (!payload.sub || !isRole(payload.role)) throw new Error("Unauthorized");

  const sessionRaw = await env.SESSIONS.get(`session:${sessionId}`);
  if (!sessionRaw) throw new Error("Session expired");

  const session = parseStoredSession(sessionRaw);
  if (!session?.userId || session.userId !== payload.sub) {
    throw new Error("Session expired");
  }

  const db = getDb();
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      venueId: users.venueId,
      active: users.active,
      deletedAt: users.deletedAt,
      sessionVersion: users.sessionVersion,
      preferredLocale: users.preferredLocale,
    })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);
  const user = userRows[0];

  if (!user || !user.active || user.deletedAt || !isRole(user.role)) {
    throw new Error("Unauthorized");
  }

  const expectedSessionVersion = user.sessionVersion ?? 0;
  if (payload.sv !== expectedSessionVersion || session.sessionVersion !== expectedSessionVersion) {
    throw new Error("Session expired");
  }

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    venueId: user.venueId ?? null,
    preferredLocale: isLocale(user.preferredLocale) ? user.preferredLocale : null,
  };

  const tenant = await getRequestTenantContext();
  if (!tenant.resolved) throw new Error("Unknown venue");
  if (
    tenant.scope === "venue" &&
    sessionUser.role !== "super_admin" &&
    sessionUser.venueId !== tenant.venueId
  ) {
    throw new Error("Forbidden");
  }

  return sessionUser;
}

/** requireAuth 후 role 검증. 권한 없으면 Error throw. */
export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const user = await requireAuth();
  if (!roles.includes(user.role)) throw new Error("Forbidden");
  return user;
}

/** 인증 실패 시 null 반환 (non-throw 버전). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}
