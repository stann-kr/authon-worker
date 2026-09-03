import type { User } from "@/lib/users/types";

export type GuestLimitRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export interface GuestLimitRequest {
  id: string;
  venueId: string;
  userId: string;
  date: string;
  eventId?: string | null;
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
