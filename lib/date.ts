/**
 * 클럽/이벤트 영업일 기준 날짜 유틸리티
 *
 * 클럽 이벤트는 보통 밤 11시에 시작해서 새벽 5~6시에 끝납니다.
 * 자정이 넘어도 같은 영업일로 취급해야 하므로,
 * DAY_CHANGE_HOUR(기본 06시) 이전의 시간은 전날 날짜로 간주합니다.
 *
 * 예: 2월 19일 23:00 → 2월 19일 (정상)
 *     2월 20일 02:00 → 2월 19일 (전날 영업일)
 *     2월 20일 07:00 → 2월 20일 (새 영업일)
 */

/** 영업일 전환 시각 (24시 기준). 이 시각 이전은 전날 영업일에 해당 */
const DAY_CHANGE_HOUR = 6;

function formatLocalYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 현재 시각의 영업일(business date)을 YYYY-MM-DD 형식으로 반환
 * - 06:00 이후 → 오늘 날짜
 * - 00:00 ~ 05:59 → 어제 날짜
 */
export function getBusinessDate(): string {
  const now = new Date();
  if (now.getHours() < DAY_CHANGE_HOUR) {
    // 자정~05:59 → 전날 날짜
    now.setDate(now.getDate() - 1);
  }
  return formatLocalYmd(now);
}

/**
 * 날짜를 표시용 포맷으로 변환 (YYYY.MM.DD (DDD))
 */
export function formatDateDisplay(dateString: string): string {
  const ymdMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    const date = new Date(`${year}-${month}-${day}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const dayName = days[date.getDay()];
      return `${year}.${month}.${day} (${dayName})`;
    }
    return `${year}.${month}.${day}`;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const dayName = days[date.getDay()];
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} (${dayName})`;
}
