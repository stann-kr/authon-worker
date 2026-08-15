import { isBusinessDate } from "../events/domain.ts";
import type {
  AnalyticsAggregate,
  AnalyticsCoverage,
  AnalyticsCoverageEventInput,
  AnalyticsGuestDayInput,
  AnalyticsMetricComparison,
  AnalyticsSummary,
} from "./types.ts";

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function addSafeCounts(left: number, right: number, label: string): number {
  const result = left + right;
  assertCount(result, label);
  return result;
}

export function summarizeAnalyticsGuestDays(
  days: readonly AnalyticsGuestDayInput[],
): AnalyticsAggregate {
  const operatingDates = new Set<string>();
  let registered = 0;
  let checkedIn = 0;

  for (const day of days) {
    if (
      !isBusinessDate(day.businessDate) ||
      operatingDates.has(day.businessDate)
    ) {
      throw new Error("Analytics guest days must have unique valid business dates");
    }
    assertCount(day.registered, "Registered count");
    assertCount(day.checkedIn, "Checked-in count");
    if (day.registered === 0) {
      throw new RangeError("Analytics guest days require at least one registration");
    }
    if (day.checkedIn > day.registered) {
      throw new RangeError("Checked-in count cannot exceed registered count");
    }
    operatingDates.add(day.businessDate);
    registered = addSafeCounts(registered, day.registered, "Registered total");
    checkedIn = addSafeCounts(checkedIn, day.checkedIn, "Checked-in total");
  }

  const operatingDays = operatingDates.size;
  return {
    operatingDays,
    registered,
    checkedIn,
    noShow: registered - checkedIn,
    entryRatePercent:
      registered === 0 ? null : roundOne((checkedIn / registered) * 100),
    registeredPerOperatingDay:
      operatingDays === 0 ? null : roundOne(registered / operatingDays),
    checkedInPerOperatingDay:
      operatingDays === 0 ? null : roundOne(checkedIn / operatingDays),
  };
}

export function compareAnalyticsMetric(
  value: number | null,
  comparisonValue: number | null,
  deltaKind: AnalyticsMetricComparison["deltaKind"],
): AnalyticsMetricComparison {
  if (value === null || comparisonValue === null) {
    return {
      value,
      comparisonValue,
      delta: null,
      relativeChangePercent: null,
      deltaKind,
      status: "not_calculable",
    };
  }

  const delta = roundOne(value - comparisonValue);
  if (deltaKind === "percentage_point") {
    return {
      value,
      comparisonValue,
      delta,
      relativeChangePercent: null,
      deltaKind,
      status: "available",
    };
  }

  if (comparisonValue === 0) {
    return {
      value,
      comparisonValue,
      delta,
      relativeChangePercent: null,
      deltaKind,
      status: "zero_baseline",
    };
  }

  return {
    value,
    comparisonValue,
    delta,
    relativeChangePercent: roundOne((delta / comparisonValue) * 100),
    deltaKind,
    status: "available",
  };
}

export function buildAnalyticsSummary(
  current: AnalyticsAggregate,
  comparison: AnalyticsAggregate,
): AnalyticsSummary {
  return {
    registered: compareAnalyticsMetric(
      current.registered,
      comparison.registered,
      "number",
    ),
    checkedIn: compareAnalyticsMetric(
      current.checkedIn,
      comparison.checkedIn,
      "number",
    ),
    entryRatePercent: compareAnalyticsMetric(
      current.entryRatePercent,
      comparison.entryRatePercent,
      "percentage_point",
    ),
    registeredPerOperatingDay: compareAnalyticsMetric(
      current.registeredPerOperatingDay,
      comparison.registeredPerOperatingDay,
      "number",
    ),
  };
}

export function calculateAnalyticsCoverage(
  events: readonly AnalyticsCoverageEventInput[],
  guestCoverage: { operatingDays: number; mapped: number; total: number },
): AnalyticsCoverage {
  const eventIds = new Set<string>();
  let confirmedEvents = 0;
  let unconfirmedClosedEvents = 0;
  let openEvents = 0;
  let draftEvents = 0;
  let driftedEvents = 0;
  let legacyEvents = 0;

  for (const event of events) {
    if (!event.eventId || eventIds.has(event.eventId)) {
      throw new Error("Analytics coverage events must have unique event IDs");
    }
    if (!isBusinessDate(event.businessDate)) {
      throw new RangeError("Analytics coverage event has an invalid business date");
    }
    eventIds.add(event.eventId);

    if (event.closeoutStatus === "confirmed" || event.closeoutStatus === "drifted") {
      confirmedEvents += 1;
      if (event.closeoutStatus === "drifted") driftedEvents += 1;
      continue;
    }
    if (event.closeoutStatus === "legacy_unlinked") {
      legacyEvents += 1;
      continue;
    }
    if (event.state === "closed" || event.state === "archived") {
      unconfirmedClosedEvents += 1;
    } else if (event.state === "open") {
      openEvents += 1;
    } else {
      draftEvents += 1;
    }
  }

  assertCount(guestCoverage.operatingDays, "Operating day count");
  assertCount(guestCoverage.mapped, "Mapped contributor count");
  assertCount(guestCoverage.total, "Contributor count");
  if (guestCoverage.mapped > guestCoverage.total) {
    throw new RangeError("Mapped contributor count cannot exceed total count");
  }
  const mappedContributorPercent =
    guestCoverage.total === 0
      ? null
      : roundOne((guestCoverage.mapped / guestCoverage.total) * 100);

  return {
    confirmedEvents,
    operatingDays: guestCoverage.operatingDays,
    unconfirmedClosedEvents,
    openEvents,
    draftEvents,
    driftedEvents,
    legacyEvents,
    mappedContributorPercent,
  };
}
