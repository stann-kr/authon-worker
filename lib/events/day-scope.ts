import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { getDb } from "../db/client";
import { events, externalDjLinks, guests } from "../db/schema";

type Db = ReturnType<typeof getDb>;

// The Door's whole-day view: every Event the venue holds on the business date,
// plus the legacy rows that carry only that date and no Event.

function dayEventIds(db: Db, venueId: string, businessDate: string) {
  return db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.venueId, venueId), eq(events.businessDate, businessDate)));
}

/** Guests on any of the day's Events, or dated that day without an Event. Callers add the venue and status filters. */
export function dayGuestScope(db: Db, venueId: string, businessDate: string): SQL {
  return or(
    inArray(guests.eventId, dayEventIds(db, venueId, businessDate)),
    and(isNull(guests.eventId), eq(guests.date, businessDate)),
  )!;
}

/** External links of any of the day's Events, or dated that day without an Event. Callers add the venue filter. */
export function dayExternalLinkScope(db: Db, venueId: string, businessDate: string): SQL {
  return or(
    inArray(externalDjLinks.eventId, dayEventIds(db, venueId, businessDate)),
    and(isNull(externalDjLinks.eventId), eq(externalDjLinks.date, businessDate)),
  )!;
}
