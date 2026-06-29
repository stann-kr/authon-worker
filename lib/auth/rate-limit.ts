import { getCloudflareContext } from "@opennextjs/cloudflare";

interface RateLimitOptions {
  namespace: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}

interface RateLimitState {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function getKey(namespace: string, identifier: string) {
  return `rate-limit:${namespace}:${identifier}`;
}

function parseState(raw: string | null): RateLimitState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RateLimitState;
    if (typeof parsed?.count === "number" && typeof parsed?.resetAt === "number") {
      return parsed;
    }
  } catch {
    // ignore invalid state
  }
  return null;
}

export function getRequestIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return "unknown";
}

export async function consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { env } = getCloudflareContext();
  const now = Date.now();
  const key = getKey(options.namespace, options.identifier);
  const state = parseState(await env.SESSIONS.get(key));

  if (state && now < state.resetAt && state.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000)),
    };
  }

  const resetAt = state && now < state.resetAt
    ? state.resetAt
    : now + options.windowSeconds * 1000;
  const count = state && now < state.resetAt
    ? state.count + 1
    : 1;

  await env.SESSIONS.put(key, JSON.stringify({ count, resetAt }), {
    expirationTtl: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  });

  return {
    allowed: true,
    remaining: Math.max(0, options.limit - count),
    retryAfterSeconds: Math.max(0, Math.ceil((resetAt - now) / 1000)),
  };
}

export async function clearRateLimit(namespace: string, identifier: string): Promise<void> {
  const { env } = getCloudflareContext();
  await env.SESSIONS.delete(getKey(namespace, identifier));
}
