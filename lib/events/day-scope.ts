import { and, desc, eq, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import type { getDb } from "../db/client";
import { events, externalDjLinks, guests } from "../db/schema";
import type { Guest } from "../guests/types";

type Db = ReturnType<typeof getDb>;

// The Door's whole-day view: every Event the venue holds on the business date,
// plus the legacy rows that carry only that date and no Event.

function dayEventIds(db: Db, venueId: string, businessDate: string) {
  return db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.venueId, venueId), eq(events.businessDate, businessDate)));
}

/**
 * Active guests on any of the day's Events, or dated that day without an Event, newest first.
 * The two sets are disjoint; UNION ALL lets each branch use its own event or venue/date index.
 */
export async function loadDayGuests(db: Db, venueId: string, businessDate: string): Promise<Guest[]> {
  const select = (scope: SQL) => db
    .select()
    .from(guests)
    .where(and(ne(guests.status, "deleted"), scope));
  // The Event ids already belong to this venue, so that branch skips the venue filter;
  // with it, SQLite reads the venue's whole history instead of the (event_id, status) index.
  const rows = await select(inArray(guests.eventId, dayEventIds(db, venueId, businessDate)))
    .unionAll(select(and(eq(guests.venueId, venueId), isNull(guests.eventId), eq(guests.date, businessDate))!))
    .orderBy(desc(guests.createdAt));
  return rows.map((guest) => ({ ...guest, status: guest.status as Guest["status"] }));
}

/** External links of any of the day's Events, or dated that day without an Event. Callers add the venue filter. */
export function dayExternalLinkScope(db: Db, venueId: string, businessDate: string): SQL {
  return or(
    inArray(externalDjLinks.eventId, dayEventIds(db, venueId, businessDate)),
    and(isNull(externalDjLinks.eventId), eq(externalDjLinks.date, businessDate)),
  )!;
}
