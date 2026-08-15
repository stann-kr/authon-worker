import assert from "node:assert/strict";
import test from "node:test";

import {
  isAnalyticsGranularity,
  isDateInAnalyticsRange,
  resolveAnalyticsPeriod,
} from "./period.ts";

test("a completed calendar month compares with the complete previous month", () => {
  const selection = resolveAnalyticsPeriod({
    granularity: "month",
    anchorDate: "2026-08-14",
    timezone: "Asia/Seoul",
    now: new Date("2026-09-15T03:00:00.000Z"),
  });

  assert.deepEqual(selection.period, {
    granularity: "month",
    startDate: "2026-08-01",
    endDateExclusive: "2026-09-01",
    dataEndDateExclusive: "2026-09-01",
    status: "complete",
  });
  assert.deepEqual(selection.comparisonPeriod, {
    startDate: "2026-07-01",
    endDateExclusive: "2026-08-01",
  });
  assert.deepEqual(selection.navigation, {
    previousAnchorDate: "2026-07-01",
    nextAnchorDate: "2026-09-01",
  });
});

test("an in-progress month compares through the same day of the previous month", () => {
  const selection = resolveAnalyticsPeriod({
    granularity: "month",
    anchorDate: "2026-08-01",
    timezone: "Asia/Seoul",
    now: new Date("2026-08-14T03:00:00.000Z"),
  });

  assert.equal(selection.currentDate, "2026-08-14");
  assert.equal(selection.period.status, "in_progress");
  assert.equal(selection.period.dataEndDateExclusive, "2026-08-15");
  assert.deepEqual(selection.comparisonPeriod, {
    startDate: "2026-07-01",
    endDateExclusive: "2026-07-15",
  });
  assert.equal(selection.navigation.nextAnchorDate, null);
});

test("quarter and year comparisons preserve calendar progress with month-end clamping", () => {
  const quarter = resolveAnalyticsPeriod({
    granularity: "quarter",
    anchorDate: "2026-08-14",
    timezone: "Asia/Seoul",
    now: new Date("2026-08-14T03:00:00.000Z"),
  });
  assert.deepEqual(quarter.comparisonPeriod, {
    startDate: "2026-04-01",
    endDateExclusive: "2026-05-15",
  });

  const leapYear = resolveAnalyticsPeriod({
    granularity: "year",
    anchorDate: "2028-02-29",
    timezone: "Asia/Seoul",
    now: new Date("2028-02-29T03:00:00.000Z"),
  });
  assert.deepEqual(leapYear.comparisonPeriod, {
    startDate: "2027-01-01",
    endDateExclusive: "2027-03-01",
  });

  const monthEnd = resolveAnalyticsPeriod({
    granularity: "month",
    anchorDate: "2026-03-31",
    timezone: "Asia/Seoul",
    now: new Date("2026-03-31T03:00:00.000Z"),
  });
  assert.deepEqual(monthEnd.comparisonPeriod, {
    startDate: "2026-02-01",
    endDateExclusive: "2026-03-01",
  });

  const firstQuarter = resolveAnalyticsPeriod({
    granularity: "quarter",
    anchorDate: "2027-01-10",
    timezone: "Asia/Seoul",
    now: new Date("2027-01-10T03:00:00.000Z"),
  });
  assert.deepEqual(firstQuarter.comparisonPeriod, {
    startDate: "2026-10-01",
    endDateExclusive: "2026-10-11",
  });
});

test("the current calendar day is resolved independently in each venue timezone", () => {
  const instant = new Date("2026-08-31T15:30:00.000Z");
  assert.equal(
    resolveAnalyticsPeriod({
      granularity: "month",
      anchorDate: "2026-09-01",
      timezone: "Asia/Seoul",
      now: instant,
    }).currentDate,
    "2026-09-01",
  );
  assert.throws(() =>
    resolveAnalyticsPeriod({
      granularity: "month",
      anchorDate: "2026-09-01",
      timezone: "America/New_York",
      now: instant,
    }),
  );
});

test("period inputs reject invalid or future scope and date ranges are half-open", () => {
  const current = {
    startDate: "2026-08-01",
    endDateExclusive: "2026-09-01",
  };
  assert.equal(isAnalyticsGranularity("quarter"), true);
  assert.equal(isAnalyticsGranularity("week"), false);
  assert.equal(isDateInAnalyticsRange("2026-08-01", current), true);
  assert.equal(isDateInAnalyticsRange("2026-09-01", current), false);
  assert.equal(isDateInAnalyticsRange("2026-02-30", current), false);
  assert.throws(() =>
    resolveAnalyticsPeriod({
      granularity: "month",
      anchorDate: "2026-09-01",
      timezone: "Asia/Seoul",
      now: new Date("2026-08-14T03:00:00.000Z"),
    }),
  );
  assert.throws(() =>
    resolveAnalyticsPeriod({
      granularity: "month",
      anchorDate: "2026-02-30",
      timezone: "Asia/Seoul",
    }),
  );
  assert.throws(() =>
    resolveAnalyticsPeriod({
      granularity: "month",
      anchorDate: "2026-08-01",
      timezone: "Seoul",
    }),
  );
});
