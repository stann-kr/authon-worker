export const USER_ROLES = [
  "super_admin",
  "venue_admin",
  "door_staff",
  "staff",
  "dj",
] as const;

export type Role = (typeof USER_ROLES)[number];

export const ACCOUNT_KINDS = ["personal", "shared"] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export type AccessScope = "guest" | "door" | "admin" | "venue";

export interface AccessSubject {
  role: Role;
  accountKind: AccountKind;
  doorAccessEnabled: boolean;
}

export const VENUE_MANAGED_ROLES = ["door_staff", "staff", "dj"] as const;

export type VenueManagedRole = (typeof VENUE_MANAGED_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && USER_ROLES.some((role) => role === value);
}

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === "string" && ACCOUNT_KINDS.some((kind) => kind === value);
}

export function hasAccess(subject: AccessSubject, requiredAccess: AccessScope[]): boolean {
  const accessMap: Record<Role, AccessScope[]> = {
    super_admin: ["guest", "door", "admin", "venue"],
    venue_admin: ["guest", "door", "admin"],
    door_staff: ["door", "guest"],
    staff: ["guest"],
    dj: ["guest"],
  };

  return requiredAccess.some(
    (access) =>
      accessMap[subject.role].includes(access) ||
      (access === "door" &&
        subject.accountKind === "shared" &&
        subject.doorAccessEnabled),
  );
}

export function canRequestGuestLimit(subject: AccessSubject): boolean {
  return (
    subject.accountKind === "personal" &&
    (subject.role === "staff" || subject.role === "dj")
  );
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

export function canDiscoverTargetRole(actorRole: Role, targetRole: Role): boolean {
  return actorRole === "super_admin" || targetRole !== "super_admin";
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
