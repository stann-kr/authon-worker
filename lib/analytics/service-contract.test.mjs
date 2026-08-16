import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../api/analytics.ts", import.meta.url),
  "utf8",
);
const attendanceUi = await readFile(
  new URL("../../app/admin/components/analytics/AnalyticsAttendance.tsx", import.meta.url),
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
  assert.match(source, /eq\(guests\.venueId, venueId\)/);
  assert.match(
    source,
    /eq\(attendanceActivityLedger\.venueId, venueId\)/,
  );
});

test("analytics action aggregates anonymous walk-in deltas by business date", () => {
  assert.match(source, /from\(attendanceActivityLedger\)/);
  assert.match(source, /sum\(\$\{attendanceActivityLedger\.delta\}\)/);
  assert.match(source, /groupBy\(attendanceActivityLedger\.businessDate\)/);
  assert.equal(source.includes("attendanceActivityLedger.actorUserId"), false);
  assert.equal(source.includes("attendanceActivityLedger.deviceKeyHash"), false);
});

test("analytics action aggregates guest dates without returning guest identity fields", () => {
  assert.match(source, /Promise\.all/);
  assert.match(source, /MAX_ANALYTICS_QUERY_ROWS/);
  assert.match(source, /from\(guests\)/);
  assert.match(source, /groupBy\(guests\.date\)/);
  assert.match(source, /count\(distinct/);
  assert.match(source, /ne\(guests\.status, "deleted"\)/);
  assert.equal(source.includes("guests.name"), false);
  assert.equal(source.includes("guests.email"), false);
  assert.equal(source.includes("guests.instagram"), false);
});

test("analytics action returns tenant-scoped source names without name-based grouping", () => {
  assert.match(source, /externalDjLinks\.djName/);
  assert.match(source, /users\.name/);
  assert.match(source, /contributorSourceKindGroup/);
  assert.match(source, /contributorSourceIdGroup/);
  assert.match(
    source,
    /groupBy\(\s*guestContributorId,\s*contributorSourceKindGroup,\s*contributorSourceIdGroup,/,
  );
});

test("attendance analytics pairs its visual trend with a semantic data table", () => {
  assert.match(attendanceUi, /aria-hidden="true"/);
  assert.match(attendanceUi, /<table/);
  assert.match(attendanceUi, /<caption className="sr-only">/);
  assert.match(attendanceUi, /<th scope="col"/);
  assert.match(attendanceUi, /<th scope="row"/);
  assert.match(attendanceUi, /isAnimationActive=\{false\}/);
});
