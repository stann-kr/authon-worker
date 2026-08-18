import assert from "node:assert/strict";
import test from "node:test";

import {
  completeAuthenticatedClientSession,
  createAuthGuardRecoveryGate,
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
