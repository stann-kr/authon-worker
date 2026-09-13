import type { MockState } from "../data/types";
import { MOCK_NOW } from "../data/types";
import type { Booking } from "./types";
import { activeBooking, conflictsFor, guestImpact, holdExpired, timeValue } from "./domain";

export interface BookingIssue {
  key: string;
  label: string;
  action: "edit" | "review" | "materials" | "preparation" | "links";
  target?: "owner" | "due" | "holdUntil" | "start" | "materials";
}

// Derived from the same booking, tasks and guest data shown in the workspaces.
export function bookingIssues(data: MockState, b: Booking): BookingIssue[] {
  if (!activeBooking(b)) return [];
  const issues: BookingIssue[] = [];
  const add = (key: string, label: string, action: BookingIssue["action"], target?: BookingIssue["target"]) => issues.push({ key, label, action, target });
  if (!b.owner.trim()) add("owner", "부킹 담당자 지정", "edit", "owner");
  if (b.nextAction && (!b.due || b.due <= MOCK_NOW.slice(0, 10)))
    add("followup", !b.due ? "후속 업무 기한 지정" : b.due < MOCK_NOW.slice(0, 10) ? "기한 지난 후속 업무 처리" : "오늘까지 후속 업무 처리", "edit", "due");
  if (holdExpired(b)) add("hold", "지난 홀드 재협의", "edit", "holdUntil");
  if (conflictsFor(b, data.planning.bookings).length) add("conflict", "교체·이동 포함 일정 겹침", "edit", "start");
  if (b.availability === "unavailable") add("unavailable", "상대가 일정 조정 요청", "review");
  if (b.status === "confirmed") {
    if (b.availability === "unknown") add("availability", "변경 일정 가능 여부 재확인", "review");
    if (b.acknowledgedRevision !== b.revision) add("acknowledgement", "최신 일정 확인 대기", "review");
    if (!b.materials.pressUrl || !b.materials.riderUrl) add("materials", "누락된 행사 자료 등록", "edit", "materials");
    else if (b.materialsReviewedRevision !== b.revision) add("materials-review", "행사 자료 운영팀 검토", "materials");
    const { link } = guestImpact(data, b);
    if (b.guestLinkId && !link) add("link-deleted", "삭제된 게스트 링크 확인", "links");
    else if (link && (!link.active || (link.expiresAt && Date.parse(link.expiresAt) <= Date.parse(MOCK_NOW))))
      add("link", "게스트 등록 링크 상태 확인", "links");
    if (timeValue(b.end) <= Date.parse(MOCK_NOW)) add("closeout", "출연 결과 기록", "preparation");
    else if (data.events.some((e) => e.id === b.eventId && ["closed", "archived"].includes(e.state)))
      add("event-closed", "종료된 행사 부킹 확인", "preparation");
  }
  if (b.tasks.some((task) => !task.done)) add("tasks", "남은 준비 업무 처리", "preparation");
  return issues;
}
