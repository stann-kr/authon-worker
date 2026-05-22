import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export type Role = "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  venueId: string | null;
}

/** JWT + KV 세션 검증. 실패 시 Error throw. */
export async function requireAuth(): Promise<SessionUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  const sessionId = cookieStore.get("sessionId")?.value;

  if (!token || !sessionId) throw new Error("Unauthorized");

  const { env } = getCloudflareContext();
  if (!env.JWT_SECRET) throw new Error("Server configuration error");

  let payload: { sub?: string; email?: string; role?: string; venueId?: string | null };
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    payload = result.payload as typeof payload;
  } catch {
    throw new Error("Unauthorized");
  }

  const session = await env.SESSIONS.get(`session:${sessionId}`);
  if (!session) throw new Error("Session expired");

  if (!payload.sub || !payload.role) throw new Error("Unauthorized");

  return {
    id: payload.sub,
    email: payload.email ?? "",
    role: payload.role as Role,
    venueId: payload.venueId ?? null,
  };
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
