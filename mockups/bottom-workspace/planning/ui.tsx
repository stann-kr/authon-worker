import { useMock } from "../data/MockData";
import type { Booking } from "./types";
import { bookingStatuses } from "./types";
import { holdExpired } from "./domain";
export function timeLabel(value: string) {
  return value
    ? `${value.slice(5, 10).replace("-", ".")} ${value.slice(11, 16)}`
    : "—";
}
export function Status({ booking }: { booking: Booking }) {
  const { t } = useMock();
  return (
    <span className={`planning-status ${booking.status}`}>
      {t(
        holdExpired(booking) ? "홀드 재확인" : bookingStatuses[booking.status],
      )}
    </span>
  );
}
export function MaterialLink({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const { t } = useMock();
  return value ? (
    <a
      className="planning-material"
      href={value}
      target="_blank"
      rel="noreferrer"
    >
      {t(label)} ↗
    </a>
  ) : (
    <span className="planning-missing">
      {t(label)} · {t("미등록")}
    </span>
  );
}
export function PlanningTabs() {
  const { view, navigate, t } = useMock();
  return (
    <nav className="planning-tabs" aria-label={t("공연 준비")}>
      {(
        [
          ["artists", "아티스트"],
          ["bookings", "부킹"],
          ["schedule", "일정"],
          ["preparation", "준비 업무"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          aria-current={view === v ? "page" : undefined}
          onClick={() => navigate(v)}
        >
          {t(label)}
        </button>
      ))}
    </nav>
  );
}
