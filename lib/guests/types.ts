export interface Guest {
  id: string;
  venueId: string;
  name: string;
  email?: string | null;
  instagram?: string | null;
  externalLinkId?: string | null;
  createdByUserId?: string | null;
  registeredByName?: string | null;
  eventId?: string | null;
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
