/**
 * 업무일(YYYY-MM-DD)은 시각이 없는 달력 날짜이므로 UTC 자정으로 고정해
 * 브라우저 시간대와 관계없이 같은 날짜를 사용자 locale로 표시합니다.
 */
export function formatCalendarDate(
  locale: string,
  value: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

/** 월 단위 bucket은 1일을 생략해 차트 축과 표를 짧게 유지합니다. */
export function formatBucketDate(locale: string, value: string): string {
  const day = Number(value.split("-")[2]);
  return formatCalendarDate(locale, value, {
    month: "short",
    day: day === 1 ? undefined : "numeric",
  });
}

export const FULL_CALENDAR_DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};
