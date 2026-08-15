import { isBusinessDate } from "../events/domain.ts";
import { isDateInAnalyticsRange } from "./period.ts";
import { summarizeAnalyticsGuestDays } from "./metrics.ts";
import type {
  AnalyticsAggregate,
  AnalyticsContributorDirectoryInput,
  AnalyticsContributorRow,
  AnalyticsContributorSnapshotInput,
  AnalyticsDateRange,
  AnalyticsGuestDayInput,
} from "./types.ts";

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function assertMetricCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Contributor snapshot counts must be non-negative safe integers");
  }
}

export function summarizeAnalyticsSnapshotPeriod(
  events: readonly (AnalyticsGuestDayInput & { eventId: string })[],
  range: AnalyticsDateRange,
): AnalyticsAggregate {
  const eventIds = new Set<string>();
  const days = new Map<string, AnalyticsGuestDayInput>();
  for (const event of events) {
    if (!event.eventId || eventIds.has(event.eventId)) {
      throw new Error("Analytics event snapshots must have unique event IDs");
    }
    eventIds.add(event.eventId);
    if (!isDateInAnalyticsRange(event.businessDate, range)) continue;
    const day = days.get(event.businessDate) ?? {
      businessDate: event.businessDate,
      registered: 0,
      checkedIn: 0,
    };
    day.registered += event.registered;
    day.checkedIn += event.checkedIn;
    days.set(event.businessDate, day);
  }
  return summarizeAnalyticsGuestDays([...days.values()]);
}

export function aggregateContributorSnapshots(
  metrics: readonly AnalyticsContributorSnapshotInput[],
  contributors: readonly AnalyticsContributorDirectoryInput[],
): AnalyticsContributorRow[] {
  const contributorDirectory = new Map(
    contributors.map((contributor) => [contributor.id, contributor]),
  );
  const seenSources = new Set<string>();
  const groups = new Map<
    string,
    {
      contributorId: string | null;
      source: AnalyticsContributorRow["source"];
      operatingDates: Set<string>;
      registered: number;
      checkedIn: number;
    }
  >();

  for (const metric of metrics) {
    assertMetricCount(metric.registeredCount);
    assertMetricCount(metric.checkedInCount);
    if (metric.checkedInCount > metric.registeredCount) {
      throw new RangeError("Contributor checked-in count cannot exceed registered count");
    }
    const sourceKey = `${metric.eventId}:${metric.sourceKind}:${metric.sourceId}`;
    if (
      !metric.eventId ||
      !isBusinessDate(metric.businessDate) ||
      !metric.sourceId ||
      seenSources.has(sourceKey)
    ) {
      throw new Error("Contributor snapshot sources must be unique per event");
    }
    seenSources.add(sourceKey);

    const groupKey = metric.contributorId
      ? `contributor:${metric.contributorId}`
      : `source:${metric.sourceKind}:${metric.sourceId}`;
    const group = groups.get(groupKey) ?? {
      contributorId: metric.contributorId,
      source: metric.contributorId
        ? null
        : { kind: metric.sourceKind, id: metric.sourceId },
      operatingDates: new Set<string>(),
      registered: 0,
      checkedIn: 0,
    };
    group.operatingDates.add(metric.businessDate);
    group.registered += metric.registeredCount;
    group.checkedIn += metric.checkedInCount;
    assertMetricCount(group.registered);
    assertMetricCount(group.checkedIn);
    groups.set(groupKey, group);
  }

  return [...groups.values()]
    .map((group): AnalyticsContributorRow => {
      const contributor = group.contributorId
        ? contributorDirectory.get(group.contributorId)
        : null;
      const operatingDays = group.operatingDates.size;
      return {
        contributorId: group.contributorId,
        displayName: contributor?.displayName ?? "",
        sourceStatus: group.contributorId
          ? contributor
            ? "mapped"
            : "deleted"
          : "unmapped",
        source: group.source,
        operatingDays,
        registered: group.registered,
        checkedIn: group.checkedIn,
        entryRatePercent:
          group.registered === 0
            ? null
            : roundOne((group.checkedIn / group.registered) * 100),
        registeredPerOperatingDay:
          operatingDays === 0 ? null : roundOne(group.registered / operatingDays),
      };
    })
    .sort(
      (left, right) =>
        right.checkedIn - left.checkedIn ||
        right.registered - left.registered ||
        left.displayName.localeCompare(right.displayName) ||
        (left.contributorId ?? left.source?.id ?? "").localeCompare(
          right.contributorId ?? right.source?.id ?? "",
        ),
    );
}
