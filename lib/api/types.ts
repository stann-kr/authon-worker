export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

export interface Venue {
  id: string;
  name: string;
  type: "club" | "bar" | "lounge" | "festival" | "private";
  address?: string | null;
  description?: string | null;
  brandName?: string | null;
  brandTagline?: string | null;
  brandDescription?: string | null;
  brandFooter?: string | null;
  primaryDomain?: string | null;
  defaultLocale?: "en" | "ko" | null;
  timezone: string;
  openingTime: string;
  closingTime: string;
  active: boolean;
}

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

export interface Guest {
  id: string;
  venueId: string;
  name: string;
  email?: string | null;
  instagram?: string | null;
  externalLinkId?: string | null;
  createdByUserId?: string | null;
  registeredByName?: string | null;
  status: "pending" | "checked" | "deleted";
  checkInTime?: string | null;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface BulkGuestCreateInput {
  name: string;
  allowDuplicate?: boolean;
}

export type BulkGuestCreateStatus =
  | "created"
  | "duplicate_requires_confirmation"
  | "batch_changed"
  | "invalid_name"
  | "limit_reached";

export type BulkGuestCreateItemResult =
  | {
    index: number;
    status: "created";
    guest: Guest;
  }
  | {
    index: number;
    status: Exclude<BulkGuestCreateStatus, "created">;
    guest: null;
  };

export interface BulkGuestCreateResult {
  items: BulkGuestCreateItemResult[];
}

export type GuestLimitRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface GuestLimitRequest {
  id: string;
  venueId: string;
  userId: string;
  date: string;
  requestedExtra: number;
  approvedExtra: number;
  reason: string | null;
  status: GuestLimitRequestStatus;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuestLimitRequestView extends GuestLimitRequest {
  userName: string;
  userRole: User["role"];
}

export interface GuestQuota {
  date: string;
  baseLimit: number | null;
  approvedExtra: number;
  effectiveLimit: number | null;
  used: number;
  remaining: number | null;
  canRequestExtra: boolean;
  pendingRequest: GuestLimitRequest | null;
}

export interface ExternalDJLink {
  id: string;
  venueId: string;
  token: string;
  djName: string;
  event: string | null;
  date: string | null;
  maxGuests: number;
  usedGuests: number;
  active: boolean;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  guestUrl?: string | null;
  localeMode: "auto" | "en" | "ko";
}

/** Minimal external contributor identity for Door/Admin guest rosters. */
export interface ExternalLinkDirectoryEntry {
  id: string;
  djName: string;
}

export interface GuestOperationsSnapshot {
  guests: Guest[];
  users: UserDirectoryEntry[];
  externalLinks: ExternalLinkDirectoryEntry[];
  failedSections: Array<"guests" | "users" | "externalLinks">;
}

export interface GuestWorkspaceSnapshot {
  guests: Guest[];
  quota: GuestQuota | null;
  failedSections: Array<"guests" | "quota">;
}
