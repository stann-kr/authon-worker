import { isBusinessDate, isEventState } from "../events/domain.ts";
import { buildAnalyticsSummary, calculateAnalyticsCoverage } from "./metrics.ts";
import { isDateInAnalyticsRange } from "./period.ts";
import { summarizeAnalyticsSnapshotPeriod } from "./snapshots.ts";
import type {
  AdminAnalyticsView,
  AnalyticsContributorRow,
  AnalyticsPeriodSelection,
  AnalyticsTrendPoint,
} from "./types.ts";

export const ANALYTICS_EVENT_TABLE_LIMIT = 100;

export interface AnalyticsServiceEventRow {
  eventId: string;
  businessDate: string;
  name: string;
  state: string;
  compatibilityKey: string | null;
  confirmedAt: string | null;
  registeredCount: number | null;
  checkedInCount: number | null;
  contributorRegisteredCount: number;
  contributorCheckedInCount: number;
}

export interface AnalyticsServiceContributorRow {
  contributorId: string | null;
  displayName: string | null;
  sourceKind: string;
  sourceId: string;
  events: number;
  registered: number;
  checkedIn: number;
  snapshotRows: number;
}

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function assertEventRows(
  rows: readonly AnalyticsServiceEventRow[],
): void {
  const eventIds = new Set<string>();
  for (const row of rows) {
    if (
      !row.eventId ||
      eventIds.has(row.eventId) ||
      !isBusinessDate(row.businessDate) ||
      !isEventState(row.state)
    ) {
      throw new Error("Analytics service received an invalid event row");
    }
    eventIds.add(row.eventId);
    if (row.confirmedAt === null) {
      if (
        row.registeredCount !== null ||
        row.checkedInCount !== null ||
        row.contributorRegisteredCount !== 0 ||
        row.contributorCheckedInCount !== 0
      ) {
        throw new Error("Unconfirmed analytics events cannot contain totals");
      }
      continue;
    }
    if (row.registeredCount === null || row.checkedInCount === null) {
      throw new Error("Confirmed analytics events require snapshot totals");
    }
    assertCount(row.registeredCount, "Registered count");
    assertCount(row.checkedInCount, "Checked-in count");
    assertCount(
      row.contributorRegisteredCount,
      "Contributor registered total",
    );
    assertCount(
      row.contributorCheckedInCount,
      "Contributor checked-in total",
    );
    if (row.checkedInCount > row.registeredCount) {
      throw new RangeError("Checked-in count cannot exceed registered count");
    }
    if (row.contributorCheckedInCount > row.contributorRegisteredCount) {
      throw new RangeError(
        "Contributor checked-in total cannot exceed registered total",
      );
    }
  }
}

function hasContributorSnapshotDrift(row: AnalyticsServiceEventRow): boolean {
  return (
    row.confirmedAt !== null &&
    (row.registeredCount !== row.contributorRegisteredCount ||
      row.checkedInCount !== row.contributorCheckedInCount)
  );
}

function toConfirmedSnapshot(row: AnalyticsServiceEventRow) {
  if (
    row.confirmedAt === null ||
    row.registeredCount === null ||
    row.checkedInCount === null
  ) {
    return null;
  }
  return {
    eventId: row.eventId,
    businessDate: row.businessDate,
    registered: row.registeredCount,
    checkedIn: row.checkedInCount,
  };
}

function buildTrend(
  rows: readonly AnalyticsServiceEventRow[],
  selection: AnalyticsPeriodSelection,
): AnalyticsTrendPoint[] {
  const buckets = new Map<string, AnalyticsTrendPoint>();
  for (const row of rows) {
    const snapshot = toConfirmedSnapshot(row);
    if (
      !snapshot ||
      !isDateInAnalyticsRange(row.businessDate, selection.period)
    ) {
      continue;
    }
    const bucketStartDate =
      selection.period.granularity === "month"
        ? row.businessDate
        : `${row.businessDate.slice(0, 7)}-01`;
    const point = buckets.get(bucketStartDate) ?? {
      bucketStartDate,
      registered: 0,
      checkedIn: 0,
      eventCount: 0,
    };
    point.registered += snapshot.registered;
    point.checkedIn += snapshot.checkedIn;
    point.eventCount += 1;
    assertCount(point.registered, "Trend registered total");
    assertCount(point.checkedIn, "Trend checked-in total");
    assertCount(point.eventCount, "Trend event count");
    buckets.set(bucketStartDate, point);
  }
  return [...buckets.values()].sort((left, right) =>
    left.bucketStartDate.localeCompare(right.bucketStartDate),
  );
}

function buildContributorRows(
  rows: readonly AnalyticsServiceContributorRow[],
): AnalyticsContributorRow[] {
  const groupKeys = new Set<string>();
  return rows
    .map((row): AnalyticsContributorRow => {
      assertCount(row.events, "Contributor event count");
      assertCount(row.registered, "Contributor registered count");
      assertCount(row.checkedIn, "Contributor checked-in count");
      assertCount(row.snapshotRows, "Contributor snapshot row count");
      if (
        row.checkedIn > row.registered ||
        row.events > row.snapshotRows ||
        (row.sourceKind !== "user" &&
          row.sourceKind !== "external_link" &&
          row.sourceKind !== "unattributed")
      ) {
        throw new Error("Analytics service received an invalid contributor row");
      }
      const groupKey = row.contributorId
        ? `contributor:${row.contributorId}`
        : `source:${row.sourceKind}:${row.sourceId}`;
      if (!row.sourceId || groupKeys.has(groupKey)) {
        throw new Error("Analytics contributor groups must be unique");
      }
      groupKeys.add(groupKey);
      return {
        contributorId: row.contributorId,
        displayName: row.displayName ?? "",
        sourceStatus: row.contributorId
          ? row.displayName
            ? "mapped"
            : "deleted"
          : "unmapped",
        source: row.contributorId
          ? null
          : {
              kind: row.sourceKind,
              id: row.sourceId,
            },
        events: row.events,
        registered: row.registered,
        checkedIn: row.checkedIn,
        entryRatePercent:
          row.registered === 0
            ? null
            : roundOne((row.checkedIn / row.registered) * 100),
        registeredPerEvent:
          row.events === 0 ? null : roundOne(row.registered / row.events),
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

export function buildAdminAnalyticsView({
  selection,
  eventRows,
  contributorRows,
}: {
  selection: AnalyticsPeriodSelection;
  eventRows: readonly AnalyticsServiceEventRow[];
  contributorRows: readonly AnalyticsServiceContributorRow[];
}): AdminAnalyticsView {
  assertEventRows(eventRows);
  const confirmedSnapshots = eventRows
    .map(toConfirmedSnapshot)
    .filter((row) => row !== null);
  const currentAggregate = summarizeAnalyticsSnapshotPeriod(
    confirmedSnapshots,
    selection.period,
  );
  const comparisonAggregate = summarizeAnalyticsSnapshotPeriod(
    confirmedSnapshots,
    selection.comparisonPeriod,
  );
  const currentEvents = eventRows.filter((row) =>
    isDateInAnalyticsRange(row.businessDate, selection.period),
  );
  const mappedSnapshotRows = contributorRows.reduce(
    (total, row) => total + (row.contributorId ? row.snapshotRows : 0),
    0,
  );
  const totalSnapshotRows = contributorRows.reduce(
    (total, row) => total + row.snapshotRows,
    0,
  );
  assertCount(mappedSnapshotRows, "Mapped snapshot row total");
  assertCount(totalSnapshotRows, "Snapshot row total");

  const coverage = calculateAnalyticsCoverage(
    currentEvents.map((row) => ({
      eventId: row.eventId,
      businessDate: row.businessDate,
      state: row.state as "draft" | "open" | "closed" | "archived",
      closeoutStatus: row.confirmedAt
        ? hasContributorSnapshotDrift(row)
          ? ("drifted" as const)
          : ("confirmed" as const)
        : row.compatibilityKey
          ? ("legacy_unlinked" as const)
          : ("missing" as const),
    })),
    { mapped: mappedSnapshotRows, total: totalSnapshotRows },
  );

  return {
    period: selection.period,
    comparisonPeriod: selection.comparisonPeriod,
    navigation: selection.navigation,
    coverage,
    summary: buildAnalyticsSummary(currentAggregate, comparisonAggregate),
    trend: buildTrend(eventRows, selection),
    contributors: buildContributorRows(contributorRows),
    events: currentEvents
      .filter((row) => row.confirmedAt !== null)
      .sort(
        (left, right) =>
          right.businessDate.localeCompare(left.businessDate) ||
          right.eventId.localeCompare(left.eventId),
      )
      .slice(0, ANALYTICS_EVENT_TABLE_LIMIT)
      .map((row) => ({
        eventId: row.eventId,
        businessDate: row.businessDate,
        name: row.name,
        registered: row.registeredCount ?? 0,
        checkedIn: row.checkedInCount ?? 0,
        entryRatePercent:
          !row.registeredCount
            ? null
            : roundOne(((row.checkedInCount ?? 0) / row.registeredCount) * 100),
        confirmedAt: row.confirmedAt ?? "",
        status: hasContributorSnapshotDrift(row)
          ? ("drifted" as const)
          : ("confirmed" as const),
      })),
  };
}
