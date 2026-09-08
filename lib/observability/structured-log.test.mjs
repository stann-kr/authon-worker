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

const { createPerformanceTrace } = await import("./performance.ts");
const { currentPerformanceTrace, measureServerStage, runPerformanceOperation } = await import("./performance-scope.ts");
const { instrumentD1 } = await import("./d1-performance.ts");
const { browserTimingRecord, beginBrowserLoading } = await import("./browser-performance.ts");

test("performance fields accept only finite approved numeric metrics", async () => {
  const record = await createStructuredLogRecord({
    event: "server.guest_create", outcome: "success",
    performance: { durationMs: 12.345, authMs: -1, kvMs: Infinity, d1Ms: NaN,
      d1Count: "private", d1RowsRead: Number.MAX_VALUE, token: "private", sql: "SELECT private" },
  });
  assert.deepEqual(record.performance, { durationMs: 12.35 });
});

test("operation preserves returned business errors and thrown errors even when logging fails", async () => {
  const records = [];
  const response = { data: null, error: "PRIVATE_VALIDATION_MESSAGE" };
  assert.equal(await runPerformanceOperation("server.guest_create", "request-a", async () => response,
    { sink: (value) => records.push(JSON.parse(value)) }), response);
  assert.equal(records[0].outcome, "failure");
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_VALIDATION_MESSAGE/);
  const failure = new Error("private error");
  await assert.rejects(runPerformanceOperation("server.guest_create", "request-b", async () => { throw failure; },
    { sink: () => { throw new Error("log unavailable"); } }), (error) => error === failure);
  assert.equal(await runPerformanceOperation("server.guest_create", "request-c", async () => response,
    { sink: () => { throw new Error("log unavailable"); } }), response);
  assert.equal(currentPerformanceTrace(), undefined);
});

test("parallel operations isolate stage counts and timings and restore the parent scope", async () => {
  const records = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let clockA = 0;
  const first = runPerformanceOperation("server.guest_create", "request-a", async () => {
    const parent = currentPerformanceTrace();
    await measureServerStage("auth", async () => {
      await gate;
      clockA = 12;
    });
    await runPerformanceOperation("server.guest_list", "nested", async () => {
      assert.notEqual(currentPerformanceTrace(), parent);
    }, { sink: (value) => records.push(JSON.parse(value)) });
    assert.equal(currentPerformanceTrace(), parent);
    return "created";
  }, { now: () => clockA, sink: (value) => records.push(JSON.parse(value)) });
  const second = runPerformanceOperation("server.guest_list", "request-b", async () => {
    await measureServerStage("kv", async () => {});
    release();
    return "listed";
  }, { now: () => 0, sink: (value) => records.push(JSON.parse(value)) });
  assert.deepEqual(await Promise.all([first, second]), ["created", "listed"]);
  const a = records.find((record) => record.requestId === "request-a");
  const b = records.find((record) => record.requestId === "request-b");
  assert.equal(a.performance.durationMs, 12);
  assert.equal(a.performance.authMs, 12);
  assert.equal(a.performance.authCount, 1);
  assert.equal(a.performance.kvCount, 0);
  assert.equal(b.performance.authCount, 0);
  assert.equal(b.performance.kvCount, 1);
  assert.equal(currentPerformanceTrace(), undefined);
});

test("D1 instrumentation preserves bound native statements and batch order without duplicate execution", async () => {
  const executions = [];
  const failure = new Error("SQL contains private guest name");
  class Statement {
    #values;
    constructor(values = []) { this.#values = values; }
    bind(...values) { return new Statement(values); }
    async run() {
      executions.push(this.#values);
      if (this.#values[0] === "fail") throw failure;
      return { success: true, results: [], meta: { rows_read: 3, rows_written: 1 } };
    }
    async raw(...args) { executions.push(args); return [["private guest name"]]; }
    async all() { return this.run(); }
    async first(column) { return this.#values[column]; }
  }
  const db = {
    prepare() { assert.equal(this, db); return new Statement(); },
    async batch(statements) {
      assert.equal(this, db);
      return Promise.all(statements.map((statement) => Statement.prototype.run.call(statement)));
    },
  };
  assert.equal(instrumentD1(db), db);
  const records = [];
  const trace = createPerformanceTrace("server.guest_create", "d1-request", { sink: (value) => records.push(JSON.parse(value)) });
  const measured = instrumentD1(db, trace);
  const first = measured.prepare("private SQL").bind("private bind", 1);
  const second = instrumentD1(db, trace).prepare("private SQL").bind("second", 2);
  const batch = await measured.batch([first, second]);
  assert.equal(batch.length, 2);
  assert.deepEqual(await first.raw({ columnNames: true }), [["private guest name"]]);
  assert.equal(await first.first(0), "private bind");
  await first.all();
  await assert.rejects(measured.prepare("private SQL").bind("fail").run(), (error) => error === failure);
  await trace.finish("failure");
  await trace.finish("success");
  assert.equal(records.length, 1);
  assert.equal(executions.length, 5);
  assert.deepEqual(executions.slice(0, 2), [["private bind", 1], ["second", 2]]);
  assert.deepEqual(executions[2], [{ columnNames: true }]);
  assert.equal(records[0].performance.d1Count, 5);
  assert.equal(records[0].performance.d1Statements, 6);
  assert.equal(records[0].performance.d1Failures, 1);
  assert.equal(records[0].performance.d1MetaCount, 3);
  assert.equal(records[0].performance.d1RowsRead, 9);
  assert.equal(records[0].performance.d1RowsWritten, 3);
  assert.doesNotMatch(JSON.stringify(records), /private|second|SELECT/);
});

test("browser diagnostics omit credentials, paths outside the route allowlist, and third party requests", () => {
  const entry = {
    name: "https://example.test/guest?token=secret&ownerKey=private&_rsc=private#secret",
    entryType: "resource", initiatorType: "fetch", duration: 130,
    requestStart: 10, responseStart: 110, responseEnd: 130, transferSize: 512,
    serverTiming: [{ name: "middleware", duration: 40 }, { name: "request", description: "trace-123" }],
  };
  assert.deepEqual(browserTimingRecord(entry, "https://example.test"), {
    event: "browser.request", route: "/guest", kind: "rsc", durationMs: 130,
    ttfbMs: 100, downloadMs: 20, transferBytes: 512, middlewareMs: 40, requestId: "trace-123",
  });
  assert.equal(browserTimingRecord(entry, "https://other.test"), null);
  assert.equal(browserTimingRecord({ ...entry, initiatorType: "script" }, "https://example.test"), null);
  const record = browserTimingRecord({ ...entry, name: "https://example.test/private-token" }, "https://example.test");
  assert.equal(record.route, "other");
  assert.doesNotMatch(JSON.stringify(record), /private|secret/);
  assert.doesNotThrow(() => beginBrowserLoading()("ready"));
});
