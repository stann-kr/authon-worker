import { isBusinessDate } from "../events/domain.ts";
import type {
  AnalyticsAggregate,
  AnalyticsConfirmedEventInput,
  AnalyticsCoverage,
  AnalyticsCoverageEventInput,
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

export function summarizeAnalyticsEvents(
  events: readonly AnalyticsConfirmedEventInput[],
): AnalyticsAggregate {
  const eventIds = new Set<string>();
  const operatingDates = new Set<string>();
  let registered = 0;
  let checkedIn = 0;

  for (const event of events) {
    if (!event.eventId || eventIds.has(event.eventId)) {
      throw new Error("Analytics event snapshots must have unique event IDs");
    }
    if (!isBusinessDate(event.businessDate)) {
      throw new RangeError("Analytics event has an invalid business date");
    }
    assertCount(event.registered, "Registered count");
    assertCount(event.checkedIn, "Checked-in count");
    if (event.checkedIn > event.registered) {
      throw new RangeError("Checked-in count cannot exceed registered count");
    }
    eventIds.add(event.eventId);
    operatingDates.add(event.businessDate);
    registered = addSafeCounts(registered, event.registered, "Registered total");
    checkedIn = addSafeCounts(checkedIn, event.checkedIn, "Checked-in total");
  }

  const confirmedEvents = eventIds.size;
  return {
    confirmedEvents,
    operatingDays: operatingDates.size,
    registered,
    checkedIn,
    noShow: registered - checkedIn,
    entryRatePercent:
      registered === 0 ? null : roundOne((checkedIn / registered) * 100),
    registeredPerEvent:
      confirmedEvents === 0 ? null : roundOne(registered / confirmedEvents),
    checkedInPerEvent:
      confirmedEvents === 0 ? null : roundOne(checkedIn / confirmedEvents),
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
    registeredPerEvent: compareAnalyticsMetric(
      current.registeredPerEvent,
      comparison.registeredPerEvent,
      "number",
    ),
  };
}

export function calculateAnalyticsCoverage(
  events: readonly AnalyticsCoverageEventInput[],
  contributorCounts?: { mapped: number; total: number },
): AnalyticsCoverage {
  const eventIds = new Set<string>();
  const confirmedDates = new Set<string>();
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
      confirmedDates.add(event.businessDate);
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

  let mappedContributorPercent: number | null = null;
  if (contributorCounts) {
    assertCount(contributorCounts.mapped, "Mapped contributor count");
    assertCount(contributorCounts.total, "Contributor count");
    if (contributorCounts.mapped > contributorCounts.total) {
      throw new RangeError("Mapped contributor count cannot exceed total count");
    }
    mappedContributorPercent =
      contributorCounts.total === 0
        ? null
        : roundOne((contributorCounts.mapped / contributorCounts.total) * 100);
  }

  return {
    confirmedEvents,
    operatingDays: confirmedDates.size,
    unconfirmedClosedEvents,
    openEvents,
    draftEvents,
    driftedEvents,
    legacyEvents,
    mappedContributorPercent,
  };
}
