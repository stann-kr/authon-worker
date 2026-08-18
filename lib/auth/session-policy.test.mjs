import assert from "node:assert/strict";
import test from "node:test";

import {
  REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS,
  REMEMBERED_SESSION_IDLE_TTL_SECONDS,
  REMEMBERED_SESSION_REFRESH_MIN_EXTENSION_SECONDS,
  STANDARD_SESSION_TTL_SECONDS,
  createLoginSessionLifetime,
  createStoredSession,
  getRememberedSessionRefresh,
} from "./session-policy.ts";

const NOW = new Date("2026-08-16T00:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

test("standard login keeps the existing fixed 24-hour lifetime", () => {
  const lifetime = createLoginSessionLifetime(false, NOW);

  assert.deepEqual(lifetime, {
    mode: "standard",
    issuedAtSeconds: NOW_SECONDS,
    expiresAtSeconds: NOW_SECONDS + STANDARD_SESSION_TTL_SECONDS,
    absoluteExpiresAt: null,
    ttlSeconds: STANDARD_SESSION_TTL_SECONDS,
    storageTtlSeconds: STANDARD_SESSION_TTL_SECONDS,
  });
  assert.equal(
    getRememberedSessionRefresh(
      createStoredSession("user-1", 3, lifetime),
      lifetime.expiresAtSeconds,
      new Date(NOW.getTime() + STANDARD_SESSION_TTL_SECONDS * 1000 - 1),
    ),
    null,
  );
});

test("remembered login uses a 30-day idle lifetime and a 180-day hard cap", () => {
  const lifetime = createLoginSessionLifetime(true, NOW);

  assert.equal(lifetime.mode, "remembered");
  assert.equal(
    lifetime.expiresAtSeconds,
    NOW_SECONDS + REMEMBERED_SESSION_IDLE_TTL_SECONDS,
  );
  assert.equal(lifetime.ttlSeconds, REMEMBERED_SESSION_IDLE_TTL_SECONDS);
  assert.equal(
    lifetime.storageTtlSeconds,
    REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS,
  );
  assert.equal(
    lifetime.absoluteExpiresAt,
    new Date((NOW_SECONDS + REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS) * 1000).toISOString(),
  );
});

test("remembered sessions reissue only after extending their expiry by at least 24 hours", () => {
  const lifetime = createLoginSessionLifetime(true, NOW);
  const session = createStoredSession("user-1", 3, lifetime);
  const currentExpiresAtSeconds = lifetime.expiresAtSeconds;
  const refreshAtSeconds = NOW_SECONDS + REMEMBERED_SESSION_REFRESH_MIN_EXTENSION_SECONDS;

  for (const elapsedSeconds of [15, REMEMBERED_SESSION_REFRESH_MIN_EXTENSION_SECONDS - 1]) {
    assert.equal(
      getRememberedSessionRefresh(
        session,
        currentExpiresAtSeconds,
        new Date((NOW_SECONDS + elapsedSeconds) * 1000),
      ),
      null,
    );
  }

  const refresh = getRememberedSessionRefresh(
    session,
    currentExpiresAtSeconds,
    new Date(refreshAtSeconds * 1000),
  );

  assert.deepEqual(refresh, {
    expiresAtSeconds: refreshAtSeconds + REMEMBERED_SESSION_IDLE_TTL_SECONDS,
    ttlSeconds: REMEMBERED_SESSION_IDLE_TTL_SECONDS,
  });
  assert.equal(
    getRememberedSessionRefresh(session, refresh?.expiresAtSeconds, new Date(refreshAtSeconds * 1000)),
    null,
  );
});

test("remembered sessions avoid same-second and absolute-cap reissues", () => {
  const lifetime = createLoginSessionLifetime(true, NOW);
  const session = createStoredSession("user-1", 3, lifetime);
  const absoluteExpiresAtSeconds = NOW_SECONDS + REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS;

  assert.equal(
    getRememberedSessionRefresh(session, lifetime.expiresAtSeconds, NOW),
    null,
  );
  assert.equal(
    getRememberedSessionRefresh(
      session,
      absoluteExpiresAtSeconds,
      new Date((absoluteExpiresAtSeconds - 60 * 60 * 24) * 1000),
    ),
    null,
  );
  assert.equal(
    getRememberedSessionRefresh(session, NOW_SECONDS, NOW),
    null,
  );
});

test("remembered session refresh is capped by the original absolute expiry", () => {
  const lifetime = createLoginSessionLifetime(true, NOW);
  const session = createStoredSession("user-1", 3, lifetime);
  const absoluteExpiresAtSeconds = NOW_SECONDS + REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS;
  const currentExpiresAtSeconds = absoluteExpiresAtSeconds - 60 * 60 * 24 * 3;
  const now = new Date((absoluteExpiresAtSeconds - 60 * 60 * 24 * 10) * 1000);

  assert.deepEqual(
    getRememberedSessionRefresh(session, currentExpiresAtSeconds, now),
    {
      expiresAtSeconds: absoluteExpiresAtSeconds,
      ttlSeconds: absoluteExpiresAtSeconds - Math.floor(now.getTime() / 1000),
    },
  );
});

test("legacy or malformed remembered metadata never upgrades a session", () => {
  const currentExpiresAtSeconds = NOW_SECONDS + REMEMBERED_SESSION_IDLE_TTL_SECONDS;

  assert.equal(
    getRememberedSessionRefresh(
      { userId: "legacy-user", sessionVersion: 3 },
      currentExpiresAtSeconds,
      NOW,
    ),
    null,
  );
  assert.equal(
    getRememberedSessionRefresh(
      { userId: "user-1", sessionVersion: 3, mode: "remembered" },
      currentExpiresAtSeconds,
      NOW,
    ),
    null,
  );
});
