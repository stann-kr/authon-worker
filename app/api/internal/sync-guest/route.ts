import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { jwtVerify } from "jose";
import { guests } from "@/lib/db/schema";

interface Env {
  DB: D1Database;
  TERMINAL_VENUE_ID: string;
  INTERNAL_API_SECRET: string;
}

/**
 * 내부 Service Binding 전용 게스트 동기화 엔드포인트
 * terminal-2 워커에서 Service Binding으로 호출되어 게스트를 D1에 삽입함.
 *
 * 보안: X-Internal-Secret 헤더로 Shared Secret 검증
 */
export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext() as unknown as { env: Env };

    // ─── Shared Secret 인증 ────────────────────────────────────
    // Service Binding 직접 호출이더라도, 외부 노출 경로이므로 시크릿 검증 필수
    const internalSecret = env.INTERNAL_API_SECRET;
    if (internalSecret) {
      const requestSecret = request.headers.get("X-Internal-Secret");
      if (requestSecret !== internalSecret) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    } else {
      console.warn("[sync-guest] INTERNAL_API_SECRET is not configured — endpoint is unprotected");
    }

    // ─── TERMINAL_VENUE_ID 검증 ───────────────────────────────
    const venueId = env.TERMINAL_VENUE_ID;
    if (!venueId) {
      return Response.json({ ok: false, error: "TERMINAL_VENUE_ID is not configured" }, { status: 500 });
    }

    const db = drizzle(env.DB);
    const data = await request.json();

    await db.insert(guests).values({
      id: crypto.randomUUID(),
      venueId,
      name: data.name,
      email: data.email,
      instagram: data.instagram,
      terminalRequestId: data.terminalRequestId,
      source: "terminal",
      status: "pending",
      date: data.date,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.createdAt || new Date().toISOString(),
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Sync guest error:", error);
    return Response.json({ ok: false, error: "Failed to sync guest" }, { status: 500 });
  }
}
