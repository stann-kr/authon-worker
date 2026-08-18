import { isBusinessDate, isEventState } from "../events/domain.ts";
import {
  buildAnalyticsAttendanceSummary,
  buildAnalyticsSummary,
  calculateAnalyticsCoverage,
  summarizeAnalyticsAttendanceDays,
  summarizeAnalyticsGuestDays,
} from "./metrics.ts";
import { isDateInAnalyticsRange } from "./period.ts";
import type {
  AdminAnalyticsView,
  AnalyticsAttendanceDayInput,
  AnalyticsAttendanceTrendPoint,
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

export interface AnalyticsServiceGuestDayRow {
  businessDate: string;
  registeredCount: number;
  checkedInCount: number;
}

export interface AnalyticsServiceWalkInDayRow {
  businessDate: string;
  eventId: string | null;
  walkInCount: number;
}

export interface AnalyticsServiceAttendanceGuestScopeRow {
  businessDate: string;
  eventId: string | null;
  checkedInCount: number;
}

export interface AnalyticsServiceAttendanceCloseoutRow {
  businessDate: string;
  eventId: string | null;
  checkedInGuests: number;
  finalWalkIns: number;
  targetTotalAttendance: number;
}

export interface AnalyticsServiceContributorRow {
  contributorId: string | null;
  displayName: string | null;
  sourceDisplayName: string | null;
  sourceKind: string;
  sourceId: string;
  operatingDays: number;
  registered: number;
  checkedIn: number;
  guestRows: number;
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

function assertGuestDayRows(
  rows: readonly AnalyticsServiceGuestDayRow[],
): void {
  const businessDates = new Set<string>();
  for (const row of rows) {
    if (
      !isBusinessDate(row.businessDate) ||
      businessDates.has(row.businessDate)
    ) {
      throw new Error("Analytics service received an invalid guest day row");
    }
    assertCount(row.registeredCount, "Guest day registered count");
    assertCount(row.checkedInCount, "Guest day checked-in count");
    if (
      row.registeredCount === 0 ||
      row.checkedInCount > row.registeredCount
    ) {
      throw new RangeError("Analytics guest day totals are inconsistent");
    }
    businessDates.add(row.businessDate);
  }
}

function attendanceScopeKey(businessDate: string, eventId: string | null): string {
  return `${businessDate}\u0000${eventId ?? ""}`;
}

function isAttendanceScopeEventId(eventId: string | null): boolean {
  return (
    eventId === null ||
    (typeof eventId === "string" &&
      eventId.length > 0 &&
      eventId.length <= 128 &&
      !eventId.includes("\u0000"))
  );
}

function assertAttendanceGuestScopeRows(
  rows: readonly AnalyticsServiceAttendanceGuestScopeRow[],
): void {
  const scopeKeys = new Set<string>();
  for (const row of rows) {
    const scopeKey = attendanceScopeKey(row.businessDate, row.eventId);
    if (
      !isBusinessDate(row.businessDate) ||
      !isAttendanceScopeEventId(row.eventId) ||
      scopeKeys.has(scopeKey)
    ) {
      throw new Error("Analytics service received an invalid attendance guest scope");
    }
    assertCount(row.checkedInCount, "Attendance guest checked-in count");
    scopeKeys.add(scopeKey);
  }
}

function assertWalkInScopeRows(
  rows: readonly AnalyticsServiceWalkInDayRow[],
): void {
  const scopeKeys = new Set<string>();
  for (const row of rows) {
    const scopeKey = attendanceScopeKey(row.businessDate, row.eventId);
    if (
      !isBusinessDate(row.businessDate) ||
      !isAttendanceScopeEventId(row.eventId) ||
      scopeKeys.has(scopeKey)
    ) {
      throw new Error("Analytics service received an invalid walk-in scope");
    }
    assertCount(row.walkInCount, "Walk-in day count");
    scopeKeys.add(scopeKey);
  }
}

function assertAttendanceCloseoutRows(
  rows: readonly AnalyticsServiceAttendanceCloseoutRow[],
): void {
  const scopeKeys = new Set<string>();
  for (const row of rows) {
    const scopeKey = attendanceScopeKey(row.businessDate, row.eventId);
    if (
      !isBusinessDate(row.businessDate) ||
      !isAttendanceScopeEventId(row.eventId) ||
      scopeKeys.has(scopeKey)
    ) {
      throw new Error("Analytics service received an invalid attendance closeout");
    }
    assertCount(row.checkedInGuests, "Attendance closeout checked-in count");
    assertCount(row.finalWalkIns, "Attendance closeout walk-in count");
    assertCount(row.targetTotalAttendance, "Attendance closeout total");
    if (
      row.targetTotalAttendance !== row.checkedInGuests + row.finalWalkIns
    ) {
      throw new RangeError("Attendance closeout totals are inconsistent");
    }
    scopeKeys.add(scopeKey);
  }
}

function hasContributorSnapshotDrift(row: AnalyticsServiceEventRow): boolean {
  return (
    row.confirmedAt !== null &&
    (row.registeredCount !== row.contributorRegisteredCount ||
      row.checkedInCount !== row.contributorCheckedInCount)
  );
}

function buildTrend(
  rows: readonly AnalyticsServiceGuestDayRow[],
  selection: AnalyticsPeriodSelection,
): AnalyticsTrendPoint[] {
  const buckets = new Map<string, AnalyticsTrendPoint>();
  for (const row of rows) {
    if (!isDateInAnalyticsRange(row.businessDate, selection.period)) {
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
      operatingDays: 0,
    };
    point.registered += row.registeredCount;
    point.checkedIn += row.checkedInCount;
    point.operatingDays += 1;
    assertCount(point.registered, "Trend registered total");
    assertCount(point.checkedIn, "Trend checked-in total");
    assertCount(point.operatingDays, "Trend operating day count");
    buckets.set(bucketStartDate, point);
  }
  return [...buckets.values()].sort((left, right) =>
    left.bucketStartDate.localeCompare(right.bucketStartDate),
  );
}

function buildAttendanceDays(
  guestRows: readonly AnalyticsServiceAttendanceGuestScopeRow[],
  walkInRows: readonly AnalyticsServiceWalkInDayRow[],
  closeoutRows: readonly AnalyticsServiceAttendanceCloseoutRow[],
  range: AnalyticsPeriodSelection["comparisonPeriod"],
): AnalyticsAttendanceDayInput[] {
  const scopes = new Map<
    string,
    AnalyticsAttendanceDayInput & { eventId: string | null }
  >();
  const days = new Map<string, AnalyticsAttendanceDayInput>();
  for (const row of guestRows) {
    if (!isDateInAnalyticsRange(row.businessDate, range)) continue;
    scopes.set(attendanceScopeKey(row.businessDate, row.eventId), {
      businessDate: row.businessDate,
      eventId: row.eventId,
      checkedInGuests: row.checkedInCount,
      walkIns: 0,
    });
  }
  for (const row of walkInRows) {
    if (!isDateInAnalyticsRange(row.businessDate, range)) continue;
    const scopeKey = attendanceScopeKey(row.businessDate, row.eventId);
    const scope = scopes.get(scopeKey) ?? {
      businessDate: row.businessDate,
      eventId: row.eventId,
      checkedInGuests: 0,
      walkIns: 0,
    };
    scope.walkIns = row.walkInCount;
    scopes.set(scopeKey, scope);
  }
  for (const row of closeoutRows) {
    if (!isDateInAnalyticsRange(row.businessDate, range)) continue;
    scopes.set(attendanceScopeKey(row.businessDate, row.eventId), {
      businessDate: row.businessDate,
      eventId: row.eventId,
      checkedInGuests: row.checkedInGuests,
      walkIns: row.finalWalkIns,
    });
  }
  for (const scope of scopes.values()) {
    const day = days.get(scope.businessDate) ?? {
      businessDate: scope.businessDate,
      checkedInGuests: 0,
      walkIns: 0,
    };
    day.checkedInGuests += scope.checkedInGuests;
    day.walkIns += scope.walkIns;
    assertCount(day.checkedInGuests, "Attendance day checked-in total");
    assertCount(day.walkIns, "Attendance day walk-in total");
    days.set(scope.businessDate, day);
  }
  return [...days.values()]
    .filter((day) => day.checkedInGuests + day.walkIns > 0)
    .sort((left, right) => left.businessDate.localeCompare(right.businessDate));
}

function buildAttendanceTrend(
  rows: readonly AnalyticsAttendanceDayInput[],
  selection: AnalyticsPeriodSelection,
): AnalyticsAttendanceTrendPoint[] {
  const buckets = new Map<string, AnalyticsAttendanceTrendPoint>();
  for (const row of rows) {
    const bucketStartDate =
      selection.period.granularity === "month"
        ? row.businessDate
        : `${row.businessDate.slice(0, 7)}-01`;
    const point = buckets.get(bucketStartDate) ?? {
      bucketStartDate,
      checkedInGuests: 0,
      walkIns: 0,
      totalAttendance: 0,
      operatingDays: 0,
    };
    point.checkedInGuests += row.checkedInGuests;
    point.walkIns += row.walkIns;
    point.totalAttendance += row.checkedInGuests + row.walkIns;
    point.operatingDays += 1;
    assertCount(point.checkedInGuests, "Attendance trend checked-in total");
    assertCount(point.walkIns, "Attendance trend walk-in total");
    assertCount(point.totalAttendance, "Attendance trend total");
    assertCount(point.operatingDays, "Attendance trend operating day count");
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
      assertCount(row.operatingDays, "Contributor operating day count");
      assertCount(row.registered, "Contributor registered count");
      assertCount(row.checkedIn, "Contributor checked-in count");
      assertCount(row.guestRows, "Contributor guest row count");
      if (
        row.checkedIn > row.registered ||
        row.registered !== row.guestRows ||
        row.operatingDays > row.guestRows ||
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
      const sourceStatus: AnalyticsContributorRow["sourceStatus"] =
        row.contributorId
          ? row.displayName
            ? "mapped"
            : "deleted"
          : "unmapped";
      return {
        contributorId: row.contributorId,
        displayName:
          sourceStatus === "unmapped"
            ? row.sourceDisplayName ?? ""
            : row.displayName ?? "",
        sourceStatus,
        source: row.contributorId
          ? null
          : {
              kind: row.sourceKind,
              id: row.sourceId,
            },
        operatingDays: row.operatingDays,
        registered: row.registered,
        checkedIn: row.checkedIn,
        entryRatePercent:
          row.registered === 0
            ? null
            : roundOne((row.checkedIn / row.registered) * 100),
        registeredPerOperatingDay:
          row.operatingDays === 0
            ? null
            : roundOne(row.registered / row.operatingDays),
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
  guestDayRows,
  attendanceGuestScopeRows,
  walkInDayRows,
  attendanceCloseoutRows,
  contributorRows,
}: {
  selection: AnalyticsPeriodSelection;
  eventRows: readonly AnalyticsServiceEventRow[];
  guestDayRows: readonly AnalyticsServiceGuestDayRow[];
  attendanceGuestScopeRows: readonly AnalyticsServiceAttendanceGuestScopeRow[];
  walkInDayRows: readonly AnalyticsServiceWalkInDayRow[];
  attendanceCloseoutRows: readonly AnalyticsServiceAttendanceCloseoutRow[];
  contributorRows: readonly AnalyticsServiceContributorRow[];
}): AdminAnalyticsView {
  assertEventRows(eventRows);
  assertGuestDayRows(guestDayRows);
  assertAttendanceGuestScopeRows(attendanceGuestScopeRows);
  assertWalkInScopeRows(walkInDayRows);
  assertAttendanceCloseoutRows(attendanceCloseoutRows);
  const currentAggregate = summarizeAnalyticsGuestDays(
    guestDayRows
      .filter((row) => isDateInAnalyticsRange(row.businessDate, selection.period))
      .map((row) => ({
        businessDate: row.businessDate,
        registered: row.registeredCount,
        checkedIn: row.checkedInCount,
      })),
  );
  const comparisonAggregate = summarizeAnalyticsGuestDays(
    guestDayRows
      .filter((row) =>
        isDateInAnalyticsRange(row.businessDate, selection.comparisonPeriod),
      )
      .map((row) => ({
        businessDate: row.businessDate,
        registered: row.registeredCount,
        checkedIn: row.checkedInCount,
      })),
  );
  const currentAttendanceDays = buildAttendanceDays(
    attendanceGuestScopeRows,
    walkInDayRows,
    attendanceCloseoutRows,
    selection.period,
  );
  const comparisonAttendanceDays = buildAttendanceDays(
    attendanceGuestScopeRows,
    walkInDayRows,
    attendanceCloseoutRows,
    selection.comparisonPeriod,
  );
  const currentAttendanceAggregate = summarizeAnalyticsAttendanceDays(
    currentAttendanceDays,
  );
  const comparisonAttendanceAggregate = summarizeAnalyticsAttendanceDays(
    comparisonAttendanceDays,
  );
  const currentEvents = eventRows.filter((row) =>
    isDateInAnalyticsRange(row.businessDate, selection.period),
  );
  const mappedGuestRows = contributorRows.reduce(
    (total, row) => total + (row.contributorId ? row.guestRows : 0),
    0,
  );
  const totalGuestRows = contributorRows.reduce(
    (total, row) => total + row.guestRows,
    0,
  );
  const contributorCheckedIn = contributorRows.reduce(
    (total, row) => total + row.checkedIn,
    0,
  );
  assertCount(mappedGuestRows, "Mapped guest row total");
  assertCount(totalGuestRows, "Guest row total");
  assertCount(contributorCheckedIn, "Contributor checked-in total");
  if (
    totalGuestRows !== currentAggregate.registered ||
    contributorCheckedIn !== currentAggregate.checkedIn
  ) {
    throw new Error("Analytics guest-day and contributor totals must match");
  }

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
    {
      operatingDays: currentAggregate.operatingDays,
      mapped: mappedGuestRows,
      total: totalGuestRows,
    },
  );

  return {
    period: selection.period,
    comparisonPeriod: selection.comparisonPeriod,
    navigation: selection.navigation,
    coverage,
    summary: buildAnalyticsSummary(currentAggregate, comparisonAggregate),
    attendance: {
      summary: buildAnalyticsAttendanceSummary(
        currentAttendanceAggregate,
        comparisonAttendanceAggregate,
      ),
      trend: buildAttendanceTrend(currentAttendanceDays, selection),
    },
    trend: buildTrend(guestDayRows, selection),
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
