import type {
  AdminAnalyticsView,
  AnalyticsGuestDayInput,
} from "./types.ts";

const WEEKEND_BUSINESS_DATES = [
  "2026-08-01",
  "2026-08-02",
  "2026-08-08",
  "2026-08-09",
  "2026-08-15",
  "2026-08-16",
  "2026-08-22",
  "2026-08-23",
] as const;

const WEEKDAY_BUSINESS_DATES = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
] as const;

export const WEEKEND_GUEST_DAY_FIXTURE: readonly AnalyticsGuestDayInput[] =
  WEEKEND_BUSINESS_DATES.map((businessDate) => ({
    businessDate,
    registered: 50,
    checkedIn: 40,
  }));

export const WEEKDAY_GUEST_DAY_FIXTURE: readonly AnalyticsGuestDayInput[] =
  WEEKDAY_BUSINESS_DATES.map((businessDate) => ({
    businessDate,
    registered: 20,
    checkedIn: 15,
  }));

export const EMPTY_ANALYTICS_DTO_FIXTURE: AdminAnalyticsView = {
  period: {
    granularity: "month",
    startDate: "2026-08-01",
    endDateExclusive: "2026-09-01",
    dataEndDateExclusive: "2026-09-01",
    status: "complete",
  },
  comparisonPeriod: {
    startDate: "2026-07-01",
    endDateExclusive: "2026-08-01",
  },
  navigation: {
    previousAnchorDate: "2026-07-01",
    nextAnchorDate: "2026-09-01",
  },
  coverage: {
    confirmedEvents: 0,
    operatingDays: 0,
    unconfirmedClosedEvents: 0,
    openEvents: 0,
    draftEvents: 0,
    driftedEvents: 0,
    legacyEvents: 0,
    mappedContributorPercent: null,
  },
  summary: {
    registered: {
      value: 0,
      comparisonValue: 0,
      delta: 0,
      relativeChangePercent: null,
      deltaKind: "number",
      status: "zero_baseline",
    },
    checkedIn: {
      value: 0,
      comparisonValue: 0,
      delta: 0,
      relativeChangePercent: null,
      deltaKind: "number",
      status: "zero_baseline",
    },
    entryRatePercent: {
      value: null,
      comparisonValue: null,
      delta: null,
      relativeChangePercent: null,
      deltaKind: "percentage_point",
      status: "not_calculable",
    },
    registeredPerOperatingDay: {
      value: null,
      comparisonValue: null,
      delta: null,
      relativeChangePercent: null,
      deltaKind: "number",
      status: "not_calculable",
    },
  },
  attendance: {
    summary: {
      totalAttendance: {
        value: 0,
        comparisonValue: 0,
        delta: 0,
        relativeChangePercent: null,
        deltaKind: "number",
        status: "zero_baseline",
      },
      checkedInGuests: {
        value: 0,
        comparisonValue: 0,
        delta: 0,
        relativeChangePercent: null,
        deltaKind: "number",
        status: "zero_baseline",
      },
      walkIns: {
        value: 0,
        comparisonValue: 0,
        delta: 0,
        relativeChangePercent: null,
        deltaKind: "number",
        status: "zero_baseline",
      },
      attendancePerOperatingDay: {
        value: null,
        comparisonValue: null,
        delta: null,
        relativeChangePercent: null,
        deltaKind: "number",
        status: "not_calculable",
      },
    },
    trend: [],
  },
  trend: [],
  contributors: [],
  events: [],
};
