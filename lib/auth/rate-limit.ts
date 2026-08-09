import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  decideRateLimit,
  type RateLimitWindowState,
} from "./rate-limit-policy";

interface RateLimitOptions {
  namespace: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
  cost?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function getKey(namespace: string, identifier: string) {
  return `rate-limit:${namespace}:${identifier}`;
}

function parseState(raw: string | null): RateLimitWindowState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RateLimitWindowState;
    if (typeof parsed?.count === "number" && typeof parsed?.resetAt === "number") {
      return parsed;
    }
  } catch {
    // ignore invalid state
  }
  return null;
}

interface RequestHeaders {
  get(name: string): string | null;
}

export function getRequestIpFromHeaders(headers: RequestHeaders): string {
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return "unknown";
}

export function getRequestIp(request: Request): string {
  return getRequestIpFromHeaders(request.headers);
}

export async function consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { env } = getCloudflareContext();
  const now = Date.now();
  const key = getKey(options.namespace, options.identifier);
  const state = parseState(await env.SESSIONS.get(key));
  const decision = decideRateLimit({
    state,
    now,
    limit: options.limit,
    windowSeconds: options.windowSeconds,
    cost: options.cost,
  });

  if (decision.nextState) {
    await env.SESSIONS.put(key, JSON.stringify(decision.nextState), {
      // Workers KV requires expiration TTLs of at least 60 seconds. Keeping an
      // expired JSON window slightly longer is harmless because the pure
      // policy resets it from `resetAt` on the next request.
      expirationTtl: Math.max(60, decision.retryAfterSeconds),
    });
  }

  return {
    allowed: decision.allowed,
    remaining: decision.remaining,
    retryAfterSeconds: decision.retryAfterSeconds,
  };
}

/**
 * 인증 경로에서 KV 장애나 동일-key 쓰기 제한을 500으로 노출하지 않는다.
 * 저장소가 카운터를 기록하지 못하면 해당 시도는 짧게 fail-closed 한다.
 */
export async function consumeRateLimitOrDeny(
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  try {
    return await consumeRateLimit(options);
  } catch {
    // identifier에는 이메일/IP가 포함될 수 있으므로 로그에 남기지 않는다.
    console.warn(`Rate limit storage unavailable: ${options.namespace}`);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    };
  }
}

export async function clearRateLimit(namespace: string, identifier: string): Promise<void> {
  const { env } = getCloudflareContext();
  await env.SESSIONS.delete(getKey(namespace, identifier));
}
