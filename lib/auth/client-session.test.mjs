import assert from "node:assert/strict";
import test from "node:test";

import {
  completeAuthenticatedClientSession,
  createAuthGuardRecoveryGate,
  notifySessionExpired,
  SESSION_EXPIRED_SIGN_IN_PATH,
  watchSessionExpiry,
} from "./client-session.ts";

test("authenticated client session is committed before protected navigation", () => {
  const calls = [];
  const user = {
    id: "user-1",
    venue_id: "venue-1",
    email: "staff@example.test",
    name: "Staff",
    role: "staff",
    account_kind: "personal",
    door_access_enabled: false,
    guest_limit: null,
    preferred_locale: "ko",
  };

  completeAuthenticatedClientSession({
    user,
    setUser(nextUser) {
      calls.push({ type: "session", user: nextUser });
    },
    navigate(href) {
      calls.push({ type: "navigate", href });
    },
  });

  assert.deepEqual(calls, [
    { type: "session", user },
    { type: "navigate", href: "/" },
  ]);
});

test("client auth mismatch requests one authoritative refresh without choosing a fallback route", () => {
  const gate = createAuthGuardRecoveryGate();

  assert.equal(gate.shouldRefresh(false), true);
  assert.equal(gate.shouldRefresh(false), false);
  assert.equal(gate.shouldRefresh(false), false);

  assert.equal(gate.shouldRefresh(true), false);
  assert.equal(gate.shouldRefresh(false), true);
  assert.equal(gate.shouldRefresh(false), false);
});

test("an expired session sends the browser to sign-in once per burst and stops after cleanup", () => {
  const target = new EventTarget();
  const destinations = [];
  let now = 1_000;
  const stop = watchSessionExpiry(target, (href) => destinations.push(href), () => now);

  notifySessionExpired(target);
  notifySessionExpired(target);
  assert.deepEqual(destinations, [SESSION_EXPIRED_SIGN_IN_PATH]);

  // A kept page (for example after an unsaved-work prompt) tries again on a later expired read.
  now += 5_000;
  notifySessionExpired(target);
  assert.equal(destinations.length, 2);

  stop();
  now += 5_000;
  notifySessionExpired(target);
  assert.equal(destinations.length, 2);
});
