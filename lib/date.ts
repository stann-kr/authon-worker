/** 베뉴 시간 설정의 기존 데이터 및 신규 생성 기본값. */
export const DEFAULT_VENUE_TIMEZONE = "Asia/Seoul";
export const DEFAULT_OPENING_TIME = "22:00";
export const DEFAULT_CLOSING_TIME = "06:00";

export interface VenueTimeSettings {
  timezone?: string | null;
  openingTime?: string | null;
  closingTime?: string | null;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function formatYmd(year: number, month: number, day: number): string {
  return [
    year,
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function padYmd(parts: Pick<ZonedDateParts, "year" | "month" | "day">): string {
  return formatYmd(parts.year, parts.month, parts.day);
}

function previousYmd(parts: Pick<ZonedDateParts, "year" | "month" | "day">): string {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() - 1);
  return formatYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseTimeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function getZonedDateParts(now: Date, timezone: string): ZonedDateParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  for (const part of parts) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function isValidTimeValue(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * 베뉴 현지 시각과 운영시간을 기준으로 영업일을 반환합니다.
 * 운영시간이 자정을 넘는 경우에만 closing 이전 시각을 전날 영업일로 봅니다.
 */
export function getBusinessDate(
  settings: VenueTimeSettings = {},
  now: Date = new Date(),
): string {
  const timezone = isValidTimeZone(settings.timezone)
    ? settings.timezone
    : DEFAULT_VENUE_TIMEZONE;
  const openingTime = isValidTimeValue(settings.openingTime)
    ? settings.openingTime
    : DEFAULT_OPENING_TIME;
  const closingTime = isValidTimeValue(settings.closingTime)
    ? settings.closingTime
    : DEFAULT_CLOSING_TIME;
  const local = getZonedDateParts(now, timezone);
  const openingMinutes = parseTimeMinutes(openingTime);
  const closingMinutes = parseTimeMinutes(closingTime);
  const localMinutes = local.hour * 60 + local.minute;
  const crossesMidnight = closingMinutes < openingMinutes;

  return crossesMidnight && localMinutes < closingMinutes
    ? previousYmd(local)
    : padYmd(local);
}

/**
 * 날짜를 표시용 포맷으로 변환 (YYYY.MM.DD (DDD))
 */
export function formatDateDisplay(dateString: string, locale: "en" | "ko" = "en"): string {
  const intlLocale = locale === "ko" ? "ko-KR" : "en-US";
  const ymdMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    const date = new Date(`${year}-${month}-${day}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      const dayName = new Intl.DateTimeFormat(intlLocale, {
        weekday: "short",
      })
        .format(date)
        .toUpperCase();
      return `${year}.${month}.${day} (${dayName})`;
    }
    return `${year}.${month}.${day}`;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  const dayName = new Intl.DateTimeFormat(intlLocale, { weekday: "short" })
    .format(date)
    .toUpperCase();
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} (${dayName})`;
}
