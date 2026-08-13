import assert from "node:assert/strict";
import test from "node:test";

import {
  createStructuredLogRecord,
  getRequestId,
  writeStructuredLog,
} from "./structured-log.ts";

test("structured log emits only the approved field set", async () => {
  const record = await createStructuredLogRecord({
    event: "auth.login",
    requestId: "request-123",
    actorId: "user-123",
    venueId: "venue-123",
    outcome: "failure",
    error: new TypeError("private message"),
  });

  assert.deepEqual(Object.keys(record).sort(), [
    "actor",
    "errorKind",
    "event",
    "outcome",
    "requestId",
    "venueId",
  ]);
  assert.equal(record.errorKind, "TypeError");
  assert.match(record.actor, /^sha256:[a-f0-9]{16}$/);
});

test("email, credential, actor id, error message, and SQL never reach serialized logs", async () => {
  const sensitiveValues = [
    "person@example.com",
    "reset-token-secret",
    "setup-code-123456",
    "raw-user-id",
    "SELECT * FROM users WHERE email = 'person@example.com'",
  ];
  let serialized = "";

  await writeStructuredLog(
    "error",
    {
      event: "auth.password_reset",
      requestId: "request-456",
      actorId: sensitiveValues[3],
      venueId: "venue-456",
      outcome: "failure",
      error: new Error(sensitiveValues.join(" | ")),
    },
    (value) => {
      serialized = value;
    },
  );

  for (const sensitiveValue of sensitiveValues) {
    assert.doesNotMatch(serialized, new RegExp(sensitiveValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(JSON.parse(serialized).errorKind, "UnexpectedError");
});

test("request correlation accepts safe tracing headers and rejects attacker-controlled text", () => {
  const trusted = new Request("https://example.test", {
    headers: { "cf-ray": "abc123-ICN" },
  });
  assert.equal(getRequestId(trusted), "abc123-ICN");

  const unsafe = new Request("https://example.test", {
    headers: { "x-request-id": "person@example.com raw payload" },
  });
  assert.match(getRequestId(unsafe), /^[0-9a-f-]{36}$/);
});
