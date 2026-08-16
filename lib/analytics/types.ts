import type { EventState } from "../api/types.ts";

export const ANALYTICS_GRANULARITIES = ["month", "quarter", "year"] as const;

export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];
export type AnalyticsPeriodStatus = "complete" | "in_progress";
export type AnalyticsComparisonStatus =
  | "available"
  | "zero_baseline"
  | "not_calculable";

export interface AdminAnalyticsQuery {
  venueId: string;
  granularity: AnalyticsGranularity;
  anchorDate: string;
  compare: "previous";
}

export interface AnalyticsDateRange {
  startDate: string;
  endDateExclusive: string;
}

export interface AnalyticsPeriod extends AnalyticsDateRange {
  dataEndDateExclusive: string;
  granularity: AnalyticsGranularity;
  status: AnalyticsPeriodStatus;
}

export interface AnalyticsPeriodSelection {
  currentDate: string;
  period: AnalyticsPeriod;
  comparisonPeriod: AnalyticsDateRange;
  navigation: {
    previousAnchorDate: string;
    nextAnchorDate: string | null;
  };
}

export interface AnalyticsGuestDayInput {
  businessDate: string;
  registered: number;
  checkedIn: number;
}

export interface AnalyticsAggregate {
  operatingDays: number;
  registered: number;
  checkedIn: number;
  noShow: number;
  entryRatePercent: number | null;
  registeredPerOperatingDay: number | null;
  checkedInPerOperatingDay: number | null;
}

export interface AnalyticsMetricComparison {
  value: number | null;
  comparisonValue: number | null;
  delta: number | null;
  relativeChangePercent: number | null;
  deltaKind: "number" | "percentage_point";
  status: AnalyticsComparisonStatus;
}

export interface AnalyticsSummary {
  registered: AnalyticsMetricComparison;
  checkedIn: AnalyticsMetricComparison;
  entryRatePercent: AnalyticsMetricComparison;
  registeredPerOperatingDay: AnalyticsMetricComparison;
}

export interface AnalyticsAttendanceDayInput {
  businessDate: string;
  checkedInGuests: number;
  walkIns: number;
}

export interface AnalyticsAttendanceAggregate {
  operatingDays: number;
  checkedInGuests: number;
  walkIns: number;
  totalAttendance: number;
  attendancePerOperatingDay: number | null;
}

export interface AnalyticsAttendanceSummary {
  totalAttendance: AnalyticsMetricComparison;
  checkedInGuests: AnalyticsMetricComparison;
  walkIns: AnalyticsMetricComparison;
  attendancePerOperatingDay: AnalyticsMetricComparison;
}

export interface AnalyticsAttendanceTrendPoint {
  bucketStartDate: string;
  checkedInGuests: number;
  walkIns: number;
  totalAttendance: number;
  operatingDays: number;
}

export interface AnalyticsAttendanceView {
  summary: AnalyticsAttendanceSummary;
  trend: AnalyticsAttendanceTrendPoint[];
}

export type AnalyticsCloseoutCoverageStatus =
  | "confirmed"
  | "missing"
  | "drifted"
  | "legacy_unlinked";

export interface AnalyticsCoverageEventInput {
  eventId: string;
  businessDate: string;
  state: EventState;
  closeoutStatus: AnalyticsCloseoutCoverageStatus;
}

export interface AnalyticsCoverage {
  confirmedEvents: number;
  operatingDays: number;
  unconfirmedClosedEvents: number;
  openEvents: number;
  draftEvents: number;
  driftedEvents: number;
  legacyEvents: number;
  mappedContributorPercent: number | null;
}

export interface AnalyticsTrendPoint {
  bucketStartDate: string;
  registered: number;
  checkedIn: number;
  operatingDays: number;
}

export interface AnalyticsContributorRow {
  contributorId: string | null;
  displayName: string;
  sourceStatus: "mapped" | "unmapped" | "deleted";
  source: {
    kind: "user" | "external_link" | "unattributed";
    id: string;
  } | null;
  operatingDays: number;
  registered: number;
  checkedIn: number;
  entryRatePercent: number | null;
  registeredPerOperatingDay: number | null;
}

export interface AnalyticsContributorSnapshotInput {
  eventId: string;
  businessDate: string;
  contributorId: string | null;
  sourceKind: "user" | "external_link" | "unattributed";
  sourceId: string;
  registeredCount: number;
  checkedInCount: number;
}

export interface AnalyticsContributorDirectoryInput {
  id: string;
  displayName: string;
}

export interface AnalyticsEventRow {
  eventId: string;
  businessDate: string;
  name: string;
  registered: number;
  checkedIn: number;
  entryRatePercent: number | null;
  confirmedAt: string;
  status: "confirmed" | "drifted";
}

export interface AdminAnalyticsView {
  period: AnalyticsPeriod;
  comparisonPeriod: AnalyticsDateRange;
  navigation: AnalyticsPeriodSelection["navigation"];
  coverage: AnalyticsCoverage;
  summary: AnalyticsSummary;
  attendance: AnalyticsAttendanceView;
  trend: AnalyticsTrendPoint[];
  contributors: AnalyticsContributorRow[];
  events: AnalyticsEventRow[];
}
