import { useMock } from "../data/MockData";
import type { Booking } from "./types";
import { bookingIssues, type BookingIssue } from "./pipeline";

export function BookingPipeline({ booking, onAction }: {
  booking: Booking;
  onAction: (issue: BookingIssue) => void;
}) {
  const { data, t } = useMock();
  const issues = bookingIssues(data, booking);
  if (!issues.length) return null;
  return <section className="planning-pipeline" aria-label={t("이 부킹의 확인 필요 항목")}>
    <h3>{t("확인 필요")} <span>{issues.length}</span></h3>
    <ul>{issues.map((issue) => <li key={issue.key}>
      <button className="planning-pipeline-action" onClick={() => onAction(issue)}>
        <span>{t(issue.label)}</span><span aria-hidden="true">›</span>
      </button>
    </li>)}</ul>
  </section>;
}
