import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { readApi } from "./read-client.ts";
import { createReadHandler, readBoolean, readString } from "./read-handler.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("independent reads start together and a slow read does not hold the next response", async () => {
  const pending = new Map();
  globalThis.fetch = (url, options) => new Promise((resolve) => {
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    pending.set(url, resolve);
  });
  const slow = readApi("/slow", {});
  const fast = readApi("/fast", {});
  assert.equal(pending.size, 2);
  pending.get("/fast")(Response.json({ data: "fast", error: null }));
  assert.deepEqual(await fast, { data: "fast", error: null });
  pending.get("/slow")(Response.json({ data: "slow", error: null }));
  await slow;
});

test("transport rejects failed HTTP and malformed JSON instead of reporting empty success", async () => {
  for (const response of [new Response("Denied", { status: 403 }), new Response("<html>Login</html>")]) {
    globalThis.fetch = async () => response;
    await assert.rejects(readApi("/read", {}));
  }
});

test("read handler rejects malformed parameters and never leaks thrown details", async () => {
  const handler = createReadHandler(async (params) => {
    readString(params, "date");
    readBoolean(params, "includeArchived");
    if (params.fail) throw new Error("private database details");
    return { data: [], error: null };
  });
  for (const [body, status, error] of [
    ["{", 400, "INVALID_READ_REQUEST"],
    ["[]", 400, "INVALID_READ_REQUEST"],
    [JSON.stringify({ date: [] }), 400, "INVALID_READ_REQUEST"],
    [JSON.stringify({ date: "x".repeat(257) }), 400, "INVALID_READ_REQUEST"],
    [JSON.stringify({ includeArchived: "true" }), 400, "INVALID_READ_REQUEST"],
    [JSON.stringify({ fail: true }), 500, "READ_REQUEST_FAILED"],
  ]) {
    const response = await handler(new Request("https://example.test/read", { method: "POST", body }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { data: null, error });
  }
});

// Exercise the actual client -> route wiring while replacing the existing,
// separately tested authenticated server facades at their public boundary.
await import("tsx");
const actions = {
  guests: ["fetchGuestsByDate"],
  "guest-snapshots": ["fetchGuestOperationsSnapshot", "fetchGuestWorkspaceSnapshot"],
  venues: ["fetchVenues"],
  events: ["fetchEvents"],
  "offline-door": ["fetchOfflineDoorRoster"],
  attendance: ["fetchDoorAttendanceSummary"],
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const name = specifier.replace("@/lib/api/", "");
    return actions[name]
      ? { url: `mock:read-action:${name}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("mock:read-action:")) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: actions[url.replace("mock:read-action:", "")].map((name) =>
        `export const ${name} = (...args) => globalThis.authonReadTransportAction("${name}", args);`,
      ).join("\n"),
    };
  },
});

const scope = { venueId: "venue-a", businessDate: "2026-09-12", eventId: "event-a" };
const cases = [
  ["guests/list", "guests", "fetchGuestsByDate", [scope.businessDate, scope.venueId, scope.eventId]],
  ["guest-snapshots/operations", "guest-snapshots", "fetchGuestOperationsSnapshot", [scope.businessDate, scope.venueId, scope.eventId]],
  ["guest-snapshots/workspace", "guest-snapshots", "fetchGuestWorkspaceSnapshot", [scope.businessDate, scope.venueId, scope.eventId]],
  ["venues/list", "venues", "fetchVenues", [true]],
  ["events/list", "events", "fetchEvents", [{ venueId: scope.venueId, businessDate: scope.businessDate, includeArchived: true }]],
  ["door/roster", "door", "fetchOfflineDoorRoster", [scope]],
  ["attendance/summary", "attendance", "fetchDoorAttendanceSummary", [{ scope, deviceId: "device-a" }]],
];

for (const [endpoint, capability, name, args] of cases) {
  test(`${endpoint} preserves scope and authenticated results without caching`, async () => {
    const { POST } = await import(`../../app/api/${endpoint}/route.ts`);
    const client = await import(`../${capability}/client.ts`);
    for (const result of [
      { data: null, error: "FORBIDDEN" },
      { data: [], error: null },
      { data: { guests: [], failedSections: ["quota"] }, error: "PARTIAL" },
    ]) {
      let called = false;
      globalThis.authonReadTransportAction = (actualName, actualArgs) => {
        called = true;
        assert.equal(actualName, name);
        assert.deepEqual(actualArgs, args);
        return result;
      };
      globalThis.fetch = async (url, options) => {
        assert.equal(url, `/api/${endpoint}`);
        const response = await POST(new Request(`https://example.test${url}`, options));
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        return response;
      };
      assert.deepEqual(await client[name](...args), result);
      assert.equal(called, true);
    }
  });
}
