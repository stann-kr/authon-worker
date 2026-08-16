import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../api/attendance.ts", import.meta.url), "utf8");
const persistence = await readFile(new URL("./persistence.ts", import.meta.url), "utf8");
const domain = await readFile(new URL("./domain.ts", import.meta.url), "utf8");

test("attendance actions recheck Door/Admin access, venue, date, and Event scope", () => {
  assert.match(source, /requireAccess\("door"\)/);
  assert.match(source, /requireAccess\("admin"\)/);
  assert.match(source, /requireActiveVenueId/);
  assert.match(source, /event\.venueId !== venueId/);
  assert.match(source, /event\.businessDate !== params\.scope\.businessDate/);
  assert.match(source, /getBusinessDate\(venue, new Date\(item\.occurredAt\)\)/);
});

test("attendance persistence is append-only, idempotent, and reversal scoped", () => {
  assert.match(persistence, /ON CONFLICT DO NOTHING/);
  assert.match(persistence, /payload_hash AS payloadHash/);
  assert.match(persistence, /original\.actor_user_id = \?/);
  assert.match(persistence, /original\.device_key_hash = \?/);
  assert.match(source, /ORDER BY original\.device_sequence DESC/);
  assert.match(persistence, /reversal\.reverses_activity_id = original\.id/);
  assert.equal(persistence.includes("UPDATE attendance_activity_ledger"), false);
  assert.equal(persistence.includes("DELETE FROM attendance_activity_ledger"), false);
  assert.equal(domain.includes("attendance:${params.deviceId}"), false);
});

test("manual reconciliation derives the delta in one compare-and-swap insert", () => {
  assert.match(source, /prepareAttendanceReconciliation/);
  assert.match(source, /expectedCheckedInGuests/);
  assert.match(source, /ATTENDANCE_RECONCILIATION_STALE/);
  assert.match(persistence, /WITH current_counts AS/);
  assert.match(persistence, /candidate\.checked_in_guests = \?/);
  assert.match(persistence, /candidate\.walk_ins = \?/);
  assert.match(persistence, /"total_reconciliation"/);
  assert.equal(source.includes("delta: adjustment.delta"), false);
});

test("attendance summary uses aggregate counts without visitor identity fields", () => {
  assert.match(source, /sum\(\$\{attendanceActivityLedger\.delta\}\)/);
  assert.match(source, /count\(\*\)/);
  assert.equal(source.includes("guests.name"), false);
  assert.equal(source.includes("guests.email"), false);
  assert.equal(source.includes("guests.instagram"), false);
});
