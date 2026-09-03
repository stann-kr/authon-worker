import assert from "node:assert/strict";
import test from "node:test";

import { createLoginSessionAdapter } from "./login-session.ts";
import { REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS, REMEMBERED_SESSION_IDLE_TTL_SECONDS } from "./session-policy.ts";

test("remembered login uses the existing cookie idle TTL and KV absolute TTL", async () => {
  const writes = [];
  const adapter = createLoginSessionAdapter({
    JWT_SECRET: "test-secret",
    SESSIONS: { async put(key, value, options) { writes.push({ key, value, options }); } },
  });
  const session = await adapter.createSession({
    user: { id: "user-a", email: "staff@example.com", role: "staff", venueId: "venue-a" },
    sessionVersion: 7,
    keepSignedIn: true,
  });
  assert.equal(session.lifetime.ttlSeconds, REMEMBERED_SESSION_IDLE_TTL_SECONDS);
  assert.equal(session.lifetime.storageTtlSeconds, REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.expirationTtl, REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS);
  assert.match(writes[0].value, /"mode":"remembered"/);
});
