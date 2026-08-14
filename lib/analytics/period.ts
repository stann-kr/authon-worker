import { isValidTimeZone } from "../date.ts";
import { isBusinessDate } from "../events/domain.ts";
import type {
  AnalyticsDateRange,
  AnalyticsGranularity,
  AnalyticsPeriodSelection,
} from "./types.ts";

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

const GRANULARITY_MONTHS: Record<AnalyticsGranularity, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

function parseBusinessDate(value: string): CalendarDateParts {
  if (!isBusinessDate(value)) {
    throw new RangeError("Invalid analytics anchor date");
  }
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function formatBusinessDate(parts: CalendarDateParts): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function toUtcDate(parts: CalendarDateParts): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

function fromUtcDate(date: Date): CalendarDateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function daysInMonth(year: number, month: number): number {
  const firstOfFollowingMonth = toUtcDate({ year, month: month + 1, day: 1 });
  firstOfFollowingMonth.setUTCDate(0);
  return firstOfFollowingMonth.getUTCDate();
}

function addDays(value: string, amount: number): string {
  const date = toUtcDate(parseBusinessDate(value));
  date.setUTCDate(date.getUTCDate() + amount);
  return formatBusinessDate(fromUtcDate(date));
}

function shiftMonthsClamped(value: string, amount: number): string {
  const source = parseBusinessDate(value);
  const monthIndex = source.year * 12 + source.month - 1 + amount;
  const year = Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  return formatBusinessDate({
    year,
    month,
    day: Math.min(source.day, daysInMonth(year, month)),
  });
}

function startOfPeriod(
  anchorDate: string,
  granularity: AnalyticsGranularity,
): string {
  const anchor = parseBusinessDate(anchorDate);
  const startMonth =
    granularity === "year"
      ? 1
      : granularity === "quarter"
        ? Math.floor((anchor.month - 1) / 3) * 3 + 1
        : anchor.month;
  return formatBusinessDate({ year: anchor.year, month: startMonth, day: 1 });
}

function getZonedCalendarDate(now: Date, timezone: string): string {
  if (!isValidTimeZone(timezone)) {
    throw new RangeError("Invalid analytics timezone");
  }
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("Invalid current instant");
  }
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)) {
    values[part.type] = part.value;
  }
  return formatBusinessDate({
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  });
}

export function isAnalyticsGranularity(
  value: unknown,
): value is AnalyticsGranularity {
  return value === "month" || value === "quarter" || value === "year";
}

export function isDateInAnalyticsRange(
  businessDate: string,
  range: AnalyticsDateRange,
): boolean {
  if (!isBusinessDate(businessDate)) return false;
  return businessDate >= range.startDate && businessDate < range.endDateExclusive;
}

export function resolveAnalyticsPeriod({
  granularity,
  anchorDate,
  timezone,
  now = new Date(),
}: {
  granularity: AnalyticsGranularity;
  anchorDate: string;
  timezone: string;
  now?: Date;
}): AnalyticsPeriodSelection {
  if (!isAnalyticsGranularity(granularity)) {
    throw new RangeError("Invalid analytics granularity");
  }
  const currentDate = getZonedCalendarDate(now, timezone);
  const months = GRANULARITY_MONTHS[granularity];
  const startDate = startOfPeriod(anchorDate, granularity);
  if (startDate > currentDate) {
    throw new RangeError("Future analytics periods are not available");
  }

  const endDateExclusive = shiftMonthsClamped(startDate, months);
  const isInProgress = currentDate < endDateExclusive;
  const dataEndDateExclusive = isInProgress
    ? addDays(currentDate, 1)
    : endDateExclusive;
  const comparisonStartDate = shiftMonthsClamped(startDate, -months);
  const comparisonEndDateExclusive = isInProgress
    ? addDays(shiftMonthsClamped(currentDate, -months), 1)
    : startDate;
  const nextStartDate = endDateExclusive;

  return {
    currentDate,
    period: {
      granularity,
      startDate,
      endDateExclusive,
      dataEndDateExclusive,
      status: isInProgress ? "in_progress" : "complete",
    },
    comparisonPeriod: {
      startDate: comparisonStartDate,
      endDateExclusive: comparisonEndDateExclusive,
    },
    navigation: {
      previousAnchorDate: comparisonStartDate,
      nextAnchorDate: nextStartDate <= currentDate ? nextStartDate : null,
    },
  };
}
