import { viewLabels, type View } from "../data/types";

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
