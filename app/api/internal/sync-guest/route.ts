import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { guests } from "@/lib/db/schema";

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

function isShortText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
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

    const db = drizzle(env.DB);
    let data: {
      name?: unknown;
      email?: unknown;
      instagram?: unknown;
      terminalRequestId?: unknown;
      date?: unknown;
      createdAt?: unknown;
    };

    try {
      data = await request.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid request payload" }, { status: 400 });
    }

    if (
      !isShortText(data?.name, 100) ||
      !isIsoDate(data?.date) ||
      (data.email !== undefined && data.email !== null && !isShortText(data.email, 254)) ||
      (data.instagram !== undefined && data.instagram !== null && !isShortText(data.instagram, 100)) ||
      (data.terminalRequestId !== undefined && data.terminalRequestId !== null && !isShortText(data.terminalRequestId, 128)) ||
      (data.createdAt !== undefined && data.createdAt !== null && !isIsoTimestamp(data.createdAt))
    ) {
      return Response.json({ ok: false, error: "Invalid request payload" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const name = String(data.name).trim();
    const email = typeof data.email === "string" ? data.email.trim() : null;
    const instagram = typeof data.instagram === "string" ? data.instagram.trim() : null;
    const terminalRequestId = typeof data.terminalRequestId === "string" ? data.terminalRequestId.trim() : null;
    const date = String(data.date);
    const createdAt = typeof data.createdAt === "string" ? data.createdAt : now;

    await db.insert(guests).values({
      id: crypto.randomUUID(),
      venueId,
      name,
      email,
      instagram,
      terminalRequestId,
      source: "terminal",
      status: "pending",
      date,
      createdAt,
      updatedAt: createdAt,
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Sync guest error:", error);
    return Response.json({ ok: false, error: "Failed to sync guest" }, { status: 500 });
  }
}
