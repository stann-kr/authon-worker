import assert from "node:assert/strict";
import test from "node:test";

import { decideRateLimit } from "./rate-limit-policy.ts";

const NOW = Date.parse("2026-08-05T00:00:00.000Z");

test("rate limit starts a fixed window and applies weighted cost", () => {
  assert.deepEqual(
    decideRateLimit({
      state: null,
      now: NOW,
      limit: 100,
      windowSeconds: 60,
      cost: 25,
    }),
    {
      allowed: true,
      remaining: 75,
      retryAfterSeconds: 60,
      nextState: { count: 25, resetAt: NOW + 60_000 },
    },
  );
});

test("rate limit rejects a cost that would cross the active window limit", () => {
  assert.deepEqual(
    decideRateLimit({
      state: { count: 90, resetAt: NOW + 30_000 },
      now: NOW,
      limit: 100,
      windowSeconds: 60,
      cost: 25,
    }),
    {
      allowed: false,
      remaining: 10,
      retryAfterSeconds: 30,
      nextState: null,
    },
  );
});

test("rate limit resets an expired window", () => {
  const decision = decideRateLimit({
    state: { count: 100, resetAt: NOW - 1 },
    now: NOW,
    limit: 100,
    windowSeconds: 60,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.remaining, 99);
  assert.deepEqual(decision.nextState, {
    count: 1,
    resetAt: NOW + 60_000,
  });
});

test("rate limit rejects invalid policy values", () => {
  assert.throws(() =>
    decideRateLimit({
      state: null,
      now: NOW,
      limit: 10,
      windowSeconds: 60,
      cost: 0,
    }),
  );
});
