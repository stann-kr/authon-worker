import type { LinkListCursor, LinkListStats } from "./list-types";
import type { BulkGuestCreateStatus } from "../guests/types";
import type { ExternalDjSuggestion } from "../contributors/types";
import type { Venue } from "../venues/types";

export interface ExternalEventSuggestion {
  eventName: string;
  linkCount: number;
  lastUsedDate: string | null;
}

export interface ExternalLinkCreateSuggestions {
  djs: ExternalDjSuggestion[];
  events: ExternalEventSuggestion[];
}

export interface ExternalDJLink {
  id: string;
  venueId: string;
  token: string;
  djName: string;
  contributorId?: string | null;
  event: string | null;
  date: string | null;
  eventId?: string | null;
  maxGuests: number;
  usedGuests: number;
  active: boolean;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  guestUrl?: string | null;
  localeMode: "auto" | "en" | "ko";
  kind: "contributor" | "self_rsvp";
}

/** Minimal external contributor identity for Door/Admin guest rosters. */
export interface ExternalLinkDirectoryEntry {
  id: string;
  djName: string;
}

/** Public token response shape; internal ownership and audit fields stay server-side. */
export interface ExternalLinkPublicGuest {
  id: string;
  name: string;
  status: "pending" | "checked" | "deleted";
  checkInTime: string | null;
  createdAt: string;
}

export type ExternalLinkPublicGuestCreateItemResult =
  | {
    index: number;
    status: "created";
    guest: ExternalLinkPublicGuest;
  }
  | {
    index: number;
    status: Exclude<BulkGuestCreateStatus, "created">;
    guest: null;
  };

export interface ExternalLinkPublicGuestCreateResult {
  items: ExternalLinkPublicGuestCreateItemResult[];
}

export interface ExternalLinkPublicValidationData {
  link: ExternalDJLink;
  venue: Venue;
  guests: ExternalLinkPublicGuest[];
}

export interface ExternalLinkPage {
  links: ExternalDJLink[];
  nextCursor: LinkListCursor | null;
  stats: LinkListStats;
}

export interface ExternalLinkGuestPage {
  guests: ExternalLinkPublicGuest[];
  nextCursor: LinkListCursor | null;
}
