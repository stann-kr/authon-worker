import { canManageTargetAccount, canManageTargetRole, isRole, isAccountKind, isVenueManagedRole } from "../../../lib/users/policy";
import { assertCapability } from "../data/access";
import type { MockState, MockUser } from "../data/types";

export function requireManagedAccount(data: MockState, actorId: string, targetId: string, venueId: string) {
  const actor = assertCapability(data, actorId, "admin", venueId);
  const target = data.users.find((u) => u.id === targetId && !u.deleted);
  if (!target || !canManageTargetAccount(actor, target) ||
    (target.venueId && !data.venues.some((v) => v.id === target.venueId && v.active)))
    throw Error("이 계정을 변경할 권한이 없습니다.");
  return target;
}

export function validateAccountGrant(actor: MockUser, role: string, kind: string,
  doorAccess: boolean, target?: MockUser) {
  if (!["super_admin", "venue_admin"].includes(actor.role) || !isRole(role) || !isAccountKind(kind) ||
    (!target && (role === "super_admin" || (actor.role !== "super_admin" && !isVenueManagedRole(role)))) ||
    (target && role !== target.role && !canManageTargetRole(actor.role, target.role, role)) ||
    (kind === "shared" && role !== "staff") || (kind === "personal" && doorAccess))
    throw Error("허용된 역할과 계정 유형을 선택해주세요.");
  return { role, accountKind: kind, doorAccess };
}
