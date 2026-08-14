import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNightCloseout,
  closeoutHashPayload,
  nightCloseoutToCsv,
} from "./domain.ts";

const EVENT = {
  id: "event-a",
  state: "closed",
  doorOpensAt: "2026-08-13T21:00:00.000Z",
  createdAt: "2026-08-10T12:00:00.000Z",
  openedAt: "2026-08-13T20:45:00.000Z",
  closedAt: "2026-08-14T03:00:00.000Z",
};

function activity(guestId, action, occurredAt, overrides = {}) {
  return {
    guestId,
    action,
    outcome: "applied",
    nextStatus: null,
    channel: "door",
    occurredAt,
    ...overrides,
  };
}

test("closeout matches current roster with ordered ledger replay", () => {
  const report = buildNightCloseout({
    event: EVENT,
    guests: [
      { id: "one", status: "checked", createdByUserId: "user-a", createdAt: "2026-08-13T18:00:00.000Z" },
      { id: "two", status: "pending", createdByUserId: "user-a", createdAt: "2026-08-13T18:01:00.000Z" },
      { id: "three", status: "checked", externalLinkId: "link-a", createdAt: "2026-08-13T18:02:00.000Z" },
      { id: "removed", status: "deleted", createdByUserId: "user-a", createdAt: "2026-08-13T18:03:00.000Z" },
    ],
    activities: [
      activity("one", "add", "2026-08-13T18:00:00.000Z", { channel: "guest" }),
      activity("two", "add", "2026-08-13T18:01:00.000Z", { channel: "guest" }),
      activity("three", "add", "2026-08-13T21:01:00.000Z", { channel: "door" }),
      activity("removed", "add", "2026-08-13T18:03:00.000Z", { channel: "guest" }),
      activity("removed", "delete", "2026-08-13T19:00:00.000Z", { nextStatus: "deleted" }),
      activity("one", "check_in", "2026-08-13T21:02:00.000Z", { nextStatus: "checked" }),
      activity("one", "cancel_check_in", "2026-08-13T21:04:00.000Z", { nextStatus: "pending" }),
      activity("one", "re_entry", "2026-08-13T21:06:00.000Z", { nextStatus: "checked" }),
      activity("three", "check_in", "2026-08-13T21:08:00.000Z", { nextStatus: "checked" }),
      activity("two", "check_in", "2026-08-13T21:20:00.000Z", { outcome: "rejected" }),
    ],
    contributors: [
      { kind: "user", id: "user-a", label: "DJ A", baseLimit: 3, approvedExtra: 1 },
      { kind: "external_link", id: "link-a", label: "Link A", baseLimit: 2 },
    ],
    confirmedAt: "2026-08-14T03:05:00.000Z",
  });

  assert.equal(report.status, "confirmed");
  assert.deepEqual(
    {
      registered: report.registered,
      checkedIn: report.checkedIn,
      noShow: report.noShow,
      entryRatePercent: report.entryRatePercent,
      removals: report.guestRemovals,
      cancellations: report.checkInCancellations,
      reEntries: report.reEntries,
      onSiteAdds: report.onSiteAdds,
    },
    {
      registered: 3,
      checkedIn: 2,
      noShow: 1,
      entryRatePercent: 66.7,
      removals: 1,
      cancellations: 1,
      reEntries: 1,
      onSiteAdds: 1,
    },
  );
  assert.deepEqual(report.peak15Minutes, {
    startedAt: "2026-08-13T21:00:00.000Z",
    entries: 3,
  });
  assert.equal(report.ledger.invariantMismatchCount, 0);
  assert.equal(report.ledger.untrackedGuestCount, 0);
  assert.equal(report.timing.preparationSeconds, 290700);
  assert.equal(report.timing.confirmationSeconds, 300);
  assert.deepEqual(
    report.contributors.map(({ label, checkedIn, sampleSize, effectiveLimit }) => ({
      label,
      checkedIn,
      sampleSize,
      effectiveLimit,
    })),
    [
      { label: "DJ A", checkedIn: 1, sampleSize: 2, effectiveLimit: 4 },
      { label: "Link A", checkedIn: 1, sampleSize: 1, effectiveLimit: 2 },
    ],
  );
});

test("ledger/read-model mismatch blocks a ready report", () => {
  const report = buildNightCloseout({
    event: EVENT,
    guests: [{ id: "one", status: "pending", createdAt: EVENT.createdAt }],
    activities: [
      activity("one", "add", EVENT.createdAt),
      activity("one", "check_in", EVENT.openedAt, { nextStatus: "checked" }),
    ],
  });
  assert.equal(report.status, "inconsistent");
  assert.equal(report.ledger.invariantMismatchCount, 1);
});

test("same-timestamp activities replay in immutable insertion sequence", () => {
  const report = buildNightCloseout({
    event: EVENT,
    guests: [{ id: "one", status: "pending", createdAt: EVENT.createdAt }],
    activities: [
      { ...activity("one", "add", EVENT.openedAt), sequence: 1 },
      { ...activity("one", "check_in", EVENT.openedAt), sequence: 2 },
      { ...activity("one", "cancel_check_in", EVENT.openedAt), sequence: 3 },
    ],
  });
  assert.equal(report.ledger.invariantMismatchCount, 0);
});

test("CSV exports aggregates and neutralizes spreadsheet formulas", () => {
  const report = buildNightCloseout({
    event: EVENT,
    guests: [{ id: "one", status: "checked", createdByUserId: "user-a", createdAt: EVENT.createdAt }],
    activities: [
      activity("one", "add", EVENT.createdAt),
      activity("one", "check_in", EVENT.openedAt),
    ],
    contributors: [{ kind: "user", id: "user-a", label: "=IMPORTDATA(1)", baseLimit: null }],
  });
  const csv = nightCloseoutToCsv(report);
  assert.match(csv, /contributor,user,'=IMPORTDATA\(1\),1,1,0,100,1/);
  assert.equal(csv.includes("one"), false);
  assert.equal(closeoutHashPayload(report).includes("=IMPORTDATA"), false);

  const relabeled = buildNightCloseout({
    event: EVENT,
    guests: [{ id: "one", status: "checked", createdByUserId: "user-a", createdAt: EVENT.createdAt }],
    activities: [
      activity("one", "add", EVENT.createdAt),
      activity("one", "check_in", EVENT.openedAt),
    ],
    contributors: [{ kind: "user", id: "user-a", label: "Renamed", baseLimit: null }],
  });
  assert.equal(closeoutHashPayload(relabeled), closeoutHashPayload(report));
});

test("ten thousand activities aggregate within the closeout budget", () => {
  const guests = Array.from({ length: 5_000 }, (_, index) => ({
    id: `guest-${index}`,
    status: "checked",
    createdAt: EVENT.createdAt,
  }));
  const activities = guests.flatMap((guest, index) => [
    activity(guest.id, "add", EVENT.createdAt),
    activity(guest.id, "check_in", `2026-08-13T21:${String(index % 60).padStart(2, "0")}:00.000Z`),
  ]);
  const startedAt = performance.now();
  const report = buildNightCloseout({ event: EVENT, guests, activities });
  const duration = performance.now() - startedAt;
  assert.equal(report.checkedIn, 5_000);
  assert.equal(report.ledger.invariantMismatchCount, 0);
  assert.ok(duration < 1_000, `closeout took ${duration.toFixed(1)}ms`);
});
