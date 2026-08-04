import type { ExternalDJLink } from "../api/types";

export type ExternalLinkDeletionDisposition = "archive" | "hard-delete";

interface ExternalLinkRecord {
  id: string;
  venueId: string;
  token: string;
  djName: string;
  event: string | null;
  date: string | null;
  maxGuests: number;
  usedGuests: number;
  active: boolean;
  expiresAt: string | null;
  createdBy: string | null;
  localeMode: string;
  createdAt: string | null;
}

export function getExternalLinkDeletionDisposition(
  hasGuestHistory: boolean,
): ExternalLinkDeletionDisposition {
  return hasGuestHistory ? "archive" : "hard-delete";
}

export function toExternalDJLink(
  link: ExternalLinkRecord,
  guestUrl?: string | null,
): ExternalDJLink {
  return {
    id: link.id,
    venueId: link.venueId,
    token: link.token,
    djName: link.djName,
    event: link.event,
    date: link.date,
    maxGuests: link.maxGuests,
    usedGuests: link.usedGuests,
    active: link.active,
    expiresAt: link.expiresAt,
    createdBy: link.createdBy,
    createdAt: link.createdAt,
    guestUrl,
    localeMode:
      link.localeMode === "en" || link.localeMode === "ko"
        ? link.localeMode
        : "auto",
  };
}
