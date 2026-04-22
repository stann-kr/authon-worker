/**
 * colors.ts — 앱 전체 색상 매핑 중앙 관리
 *
 * 역할, 상태, 베뉴 타입 등의 색상을 이 파일에서 일괄 관리합니다.
 */

// ─── Role 색상 ───────────────────────────────────────────────
export const roleColorMap: Record<string, string> = {
  super_admin: "text-purple-400",
  venue_admin: "text-red-400",
  door_staff: "text-blue-400",
  staff: "text-cyan-400",
  dj: "text-green-400",
};

export function getRoleColor(role?: string | null): string {
  if (!role) return "text-gray-400";
  return roleColorMap[role] ?? "text-gray-400";
}

// ─── 활성/비활성 상태 색상 ────────────────────────────────────
export function getActiveColor(active: boolean): string {
  return active ? "text-green-400" : "text-red-400";
}

// ─── 게스트 상태 색상 ─────────────────────────────────────────
export const guestStatusColorMap: Record<string, string> = {
  pending: "text-yellow-400",
  checked: "text-green-400",
  deleted: "text-gray-500",
};

export function getGuestStatusColor(status?: string | null): string {
  if (!status) return "text-gray-400";
  return guestStatusColorMap[status] ?? "text-gray-400";
}

// ─── 베뉴 타입 색상 ───────────────────────────────────────────
export const venueTypeColorMap: Record<string, string> = {
  club: "text-purple-400",
  bar: "text-amber-400",
  lounge: "text-cyan-400",
  festival: "text-pink-400",
  private: "text-gray-400",
};

export function getVenueTypeColor(type?: string | null): string {
  if (!type) return "text-gray-400";
  return venueTypeColorMap[type] ?? "text-gray-400";
}

// ─── StatGrid 색상 ────────────────────────────────────────────
export type StatColor = "white" | "green" | "red" | "cyan" | "blue" | "yellow";

export const statColorMap: Record<StatColor, string> = {
  white: "text-white",
  green: "text-green-400",
  red: "text-red-400",
  cyan: "text-cyan-400",
  blue: "text-blue-400",
  yellow: "text-yellow-400",
};

export const statLabelColorMap: Record<StatColor, string> = {
  white: "text-gray-400",
  green: "text-green-300",
  red: "text-red-300",
  cyan: "text-cyan-300",
  blue: "text-blue-300",
  yellow: "text-yellow-300",
};
