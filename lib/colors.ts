/**
 * colors.ts — 앱 전체 색상 매핑 중앙 관리
 *
 * 역할, 상태, 베뉴 타입 등의 색상을 이 파일에서 일괄 관리합니다.
 */

// ─── Role 색상 ───────────────────────────────────────────────
export const roleColorMap: Record<string, string> = {
  super_admin: "text-text-heading",
  venue_admin: "text-text-muted",
  door_staff: "text-text-muted",
  staff: "text-text-muted",
  dj: "text-text-muted",
};

export function getRoleColor(role?: string | null): string {
  if (!role) return "text-text-muted";
  return roleColorMap[role] ?? "text-text-muted";
}

// ─── 활성/비활성 상태 색상 ────────────────────────────────────
export function getActiveColor(active: boolean): string {
  return active ? "text-status-checked" : "text-status-danger";
}

// ─── 게스트 상태 색상 ─────────────────────────────────────────
export const guestStatusColorMap: Record<string, string> = {
  pending: "text-status-waiting",
  checked: "text-status-checked",
  deleted: "text-text-dim",
};

export function getGuestStatusColor(status?: string | null): string {
  if (!status) return "text-text-muted";
  return guestStatusColorMap[status] ?? "text-text-muted";
}

// ─── 베뉴 타입 색상 ───────────────────────────────────────────
export const venueTypeColorMap: Record<string, string> = {
  club: "text-text-heading",
  bar: "text-text-muted",
  lounge: "text-text-muted",
  festival: "text-text-muted",
  private: "text-text-dim",
};

export function getVenueTypeColor(type?: string | null): string {
  if (!type) return "text-text-muted";
  return venueTypeColorMap[type] ?? "text-text-muted";
}

// ─── StatGrid 색상 ────────────────────────────────────────────
export type StatColor = "default" | "muted" | "danger" | "checked" | "waiting";

export const statColorMap: Record<StatColor, string> = {
  default: "text-text-heading",
  muted: "text-text-muted",
  danger: "text-status-danger",
  checked: "text-status-checked",
  waiting: "text-status-waiting",
};

export const statLabelColorMap: Record<StatColor, string> = {
  default: "text-text-muted",
  muted: "text-text-dim",
  danger: "text-status-danger",
  checked: "text-status-checked",
  waiting: "text-status-waiting",
};
