"use server";

import { and, asc, desc, eq, ne } from "drizzle-orm";
import { reportServerError } from "@/lib/observability/structured-log";
import { requireAccess, requireAuth, type SessionUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import type { ApiResponse, Event, EventState } from "@/lib/api/types";
import {
  canTransitionEventState,
  isBusinessDate,
  isEventState,
  prepareEventDraft,
  type EventDraftInput,
} from "@/lib/events/domain";
import { loadEventById, toEvent } from "@/lib/events/server";

type Db = ReturnType<typeof getDb>;

async function resolveActorVenueId(
  actor: SessionUser,
  requestedVenueId?: string | null,
): Promise<string> {
  const venueId = actor.role === "super_admin" ? requestedVenueId : actor.venueId;
  if (
    !venueId ||
    (actor.role !== "super_admin" &&
      requestedVenueId !== undefined &&
      requestedVenueId !== null &&
      requestedVenueId !== actor.venueId)
  ) {
    throw new Error("FORBIDDEN");
  }
  return requireActiveVenueId(venueId);
}

async function requireManagedEvent(
  db: Db,
  actor: SessionUser,
  eventId: string,
): Promise<Event> {
  const event = await loadEventById(db, eventId);
  if (!event) throw new Error("EVENT_NOT_FOUND");
  if (actor.role !== "super_admin" && event.venueId !== actor.venueId) {
    throw new Error("FORBIDDEN");
  }
  await requireActiveVenueId(event.venueId);
  return event;
}

export async function fetchEvents(params: {
  venueId?: string | null;
  businessDate?: string | null;
  includeArchived?: boolean;
} = {}): Promise<ApiResponse<Event[]>> {
  try {
    const actor = await requireAuth();
    const venueId = await resolveActorVenueId(actor, params.venueId);
    if (params.businessDate && !isBusinessDate(params.businessDate)) {
      return { data: null, error: "INVALID_BUSINESS_DATE" };
    }
    const conditions = [eq(events.venueId, venueId)];
    if (params.businessDate) conditions.push(eq(events.businessDate, params.businessDate));
    if (!params.includeArchived) conditions.push(ne(events.state, "archived"));

    const rows = await getDb()
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.businessDate), asc(events.doorOpensAt), asc(events.createdAt));
    return { data: rows.map(toEvent), error: null };
  } catch (error: unknown) {
    await reportServerError("event.list", error);
    return { data: null, error: "EVENT_LIST_FAILED" };
  }
}

export async function createEvent(params: EventDraftInput & {
  venueId?: string | null;
}): Promise<ApiResponse<Event>> {
  try {
    const actor = await requireAccess("admin");
    const venueId = await resolveActorVenueId(actor, params.venueId);
    const prepared = prepareEventDraft(params);
    if (prepared.error || !prepared.draft) {
      return { data: null, error: prepared.error ?? "INVALID_EVENT" };
    }

    const db = getDb();
    if (prepared.draft.templateSourceEventId) {
      const source = await requireManagedEvent(
        db,
        actor,
        prepared.draft.templateSourceEventId,
      );
      if (source.venueId !== venueId) {
        return { data: null, error: "INVALID_TEMPLATE_SOURCE" };
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(events).values({
      id,
      venueId,
      ...prepared.draft,
      state: "draft",
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    });
    const created = await loadEventById(db, id);
    if (!created) throw new Error("EVENT_CREATE_READBACK_FAILED");
    return { data: created, error: null };
  } catch (error: unknown) {
    await reportServerError("event.create", error);
    return { data: null, error: "EVENT_CREATE_FAILED" };
  }
}

export async function updateEvent(
  eventId: string,
  updates: Partial<{
    businessDate: string;
    name: string;
    doorOpensAt: string | null;
    guestCutoffAt: string | null;
    capacity: number | null;
    targetGuests: number | null;
  }>,
): Promise<ApiResponse<Event>> {
  try {
    const actor = await requireAccess("admin");
    const db = getDb();
    const current = await requireManagedEvent(db, actor, eventId);
    if (current.state !== "draft" && updates.businessDate !== undefined) {
      return { data: null, error: "EVENT_DATE_LOCKED" };
    }
    const prepared = prepareEventDraft({
      businessDate: updates.businessDate ?? current.businessDate,
      name: updates.name ?? current.name,
      doorOpensAt:
        updates.doorOpensAt !== undefined
          ? updates.doorOpensAt
          : current.doorOpensAt,
      guestCutoffAt:
        updates.guestCutoffAt !== undefined
          ? updates.guestCutoffAt
          : current.guestCutoffAt,
      capacity:
        updates.capacity !== undefined ? updates.capacity : current.capacity,
      targetGuests:
        updates.targetGuests !== undefined
          ? updates.targetGuests
          : current.targetGuests,
      templateSourceEventId: current.templateSourceEventId,
    });
    if (prepared.error || !prepared.draft) {
      return { data: null, error: prepared.error ?? "INVALID_EVENT" };
    }
    const now = new Date().toISOString();
    const [updated] = await db
      .update(events)
      .set({
        ...prepared.draft,
        updatedByUserId: actor.id,
        updatedAt: now,
      })
      .where(and(eq(events.id, eventId), eq(events.venueId, current.venueId)))
      .returning();
    return { data: updated ? toEvent(updated) : null, error: updated ? null : "EVENT_NOT_FOUND" };
  } catch (error: unknown) {
    await reportServerError("event.update", error);
    return { data: null, error: "EVENT_UPDATE_FAILED" };
  }
}

export async function transitionEventState(
  eventId: string,
  nextState: EventState,
): Promise<ApiResponse<Event>> {
  try {
    if (!isEventState(nextState)) return { data: null, error: "INVALID_EVENT_STATE" };
    const actor = await requireAccess("admin");
    const db = getDb();
    const current = await requireManagedEvent(db, actor, eventId);
    if (!canTransitionEventState(current.state, nextState)) {
      return { data: null, error: "INVALID_EVENT_TRANSITION" };
    }
    const now = new Date().toISOString();
    const [updated] = await db
      .update(events)
      .set({
        state: nextState,
        updatedByUserId: actor.id,
        updatedAt: now,
        closedAt: nextState === "closed" ? now : current.closedAt,
      })
      .where(
        and(
          eq(events.id, eventId),
          eq(events.venueId, current.venueId),
          eq(events.state, current.state),
        ),
      )
      .returning();
    if (!updated) return { data: null, error: "EVENT_STATE_CHANGED" };
    return { data: toEvent(updated), error: null };
  } catch (error: unknown) {
    await reportServerError("event.transition", error);
    return { data: null, error: "EVENT_TRANSITION_FAILED" };
  }
}
