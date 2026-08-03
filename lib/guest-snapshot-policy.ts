import type { Role } from "@/lib/users/policy";

interface VenueScopedActor {
  role: Role;
  venueId: string | null;
}

/**
 * 화면 스냅샷 조회가 요청한 베뉴를 인증된 사용자의 범위로 제한합니다.
 */
export function resolveSnapshotVenueId(
  actor: VenueScopedActor,
  requestedVenueId: string | null | undefined,
): string {
  if (!requestedVenueId) throw new Error("Venue is required");
  if (actor.role === "super_admin") return requestedVenueId;
  if (!actor.venueId || actor.venueId !== requestedVenueId) {
    throw new Error("Forbidden");
  }
  return actor.venueId;
}
