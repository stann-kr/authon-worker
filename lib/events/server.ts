import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import type { Event } from "@/lib/api/types";
import {
  canCheckInToEvent,
  canRegisterForEvent,
  getCompatibilityEventKey,
  isEventState,
} from "@/lib/events/domain";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof events.$inferSelect;

export function toEvent(row: EventRow): Event {
  if (!isEventState(row.state)) throw new Error("INVALID_EVENT_STATE");
  return { ...row, state: row.state };
}

export async function loadEventById(
  db: Db,
  eventId: string,
): Promise<Event | null> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  return row ? toEvent(row) : null;
}

export function eventIncludesLegacyDateRows(event: Event): boolean {
  return event.compatibilityKey === getCompatibilityEventKey(
    event.venueId,
    event.businessDate,
  );
}

export async function resolveEventForRosterRead(params: {
  venueId: string;
  businessDate: string;
  eventId?: string | null;
}): Promise<Event | null> {
  const venueId = await requireActiveVenueId(params.venueId);
  const db = getDb();
  if (!params.eventId) {
    return findCompatibilityEvent(venueId, params.businessDate);
  }

  const [row] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, params.eventId),
        eq(events.venueId, venueId),
        eq(events.businessDate, params.businessDate),
      ),
    )
    .limit(1);
  if (!row) throw new Error("EVENT_NOT_FOUND");
  return toEvent(row);
}

export async function resolveEventForRosterWrite(params: {
  venueId: string;
  businessDate: string;
  eventId?: string | null;
  actorUserId?: string | null;
  purpose: "register" | "check_in";
}): Promise<Event> {
  const venueId = await requireActiveVenueId(params.venueId);
  const db = getDb();

  if (params.eventId) {
    const [row] = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.id, params.eventId),
          eq(events.venueId, venueId),
          eq(events.businessDate, params.businessDate),
        ),
      )
      .limit(1);
    if (!row) throw new Error("EVENT_NOT_FOUND");
    const event = toEvent(row);
    const allowed =
      params.purpose === "check_in"
        ? canCheckInToEvent(event.state)
        : canRegisterForEvent(event.state);
    if (!allowed) throw new Error("EVENT_NOT_ACTIVE");
    return event;
  }

  const compatibilityKey = getCompatibilityEventKey(venueId, params.businessDate);
  const now = new Date().toISOString();
  const proposedId = crypto.randomUUID();
  await db
    .insert(events)
    .values({
      id: proposedId,
      venueId,
      businessDate: params.businessDate,
      name: params.businessDate,
      state: "open",
      compatibilityKey,
      createdByUserId: params.actorUserId ?? null,
      updatedByUserId: params.actorUserId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(events)
    .where(eq(events.compatibilityKey, compatibilityKey))
    .limit(1);
  if (!row || row.venueId !== venueId || row.businessDate !== params.businessDate) {
    throw new Error("EVENT_NOT_FOUND");
  }
  const event = toEvent(row);
  const allowed =
    params.purpose === "check_in"
      ? canCheckInToEvent(event.state)
      : canRegisterForEvent(event.state);
  if (!allowed) throw new Error("EVENT_NOT_ACTIVE");
  return event;
}

export async function findCompatibilityEvent(
  venueId: string,
  businessDate: string,
): Promise<Event | null> {
  const db = getDb();
  const compatibilityKey = getCompatibilityEventKey(venueId, businessDate);
  const [row] = await db
    .select()
    .from(events)
    .where(eq(events.compatibilityKey, compatibilityKey))
    .limit(1);
  return row ? toEvent(row) : null;
}
