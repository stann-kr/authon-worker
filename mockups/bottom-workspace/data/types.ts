import type { PlanningState } from "../planning/types";
export type Role =
  "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
export type Locale = "ko" | "en";
export type VenuePreview = "default" | "one" | "none" | "inactive" | "no-events" | "archived";
export type View =
  | "home"
  | "door"
  | "roster"
  | "attendance"
  | "events"
  | "artists"
  | "bookings"
  | "schedule"
  | "preparation"
  | "report"
  | "links"
  | "users"
  | "password-requests"
  | "requests"
  | "venues"
  | "analytics"
  | "profile"
  | "auth"
  | "external";
export type Scenario =
  | "normal"
  | "loading"
  | "read-error"
  | "partial-error"
  | "saving"
  | "save-error"
  | "unknown-result"
  | "stale"
  | "offline"
  | "syncing"
  | "conflict"
  | "rejected"
  | "scope-closed"
  | "session-expired"
  | "access-denied"
  | "link-expired"
  | "link-inactive"
  | "storage-denied"
  | "qr-error"
  | "report-inconsistent"
  | "rate-limited"
  | "credential-expired";
export interface MockVenue {
  id: string;
  name: string;
  type: "club" | "bar" | "lounge" | "festival" | "private";
  address: string;
  description: string;
  brandName: string;
  tagline: string;
  domain: string;
  locale: Locale;
  timezone: string;
  opening: string;
  closing: string;
  active: boolean;
}
export interface MockUser {
  id: string;
  venueId: string | null;
  name: string;
  email: string;
  role: Role;
  accountKind: "personal" | "shared";
  doorAccess: boolean;
  limit: number | null;
  active: boolean;
  deleted: boolean;
  setup: boolean;
  locale: Locale | null;
  credentialVersion: number;
  createdAt: string;
  lastLogin: string | null;
  password?: string;
  keepSignedIn?: boolean;
}
export interface MockEvent {
  id: string;
  venueId: string;
  date: string;
  name: string;
  state: "draft" | "open" | "closed" | "archived";
  capacity: number | null;
  target: number | null;
  general?: boolean;
  createdAt: string;
  openedAt: string | null;
  closedAt: string | null;
  templateId: string | null;
}
export interface MockGuest {
  id: string;
  venueId: string;
  eventId: string;
  name: string;
  ownerId: string;
  externalLinkId: string | null;
  operator: string;
  status: "pending" | "checked" | "deleted";
  code: string;
  createdAt: string;
  checkedAt: string | null;
  checkIns: number;
  cancellations: number;
  history?: { kind: "check" | "undo"; at: string }[];
}
export interface MockLink {
  id: string;
  venueId: string;
  eventId: string;
  ownerName: string;
  eventName?: string;
  contributorKey?: string;
  contributorUserId?: string | null;
  kind: "contributor" | "self_rsvp";
  limit: number;
  active: boolean;
  deleted: boolean;
  locale: "auto" | Locale;
  createdAt: string;
  expiresAt: string | null;
}
export interface QuotaRequest {
  id: string;
  venueId: string;
  eventId: string;
  userId: string;
  count: number;
  approved: number;
  reason: string;
  note: string;
  state: "pending" | "approved" | "rejected" | "cancelled";
}
export interface ResetRequest {
  version?: number;
  id: string;
  userId: string;
  email: string;
  challenge: string;
  state: "pending" | "approved" | "rejected" | "completed" | "cancelled";
  method: "direct" | "code" | null;
  verification: string;
  createdAt: string;
  receiptId: string;
}
export interface Audit {
  id: string;
  userId: string;
  venueId: string | null;
  action: string;
  at: string;
}
export interface QueueItem {
  id: string;
  eventId: string;
  guestId?: string;
  kind: "check" | "undo-check" | "walkin" | "undo-walkin";
  state: "queued" | "confirmed" | "conflict" | "rejected" | "scope-closed";
}
export interface AttendanceData {
  walkIns: number;
  undoIds: string[];
  finalized: boolean;
  finalTotal: number | null;
  reason: string;
}
export interface ReportData {
  peak: { at: string; count: number } | null;
  preparationSeconds: number | null;
  confirmationSeconds: number | null;
  confirmedAt: string;
  registered: number;
  checked: number;
  noShow: number;
  removals: number;
  cancellations: number;
  reentries: number;
  contributors: {
    key: string;
    name: string;
    registered: number;
    checked: number;
  }[];
}
export interface MockState {
  planning: PlanningState;
  venues: MockVenue[];
  users: MockUser[];
  events: MockEvent[];
  guests: MockGuest[];
  links: MockLink[];
  requests: QuotaRequest[];
  resetRequests: ResetRequest[];
  audit: Audit[];
  queue: QueueItem[];
  attendance: Record<string, AttendanceData>;
  reports: Record<string, ReportData>;
  ownRsvps: Record<string, string>;
}
export const MOCK_DATE = "2026-09-12";
export const MOCK_NOW = "2026-09-13T00:18:00+09:00";
export const roleLabels: Record<Role, string> = {
  super_admin: "전체 관리자",
  venue_admin: "베뉴 관리자",
  door_staff: "도어 스태프",
  staff: "스태프",
  dj: "DJ",
};
export const viewLabels: Record<View, string> = {
  home: "홈",
  door: "도어 체크인",
  roster: "게스트 명단",
  attendance: "입장 집계",
  events: "행사 관리",
  artists: "아티스트 관리",
  bookings: "부킹 관리",
  schedule: "공유 일정",
  preparation: "행사 준비",
  report: "마감 리포트",
  links: "등록 링크",
  users: "계정 관리",
  "password-requests": "비밀번호 재설정 요청",
  requests: "추가 인원 요청",
  venues: "베뉴 관리",
  analytics: "운영 통계",
  profile: "프로필",
  auth: "로그인",
  external: "외부 등록",
};
export const scenarioLabels: Record<Scenario, string> = {
  normal: "정상",
  loading: "조회 중",
  "read-error": "조회 실패",
  "partial-error": "일부 조회 실패",
  saving: "저장 중",
  "save-error": "저장 실패",
  "unknown-result": "결과 확인 필요",
  stale: "확인 중 데이터 변경",
  offline: "오프라인",
  syncing: "동기화 중",
  conflict: "동기화 충돌",
  rejected: "동기화 거부",
  "scope-closed": "다른 기기에서 마감",
  "session-expired": "세션 만료",
  "access-denied": "접근 불가",
  "link-expired": "링크 만료",
  "link-inactive": "링크 비활성",
  "storage-denied": "저장소 사용 불가",
  "qr-error": "QR 표시 실패",
  "report-inconsistent": "리포트 불일치",
  "rate-limited": "요청 횟수 제한",
  "credential-expired": "설정 시간 만료",
};
