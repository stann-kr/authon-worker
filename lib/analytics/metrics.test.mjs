import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnalyticsSummary,
  calculateAnalyticsCoverage,
  compareAnalyticsMetric,
  summarizeAnalyticsGuestDays,
} from "./metrics.ts";
import {
  EMPTY_ANALYTICS_DTO_FIXTURE,
  WEEKDAY_GUEST_DAY_FIXTURE,
  WEEKEND_GUEST_DAY_FIXTURE,
} from "./test-fixtures.ts";

test("weekend and weekday venues use actual guest-bearing days", () => {
  assert.deepEqual(summarizeAnalyticsGuestDays(WEEKEND_GUEST_DAY_FIXTURE), {
    operatingDays: 8,
    registered: 400,
    checkedIn: 320,
    noShow: 80,
    entryRatePercent: 80,
    registeredPerOperatingDay: 50,
    checkedInPerOperatingDay: 40,
  });
  assert.deepEqual(summarizeAnalyticsGuestDays(WEEKDAY_GUEST_DAY_FIXTURE), {
    operatingDays: 20,
    registered: 400,
    checkedIn: 300,
    noShow: 100,
    entryRatePercent: 75,
    registeredPerOperatingDay: 20,
    checkedInPerOperatingDay: 15,
  });
});

test("entry rate is weighted from total registrations rather than averaged per day", () => {
  const aggregate = summarizeAnalyticsGuestDays([
    { businessDate: "2026-08-01", registered: 1, checkedIn: 1 },
    { businessDate: "2026-08-02", registered: 9, checkedIn: 1 },
  ]);
  assert.equal(aggregate.entryRatePercent, 20);
  assert.equal(aggregate.operatingDays, 2);
});

test("relative and percentage-point comparisons keep zero baselines explicit", () => {
  assert.deepEqual(compareAnalyticsMetric(12, 0, "number"), {
    value: 12,
    comparisonValue: 0,
    delta: 12,
    relativeChangePercent: null,
    deltaKind: "number",
    status: "zero_baseline",
  });
  assert.deepEqual(compareAnalyticsMetric(78.2, 75, "percentage_point"), {
    value: 78.2,
    comparisonValue: 75,
    delta: 3.2,
    relativeChangePercent: null,
    deltaKind: "percentage_point",
    status: "available",
  });
  assert.equal(compareAnalyticsMetric(110, 100, "number").relativeChangePercent, 10);
  assert.equal(compareAnalyticsMetric(null, 0, "number").status, "not_calculable");
});

test("empty guest-day data distinguishes actual zero counts from incalculable rates", () => {
  const empty = summarizeAnalyticsGuestDays([]);
  assert.deepEqual(empty, {
    operatingDays: 0,
    registered: 0,
    checkedIn: 0,
    noShow: 0,
    entryRatePercent: null,
    registeredPerOperatingDay: null,
    checkedInPerOperatingDay: null,
  });
  assert.deepEqual(buildAnalyticsSummary(empty, empty), EMPTY_ANALYTICS_DTO_FIXTURE.summary);
});

test("coverage keeps confirmed, unconfirmed, drifted, open, draft, and legacy events separate", () => {
  const coverage = calculateAnalyticsCoverage(
    [
      { eventId: "confirmed", businessDate: "2026-08-01", state: "closed", closeoutStatus: "confirmed" },
      { eventId: "drifted", businessDate: "2026-08-01", state: "archived", closeoutStatus: "drifted" },
      { eventId: "missing", businessDate: "2026-08-02", state: "closed", closeoutStatus: "missing" },
      { eventId: "open", businessDate: "2026-08-03", state: "open", closeoutStatus: "missing" },
      { eventId: "draft", businessDate: "2026-08-04", state: "draft", closeoutStatus: "missing" },
      { eventId: "legacy", businessDate: "2026-08-05", state: "archived", closeoutStatus: "legacy_unlinked" },
    ],
    { operatingDays: 5, mapped: 7, total: 10 },
  );
  assert.deepEqual(coverage, {
    confirmedEvents: 2,
    operatingDays: 5,
    unconfirmedClosedEvents: 1,
    openEvents: 1,
    draftEvents: 1,
    driftedEvents: 1,
    legacyEvents: 1,
    mappedContributorPercent: 70,
  });
});

test("invalid or duplicated guest days fail closed before an aggregate is returned", () => {
  assert.throws(() =>
    summarizeAnalyticsGuestDays([
      { businessDate: "2026-08-01", registered: 1, checkedIn: 2 },
    ]),
  );
  assert.throws(() =>
    summarizeAnalyticsGuestDays([
      { businessDate: "2026-08-01", registered: 1, checkedIn: 1 },
      { businessDate: "2026-08-01", registered: 1, checkedIn: 1 },
    ]),
  );
  assert.throws(() =>
    summarizeAnalyticsGuestDays([
      {
        businessDate: "2026-08-01",
        registered: Number.MAX_SAFE_INTEGER,
        checkedIn: 0,
      },
      { businessDate: "2026-08-02", registered: 1, checkedIn: 0 },
    ]),
  );
  assert.throws(() =>
    calculateAnalyticsCoverage([], { operatingDays: 1, mapped: 2, total: 1 }),
  );
});

test("the API DTO fixture contains aggregates only and no guest source fields", () => {
  const serialized = JSON.stringify(EMPTY_ANALYTICS_DTO_FIXTURE);
  assert.equal(serialized.includes("guestName"), false);
  assert.equal(serialized.includes("email"), false);
  assert.equal(serialized.includes("instagram"), false);
  assert.equal(serialized.includes("linkToken"), false);
});
