export type PreviewRole = "door" | "guest" | "admin" | "super" | "external";
export type Screen =
  | "overview"
  | "roster"
  | "attendance"
  | "events"
  | "requests"
  | "links"
  | "users"
  | "analytics"
  | "venues";
export type SheetName =
  | "scope"
  | "add"
  | "code"
  | "filter"
  | "more"
  | "account"
  | "request"
  | "link"
  | "event"
  | "closeout"
  | "map"
  | "user";
export type Guest = {
  id: string;
  name: string;
  owner: string;
  source: "DJ" | "스태프" | "본인 등록";
  checked: boolean;
  code: string;
  time: string;
};
export type GuestRequest = {
  id: string;
  name: string;
  count: number;
  reason: string;
  state: "pending" | "approved" | "rejected";
};
export type GuestLink = {
  id: string;
  name: string;
  kind: string;
  used: number;
  limit: number;
  active: boolean;
};
export const roleNames: Record<PreviewRole, string> = {
  door: "Door 스태프",
  guest: "DJ · 스태프",
  admin: "베뉴 관리자",
  super: "전체 관리자",
  external: "외부 등록",
};
export const screenNames: Record<Screen, string> = {
  overview: "오늘의 운영",
  roster: "게스트 명단",
  attendance: "입장 집계",
  events: "행사",
  requests: "추가 인원 요청",
  links: "등록 링크",
  users: "계정 관리",
  analytics: "통계",
  venues: "베뉴 관리",
};
export const events = [
  {
    id: "tonight",
    title: "Saturday at FAUST",
    date: "2026.09.12",
    day: "SAT",
    time: "23:00 — 07:00",
    venue: "FAUST",
    state: "진행 중",
  },
  {
    id: "next",
    title: "Friday Residents",
    date: "2026.09.18",
    day: "FRI",
    time: "23:00 — 07:00",
    venue: "FAUST",
    state: "예정",
  },
];
const names = [
  "김서윤",
  "Alex Morgan",
  "이도현",
  "박지우",
  "Yuna Kim",
  "정하린",
  "이준서",
  "한소희",
  "Jules Park",
  "오민재",
  "최유진",
  "서지안",
  "Emma Lee",
  "강도윤",
  "윤세아",
  "정우진",
  "Robin Cho",
  "송하은",
];
export function seedGuests(eventId: string): Guest[] {
  if (eventId !== "tonight") return [];
  return names.map((name, i) => ({
    id: `guest-${i}`,
    name,
    owner: ["SORA", "MILO", "운영팀"][i % 3],
    source: i % 5 === 0 ? "본인 등록" : i % 3 === 2 ? "스태프" : "DJ",
    checked: [1, 4, 7, 9, 12, 14, 16].includes(i),
    code: `DEMO${String(i + 1).padStart(2, "0")}`,
    time: ["23:48", "23:52", "00:03", "00:11"][i % 4],
  }));
}
export const initialRequests: GuestRequest[] = [
  {
    id: "request-1",
    name: "SORA",
    count: 3,
    reason: "함께 오는 게스트 3명을 추가하고 싶어요.",
    state: "pending",
  },
  {
    id: "request-2",
    name: "MILO",
    count: 2,
    reason: "해외에서 방문하는 친구들입니다.",
    state: "pending",
  },
];
export const initialLinks: GuestLink[] = [
  {
    id: "link-1",
    name: "SORA 게스트",
    kind: "담당자 등록",
    used: 6,
    limit: 10,
    active: true,
  },
  {
    id: "link-2",
    name: "토요일 초대",
    kind: "본인 등록",
    used: 4,
    limit: 20,
    active: true,
  },
  {
    id: "link-3",
    name: "MILO 게스트",
    kind: "담당자 등록",
    used: 6,
    limit: 10,
    active: false,
  },
];
