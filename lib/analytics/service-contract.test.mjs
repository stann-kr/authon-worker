import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../api/analytics.ts", import.meta.url),
  "utf8",
);

test("analytics action rechecks actor, active venue, and tenant predicates", () => {
  assert.match(source, /requireAccess\("admin"\)/);
  assert.match(source, /actor\.role !== "super_admin"/);
  assert.match(source, /eq\(venues\.active, true\)/);
  assert.match(source, /eq\(events\.venueId, venueId\)/);
  assert.match(
    source,
    /eq\(eventCloseoutContributorMetrics\.venueId, venueId\)/,
  );
});

test("analytics action keeps a fixed bounded snapshot query shape without Guest rows", () => {
  assert.equal(source.includes("guests"), false);
  assert.match(source, /Promise\.all/);
  assert.match(source, /MAX_ANALYTICS_QUERY_ROWS/);
  assert.match(source, /count\(distinct/);
  assert.match(source, /groupBy/);
});
