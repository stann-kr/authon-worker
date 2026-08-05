export interface RateLimitWindowState {
  count: number;
  resetAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  nextState: RateLimitWindowState | null;
}

interface RateLimitDecisionInput {
  state: RateLimitWindowState | null;
  now: number;
  limit: number;
  windowSeconds: number;
  cost?: number;
}

/** Pure fixed-window policy shared by KV-backed rate limits and unit tests. */
export function decideRateLimit({
  state,
  now,
  limit,
  windowSeconds,
  cost = 1,
}: RateLimitDecisionInput): RateLimitDecision {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Rate limit must be a positive integer");
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error("Rate limit window must be a positive integer");
  }
  if (!Number.isInteger(cost) || cost < 1) {
    throw new Error("Rate limit cost must be a positive integer");
  }

  const hasActiveWindow = Boolean(state && now < state.resetAt);
  const currentCount = hasActiveWindow ? Math.max(0, state?.count ?? 0) : 0;
  const resetAt = hasActiveWindow
    ? state?.resetAt ?? now + windowSeconds * 1000
    : now + windowSeconds * 1000;
  const nextCount = currentCount + cost;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((resetAt - now) / 1000),
  );

  if (nextCount > limit) {
    return {
      allowed: false,
      remaining: Math.max(0, limit - currentCount),
      retryAfterSeconds,
      nextState: null,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - nextCount),
    retryAfterSeconds,
    nextState: { count: nextCount, resetAt },
  };
}
