import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import {
  handleTerminalGuestSyncPayload,
} from "@/lib/internal-sync/terminal-guest-sync";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

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
  const requestId = getRequestId(request);
  try {
    const { env } = getCloudflareContext();

    // ─── Shared Secret 인증 ────────────────────────────────────
    // Service Binding 직접 호출이더라도, 외부 노출 경로이므로 시크릿 검증 필수
    const internalSecret = env.INTERNAL_API_SECRET;
    if (!internalSecret) {
      await writeStructuredLog("error", {
        event: "internal.guest_sync",
        requestId,
        outcome: "unavailable",
        errorKind: "MissingConfiguration",
      });
      return Response.json({ ok: false, error: "Endpoint not available" }, { status: 503 });
    }

    const requestSecret = request.headers.get("X-Internal-Secret");
    if (!(await timingSafeEqual(requestSecret, internalSecret))) {
      await writeStructuredLog("warn", {
        event: "internal.guest_sync",
        requestId,
        outcome: "denied",
        errorKind: "AuthenticationError",
      });
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ─── TERMINAL_VENUE_ID 검증 ───────────────────────────────
    const venueId = env.TERMINAL_VENUE_ID;
    if (!venueId) {
      await writeStructuredLog("error", {
        event: "internal.guest_sync",
        requestId,
        outcome: "unavailable",
        errorKind: "MissingConfiguration",
      });
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
    await writeStructuredLog(result.status < 400 ? "info" : "warn", {
      event: "internal.guest_sync",
      requestId,
      venueId,
      outcome: result.status < 400 ? "success" : result.status === 409 ? "conflict" : "invalid",
    });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    await reportServerError("internal.guest_sync", error, { requestId });
    return Response.json({ ok: false, error: "Failed to sync guest" }, { status: 500 });
  }
}
