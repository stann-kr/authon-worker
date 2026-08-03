export const USER_ROLES = [
  "super_admin",
  "venue_admin",
  "door_staff",
  "staff",
  "dj",
] as const;

export type Role = (typeof USER_ROLES)[number];

export const VENUE_MANAGED_ROLES = ["door_staff", "staff", "dj"] as const;

export type VenueManagedRole = (typeof VENUE_MANAGED_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && USER_ROLES.some((role) => role === value);
}

export function isVenueManagedRole(value: unknown): value is VenueManagedRole {
  return (
    typeof value === "string" &&
    VENUE_MANAGED_ROLES.some((role) => role === value)
  );
}

export function canManageTargetRole(
  actorRole: Role,
  targetRole: Role,
  nextRole: Role,
): boolean {
  if (nextRole === "super_admin" || targetRole === "super_admin") {
    return false;
  }

  if (actorRole === "super_admin") {
    return nextRole === "venue_admin" || isVenueManagedRole(nextRole);
  }

  return (
    actorRole === "venue_admin" &&
    isVenueManagedRole(targetRole) &&
    isVenueManagedRole(nextRole)
  );
}

export function canManageTargetAccount(
  actor: { id: string; role: Role; venueId: string | null },
  target: { id: string; role: Role; venueId: string | null },
): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === "super_admin") return true;

  return (
    actor.role === "venue_admin" &&
    actor.venueId !== null &&
    actor.venueId === target.venueId &&
    isVenueManagedRole(target.role)
  );
}
