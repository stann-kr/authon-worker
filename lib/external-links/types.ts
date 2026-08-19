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
