import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import {
  handleTerminalGuestSyncPayload,
} from "@/lib/internal-sync/terminal-guest-sync";

async function hashSecret(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

async function timingSafeEqual(a: string | null, b: string): Promise<boolean> {
  if (!a) return false;
  const [aHash, bHash] = await Promise.all([hashSecret(a), hashSecret(b)]);
  const aBytes = new Uint8Array(aHash);
  const bBytes = new Uint8Array(bHash);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < Math.max(aBytes.length, bBytes.length); i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/**
 * 내부 Service Binding 전용 게스트 동기화 엔드포인트
 * terminal-2 워커에서 Service Binding으로 호출되어 게스트를 D1에 삽입함.
 *
 * 보안: X-Internal-Secret 헤더로 Shared Secret 검증
 */
export async function POST(request: Request) {
  try {
    const { env } = getCloudflareContext();

    // ─── Shared Secret 인증 ────────────────────────────────────
    // Service Binding 직접 호출이더라도, 외부 노출 경로이므로 시크릿 검증 필수
    const internalSecret = env.INTERNAL_API_SECRET;
    if (!internalSecret) {
      console.error("[sync-guest] INTERNAL_API_SECRET is not configured — endpoint disabled");
      return Response.json({ ok: false, error: "Endpoint not available" }, { status: 503 });
    }

    const requestSecret = request.headers.get("X-Internal-Secret");
    if (!(await timingSafeEqual(requestSecret, internalSecret))) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ─── TERMINAL_VENUE_ID 검증 ───────────────────────────────
    const venueId = env.TERMINAL_VENUE_ID;
    if (!venueId) {
      console.error("[sync-guest] TERMINAL_VENUE_ID is not configured");
      return Response.json({ ok: false, error: "Endpoint not available" }, { status: 503 });
    }
    try {
      await requireActiveVenueId(venueId);
    } catch {
      return Response.json({ ok: false, error: "Endpoint not available" }, { status: 503 });
    }

    let rawData: unknown;

    try {
      rawData = await request.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid request payload" }, { status: 400 });
    }

    const result = await handleTerminalGuestSyncPayload(env.DB, {
      venueId,
      rawPayload: rawData,
      receivedAt: new Date().toISOString(),
    });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Sync guest error:", error);
    return Response.json({ ok: false, error: "Failed to sync guest" }, { status: 500 });
  }
}
