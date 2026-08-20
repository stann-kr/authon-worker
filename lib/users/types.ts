export interface User {
  id: string;
  venueId: string | null; // null for super_admin
  email: string;
  name: string;
  role: "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
  accountKind: "personal" | "shared";
  doorAccessEnabled: boolean;
  guestLimit: number | null;
  active: boolean;
  migrationStatus: "native" | "pending_reset" | "active";
  preferredLocale: "en" | "ko" | null;
  passwordSetAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  deletedAt: string | null;
}

export interface UserDirectoryEntry {
  id: string;
  name: string;
  role: User["role"];
  accountKind: User["accountKind"];
  doorAccessEnabled: boolean;
}

export interface UserAuditEvent {
  id: string;
  venueId: string | null;
  actorUserId: string | null;
  targetUserId: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface UserProfileUpdateInput {
  name?: string;
  guestLimit?: number | null;
  active?: boolean;
  role?: User["role"];
  accountKind?: User["accountKind"];
  doorAccessEnabled?: boolean;
}

export interface ManagedUserCreateInput {
  email: string;
  name: string;
  role: User["role"];
  venueId?: string | null;
  guestLimit?: number | null;
  preferredLocale?: User["preferredLocale"];
  accountKind?: User["accountKind"];
  doorAccessEnabled?: boolean;
}

export interface ManagedUserCreateResult {
  id: string;
  invitationUrl: string;
  expiresAt: string;
}

export interface ManagedPasswordLinkResult {
  linkKind: "invitation" | "password_reset";
  passwordUrl: string;
  expiresAt: string;
}
