"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { reportServerError } from "@/lib/observability/structured-log";
import { requireAccess, requireAuth, type SessionUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import {
  eventContributorLimits,
  events,
  externalDjLinks,
  guests,
  users,
} from "@/lib/db/schema";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import type {
  ApiResponse,
  Event,
  EventCreationResult,
  EventState,
} from "@/lib/api/types";
import {
  canTransitionEventState,
  isBusinessDate,
  isEventState,
  prepareEventDraft,
  type EventDraftInput,
} from "@/lib/events/domain";
import { loadEventById, toEvent } from "@/lib/events/server";
import { buildEventTemplateClonePlan } from "@/lib/events/template";

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
}): Promise<ApiResponse<EventCreationResult>> {
  try {
    const actor = await requireAccess("admin");
    const venueId = await resolveActorVenueId(actor, params.venueId);
    const prepared = prepareEventDraft(params);
    if (prepared.error || !prepared.draft) {
      return { data: null, error: prepared.error ?? "INVALID_EVENT" };
    }

    const db = getDb();
    let sourceContributors: Array<{ userId: string; guestLimit: number | null }> = [];
    let sourceLinks: Array<typeof externalDjLinks.$inferSelect> = [];
    if (prepared.draft.templateSourceEventId) {
      const source = await requireManagedEvent(
        db,
        actor,
        prepared.draft.templateSourceEventId,
      );
      if (source.venueId !== venueId) {
        return { data: null, error: "INVALID_TEMPLATE_SOURCE" };
      }
      const [configuredContributors, observedContributors, links] = await Promise.all([
        db
          .select({
            userId: eventContributorLimits.userId,
            guestLimit: eventContributorLimits.guestLimit,
          })
          .from(eventContributorLimits)
          .where(eq(eventContributorLimits.eventId, source.id)),
        db
          .selectDistinct({ userId: users.id, guestLimit: users.guestLimit })
          .from(guests)
          .innerJoin(users, eq(guests.createdByUserId, users.id))
          .where(
            and(
              eq(guests.eventId, source.id),
              eq(users.venueId, venueId),
              eq(users.active, true),
              isNull(users.deletedAt),
            ),
          ),
        db
          .select()
          .from(externalDjLinks)
          .where(
            and(
              eq(externalDjLinks.eventId, source.id),
              eq(externalDjLinks.venueId, venueId),
              isNull(externalDjLinks.deletedAt),
            ),
          ),
      ]);
      const contributorMap = new Map(
        observedContributors.map((contributor) => [contributor.userId, contributor]),
      );
      for (const contributor of configuredContributors) {
        contributorMap.set(contributor.userId, contributor);
      }
      sourceContributors = [...contributorMap.values()];
      sourceLinks = links;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clonePlan = prepared.draft.templateSourceEventId
      ? buildEventTemplateClonePlan({
          eventId: id,
          venueId,
          sourceEventId: prepared.draft.templateSourceEventId,
          eventName: prepared.draft.name,
          businessDate: prepared.draft.businessDate,
          actorUserId: actor.id,
          createdAt: now,
          contributors: sourceContributors,
          links: sourceLinks,
          createOpaqueId: () => crypto.randomUUID(),
        })
      : { contributors: [], links: [] };
    const { env } = getCloudflareContext();
    const statements = [
      env.DB.prepare(`
        INSERT INTO events (
          id, venue_id, business_date, name, door_opens_at, guest_cutoff_at,
          capacity, target_guests, state, template_source_event_id,
          created_by_user_id, updated_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
      `).bind(
        id,
        venueId,
        prepared.draft.businessDate,
        prepared.draft.name,
        prepared.draft.doorOpensAt,
        prepared.draft.guestCutoffAt,
        prepared.draft.capacity,
        prepared.draft.targetGuests,
        prepared.draft.templateSourceEventId,
        actor.id,
        actor.id,
        now,
        now,
      ),
      ...clonePlan.contributors.map((contributor) =>
        env.DB.prepare(`
          INSERT INTO event_contributor_limits (
            event_id, venue_id, user_id, guest_limit, source_event_id,
            created_by_user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          venueId,
          contributor.userId,
          contributor.guestLimit,
          contributor.sourceEventId,
          contributor.createdByUserId,
          contributor.createdAt,
        ),
      ),
      ...clonePlan.links.map((link) =>
        env.DB.prepare(`
          INSERT INTO external_dj_links (
            id, venue_id, token, dj_name, contributor_id, event, date, event_id,
            max_guests, used_guests, active, expires_at, created_by,
            locale_mode, kind, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
        `).bind(
          link.id,
          link.venueId,
          link.token,
          link.djName,
          link.contributorId,
          link.event,
          link.date,
          link.eventId,
          link.maxGuests,
          link.expiresAt,
          link.createdBy,
          link.localeMode,
          link.kind,
          link.createdAt,
        ),
      ),
      ...clonePlan.links
        .filter((link) => link.contributorId !== null)
        .map((link) =>
          env.DB.prepare(`
            INSERT INTO contributor_audit_events (
              id, venue_id, contributor_id, actor_user_id, source_kind,
              source_id, action, details, created_at
            ) VALUES (?, ?, ?, ?, 'external_link', ?, 'mapped', ?, ?)
          `).bind(
            crypto.randomUUID(),
            link.venueId,
            link.contributorId,
            actor.id,
            link.id,
            JSON.stringify({ reason: "event_template_clone" }),
            now,
          ),
        ),
    ];
    await env.DB.batch(statements);
    const created = await loadEventById(db, id);
    if (!created) throw new Error("EVENT_CREATE_READBACK_FAILED");
    return {
      data: {
        event: created,
        templateClone: {
          contributors: sourceContributors.length,
          externalLinks: sourceLinks.length,
        },
      },
      error: null,
    };
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
        openedAt:
          nextState === "open" ? current.openedAt ?? now : current.openedAt,
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
