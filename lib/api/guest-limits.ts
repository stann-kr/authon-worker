"use server";

import { reportServerError } from "@/lib/observability/structured-log";

import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { guestLimitRequests, guests, users } from "../db/schema";
import {
  type ApiResponse,
  type GuestLimitRequest,
  type GuestLimitRequestStatus,
  type GuestLimitRequestView,
  type GuestQuota,
} from "./types";
import { requireAccess, requireAuth, requireRole } from "../auth/server";
import { getDb } from "../db/client";
import { requireActiveVenueId } from "../tenant/active-server";
import { canRequestGuestLimit, isRole } from "@/lib/users/policy";
import {
  eventIncludesLegacyDateRows,
  findCompatibilityEvent,
  loadEventById,
  resolveEventForRosterWrite,
} from "@/lib/events/server";
import type { Event } from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toRequest(row: typeof guestLimitRequests.$inferSelect): GuestLimitRequest {
  const statuses: GuestLimitRequestStatus[] = ["pending", "approved", "rejected", "cancelled"];
  if (!statuses.includes(row.status as GuestLimitRequestStatus)) {
    throw new Error("Invalid guest limit request status");
  }
  return { ...row, status: row.status as GuestLimitRequestStatus };
}

export async function fetchMyGuestQuota(
  date: string,
  eventId?: string | null,
): Promise<ApiResponse<GuestQuota>> {
  try {
    if (!isValidDate(date)) throw new Error("INVALID_DATE");
    const actor = await requireAccess("guest");
    if (!actor.venueId) throw new Error("FORBIDDEN");
    await requireActiveVenueId(actor.venueId);
    const db = getDb();
    let event: Event | null = null;
    if (eventId) {
      event = await loadEventById(db, eventId);
      if (
        !event ||
        event.venueId !== actor.venueId ||
        event.businessDate !== date
      ) {
        throw new Error("EVENT_NOT_FOUND");
      }
    } else {
      event = await findCompatibilityEvent(actor.venueId, date);
    }
    const includeLegacyRows = event ? eventIncludesLegacyDateRows(event) : true;
    const guestScope = event
      ? includeLegacyRows
        ? or(
            eq(guests.eventId, event.id),
            and(isNull(guests.eventId), eq(guests.date, date)),
          )
        : eq(guests.eventId, event.id)
      : and(isNull(guests.eventId), eq(guests.date, date));
    const requestScope = event
      ? includeLegacyRows
        ? or(
            eq(guestLimitRequests.eventId, event.id),
            and(
              isNull(guestLimitRequests.eventId),
              eq(guestLimitRequests.date, date),
            ),
          )
        : eq(guestLimitRequests.eventId, event.id)
      : and(
          isNull(guestLimitRequests.eventId),
          eq(guestLimitRequests.date, date),
        );

    const [usage, extra, pending] = await Promise.all([
      db
        .select({ used: sql<number>`count(*)` })
        .from(guests)
        .where(
          and(
            eq(guests.createdByUserId, actor.id),
            guestScope,
            ne(guests.status, "deleted"),
          ),
        ),
      db
        .select({ approvedExtra: sql<number>`coalesce(sum(${guestLimitRequests.approvedExtra}), 0)` })
        .from(guestLimitRequests)
        .where(
          and(
            eq(guestLimitRequests.userId, actor.id),
            requestScope,
            eq(guestLimitRequests.status, "approved"),
          ),
        ),
      db
        .select()
        .from(guestLimitRequests)
        .where(
          and(
            eq(guestLimitRequests.userId, actor.id),
            requestScope,
            eq(guestLimitRequests.status, "pending"),
          ),
        )
        .limit(1),
    ]);

    const used = Number(usage[0]?.used ?? 0);
    const approvedExtra = Number(extra[0]?.approvedExtra ?? 0);
    const effectiveLimit = actor.guestLimit === null ? null : actor.guestLimit + approvedExtra;

    return {
      data: {
        date,
        baseLimit: actor.guestLimit,
        approvedExtra,
        effectiveLimit,
        used,
        remaining: effectiveLimit === null ? null : Math.max(0, effectiveLimit - used),
        canRequestExtra: canRequestGuestLimit(actor) && actor.guestLimit !== null,
        pendingRequest: pending[0] ? toRequest(pending[0]) : null,
      },
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("guest_limit.quota.load", error);
    return { data: null, error: "Unable to load guest quota right now." };
  }
}

export async function createGuestLimitRequest(params: {
  date: string;
  eventId?: string | null;
  requestedExtra: number;
  reason?: string | null;
}): Promise<ApiResponse<GuestLimitRequest>> {
  try {
    const actor = await requireAuth();
    if (!canRequestGuestLimit(actor) || !actor.venueId || actor.guestLimit === null) {
      return { data: null, error: "REQUEST_NOT_ALLOWED" };
    }
    if (!isValidDate(params.date)) return { data: null, error: "INVALID_DATE" };
    if (!Number.isInteger(params.requestedExtra) || params.requestedExtra < 1 || params.requestedExtra > 10) {
      return { data: null, error: "INVALID_EXTRA" };
    }

    const reason = params.reason?.trim() || null;
    if (reason && reason.length > 200) return { data: null, error: "INVALID_REASON" };

    const db = getDb();
    const event = await resolveEventForRosterWrite({
      venueId: actor.venueId,
      businessDate: params.date,
      eventId: params.eventId,
      actorUserId: actor.id,
      purpose: "register",
    });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.insert(guestLimitRequests).values({
      id,
      venueId: actor.venueId,
      userId: actor.id,
      date: params.date,
      eventId: event.id,
      requestedExtra: params.requestedExtra,
      approvedExtra: 0,
      reason,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db.select().from(guestLimitRequests).where(eq(guestLimitRequests.id, id));
    return { data: created ? toRequest(created) : null, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) {
      return { data: null, error: "PENDING_REQUEST_EXISTS" };
    }
    await reportServerError("guest_limit.request.create", error);
    return { data: null, error: "REQUEST_FAILED" };
  }
}

export async function fetchGuestLimitRequests(
  venueId?: string | null,
  eventId?: string | null,
  businessDate?: string | null,
): Promise<ApiResponse<GuestLimitRequestView[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const effectiveVenueId = actor.role === "super_admin" ? venueId : actor.venueId;
    if (!effectiveVenueId) throw new Error("FORBIDDEN");
    await requireActiveVenueId(effectiveVenueId);
    const db = getDb();
    const conditions = [eq(guestLimitRequests.venueId, effectiveVenueId)];
    if (eventId) {
      const event = await loadEventById(db, eventId);
      if (!event || event.venueId !== effectiveVenueId) {
        throw new Error("EVENT_NOT_FOUND");
      }
      conditions.push(eq(guestLimitRequests.eventId, event.id));
    } else if (businessDate) {
      if (!isValidDate(businessDate)) throw new Error("INVALID_DATE");
      const compatibilityEvent = await findCompatibilityEvent(
        effectiveVenueId,
        businessDate,
      );
      conditions.push(
        compatibilityEvent && eventIncludesLegacyDateRows(compatibilityEvent)
          ? or(
              eq(guestLimitRequests.eventId, compatibilityEvent.id),
              and(
                isNull(guestLimitRequests.eventId),
                eq(guestLimitRequests.date, businessDate),
              ),
            )!
          : and(
              isNull(guestLimitRequests.eventId),
              eq(guestLimitRequests.date, businessDate),
            )!,
      );
    }
    const rows = await db
      .select({
        request: guestLimitRequests,
        userName: users.name,
        userRole: users.role,
      })
      .from(guestLimitRequests)
      .innerJoin(users, eq(guestLimitRequests.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(guestLimitRequests.createdAt))
      .limit(100);

    return {
      data: rows.map((row) => {
        if (!isRole(row.userRole)) throw new Error("INVALID_ROLE");
        return { ...toRequest(row.request), userName: row.userName, userRole: row.userRole };
      }),
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("guest_limit.request.list", error);
    return { data: null, error: "Unable to load guest limit requests right now." };
  }
}

export async function fetchMyVenuePendingGuestLimitRequestCount(): Promise<ApiResponse<number>> {
  try {
    const actor = await requireRole(["venue_admin"]);
    if (!actor.venueId) throw new Error("FORBIDDEN");
    const db = getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(guestLimitRequests)
      .where(
        and(
          eq(guestLimitRequests.venueId, actor.venueId),
          eq(guestLimitRequests.status, "pending"),
        ),
      );

    return { data: Number(rows[0]?.count ?? 0), error: null };
  } catch (error: unknown) {
    await reportServerError("guest_limit.request.pending_count", error);
    return { data: null, error: "Unable to load pending guest limit requests right now." };
  }
}

export async function decideGuestLimitRequest(params: {
  requestId: string;
  decision: "approve" | "reject";
  approvedExtra?: number;
  decisionNote?: string | null;
}): Promise<ApiResponse<GuestLimitRequest>> {
  try {
    if (params.decision !== "approve" && params.decision !== "reject") {
      return { data: null, error: "INVALID_DECISION" };
    }
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const [request] = await db
      .select()
      .from(guestLimitRequests)
      .where(eq(guestLimitRequests.id, params.requestId))
      .limit(1);

    if (!request || (actor.role !== "super_admin" && request.venueId !== actor.venueId)) {
      return { data: null, error: "FORBIDDEN" };
    }
    await requireActiveVenueId(request.venueId);
    if (request.status !== "pending") return { data: null, error: "REQUEST_ALREADY_DECIDED" };

    const approvedExtra = params.decision === "approve" ? params.approvedExtra : 0;
    if (
      params.decision === "approve" &&
      (!Number.isInteger(approvedExtra) || approvedExtra === undefined || approvedExtra < 1 || approvedExtra > request.requestedExtra)
    ) {
      return { data: null, error: "INVALID_APPROVED_EXTRA" };
    }
    const decisionNote = params.decisionNote?.trim() || null;
    if (decisionNote && decisionNote.length > 200) {
      return { data: null, error: "INVALID_DECISION_NOTE" };
    }

    const now = new Date().toISOString();
    const updated = await db
      .update(guestLimitRequests)
      .set({
        status: params.decision === "approve" ? "approved" : "rejected",
        approvedExtra: approvedExtra ?? 0,
        decidedByUserId: actor.id,
        decidedAt: now,
        decisionNote,
        updatedAt: now,
      })
      .where(
        and(
          eq(guestLimitRequests.id, request.id),
          eq(guestLimitRequests.status, "pending"),
        ),
      )
      .returning();

    if (!updated[0]) return { data: null, error: "REQUEST_ALREADY_DECIDED" };
    return { data: toRequest(updated[0]), error: null };
  } catch (error: unknown) {
    await reportServerError("guest_limit.request.decide", error);
    return { data: null, error: "DECISION_FAILED" };
  }
}
