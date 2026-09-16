import { viewLabels, type MockState, type View } from "../data/types";
import type { IconName } from "../shared/Icon";

export const navigationGroups: {
  id: string;
  title: string;
  items: { view: View; icon: IconName; detail: string }[];
}[] = [
  {
    id: "production",
    title: "공연 준비",
    items: [
      { view: "events", icon: "calendar", detail: "행사 준비·개시·종료" },
      { view: "artists", icon: "user", detail: "연락처·자료·출연 이력" },
      { view: "bookings", icon: "file", detail: "문의·조율·홀드·출연 확정" },
      {
        view: "schedule",
        icon: "calendar",
        detail: "출연 시간과 일정 겹침 확인",
      },
      {
        view: "preparation",
        icon: "check",
        detail: "출연표·자료·준비 체크리스트",
      },
    ],
  },
  {
    id: "operations",
    title: "현장 운영",
    items: [
      { view: "home", icon: "home", detail: "작업 공간과 대기 요청" },
      { view: "roster", icon: "people", detail: "등록·검색·명단 관리" },
      { view: "links", icon: "link", detail: "외부 담당자·본인 등록 링크" },
      { view: "requests", icon: "bell", detail: "등록 한도 요청과 승인 내역" },
      { view: "door", icon: "door", detail: "게스트 확인과 입장 처리" },
      { view: "attendance", icon: "chart", detail: "워크인·동기화·집계 마감" },
    ],
  },
  {
    id: "reports",
    title: "운영 기록",
    items: [
      { view: "report", icon: "file", detail: "운영 결과 확인과 내보내기" },
      { view: "analytics", icon: "chart", detail: "기간별 추이와 기여자" },
    ],
  },
  {
    id: "management",
    title: "관리",
    items: [
      { view: "users", icon: "people", detail: "초대·역할·등록 한도" },
      {
        view: "password-requests",
        icon: "user",
        detail: "본인 확인과 재설정 승인",
      },
      { view: "venues", icon: "venue", detail: "베뉴 정보와 운영 설정" },
      { view: "profile", icon: "user", detail: "내 정보·언어·비밀번호" },
    ],
  },
];

const labels: Partial<Record<View, string>> = {
  roster: "명단",
  door: "도어",
  artists: "아티스트",
  bookings: "부킹",
  schedule: "일정",
  events: "행사",
  report: "리포트",
  users: "계정",
  "password-requests": "재설정 요청",
  requests: "인원 요청",
  venues: "베뉴",
  analytics: "통계",
};

export function navigationLabel(view: View, isAdmin: boolean) {
  if (view === "roster" && !isAdmin) return "내 명단";
  return labels[view] ?? viewLabels[view];
}

export function navigationPendingCounts(
  data: MockState, eventId: string, venueId: string, userId: string, isAdmin: boolean,
): Partial<Record<View, number>> {
  return {
    requests: data.requests.filter((request) => request.eventId === eventId &&
      request.state === "pending" && (isAdmin || request.userId === userId)).length,
    "password-requests": isAdmin ? data.resetRequests.filter((request) =>
      request.state === "pending" &&
      data.users.find((user) => user.id === request.userId)?.venueId === venueId).length : 0,
  };
}
