"use server";

import { reportServerError } from "@/lib/observability/structured-log";

import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  events,
  guestLimitRequests,
  users,
} from "../db/schema";
import {
  type GuestLimitRequest,
  type GuestLimitRequestStatus,
  type GuestLimitRequestView,
  type GuestQuota,
} from "@/lib/guest-limits/types";
import type { ApiResponse } from "./response";
import {
  requireAccess,
  requireAuth,
  requireRole,
  type SessionUser,
} from "../auth/server";
import { getDb } from "../db/client";
import { requireActiveVenueId } from "../tenant/active-server";
import { canRequestGuestLimit, isRole } from "@/lib/users/policy";
import {
  eventIncludesLegacyDateRows,
  findCompatibilityEvent,
  loadEventById,
  resolveEventForRosterWrite,
} from "@/lib/events/server";
import type { Event } from "@/lib/events/types";
import { loadGuestQuotaState } from "@/lib/guest-limits/quota-persistence";
import { createGuestLimitMutationPersistence } from "@/lib/guest-limits/persistence";
import {
  createGuestLimitRequestService,
  decideGuestLimitRequestService,
  GuestLimitMutationError,
} from "@/lib/guest-limits/service";
import type { GuestLimitMutationActor } from "@/lib/guest-limits/mutation-types";

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

function toGuestLimitMutationActor(user: SessionUser): GuestLimitMutationActor {
  return {
    id: user.id,
    role: user.role,
    accountKind: user.accountKind,
    doorAccessEnabled: user.doorAccessEnabled,
    venueId: user.venueId,
    guestLimit: user.guestLimit,
    sessionVersion: user.sessionVersion,
  };
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
    const quota = await loadGuestQuotaState(db, {
      venueId: actor.venueId,
      userId: actor.id,
      date,
      eventId: event?.id ?? null,
      includeLegacyRows,
    });

    const baseLimit = quota.configuredLimit !== undefined
      ? quota.configuredLimit
      : actor.guestLimit;
    const effectiveLimit = baseLimit === null
      ? null
      : baseLimit + quota.approvedExtra;

    return {
      data: {
        date,
        baseLimit,
        approvedExtra: quota.approvedExtra,
        effectiveLimit,
        used: quota.used,
        remaining: effectiveLimit === null
          ? null
          : Math.max(0, effectiveLimit - quota.used),
        canRequestExtra: canRequestGuestLimit(actor) && baseLimit !== null,
        pendingRequest: quota.pendingRequest
          ? toRequest(quota.pendingRequest)
          : null,
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
    const db = getDb();
    return {
      data: await createGuestLimitRequestService(
        { actor: toGuestLimitMutationActor(actor), params },
        {
          persistence: createGuestLimitMutationPersistence(),
          requireActiveVenueId,
          resolveEventForRosterWrite: (input) =>
            resolveEventForRosterWrite(input),
          findCompatibilityEvent,
          loadEventById: (eventId) => loadEventById(db, eventId),
        },
      ),
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) {
      return { data: null, error: "PENDING_REQUEST_EXISTS" };
    }
    if (error instanceof GuestLimitMutationError) {
      return { data: null, error: error.code };
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
    const selectRequests = () => db
      .select({
        request: guestLimitRequests,
        userName: users.name,
        userRole: users.role,
        event: { name: events.name, compatibilityKey: events.compatibilityKey },
      })
      .from(guestLimitRequests)
      .innerJoin(users, eq(guestLimitRequests.userId, users.id))
      .leftJoin(events, and(
        eq(guestLimitRequests.eventId, events.id),
        eq(guestLimitRequests.venueId, events.venueId),
      ));
    // Pending work belongs to the venue inbox. The selected date/event only
    // narrows history, so inherited admin filters cannot hide new requests.
    const [pendingRows, historyRows] = await Promise.all([
      selectRequests()
        .where(and(
          eq(guestLimitRequests.venueId, effectiveVenueId),
          eq(guestLimitRequests.status, "pending"),
        ))
        .orderBy(desc(guestLimitRequests.createdAt)),
      selectRequests()
        .where(and(...conditions, ne(guestLimitRequests.status, "pending")))
        .orderBy(desc(guestLimitRequests.createdAt))
        .limit(20),
    ]);

    return {
      data: [...pendingRows, ...historyRows].map((row) => {
        if (!isRole(row.userRole)) throw new Error("INVALID_ROLE");
        return {
          ...toRequest(row.request), userName: row.userName, userRole: row.userRole,
          eventName: row.event?.compatibilityKey === null ? row.event.name : null,
        };
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
    return {
      data: await decideGuestLimitRequestService(
        { actor: toGuestLimitMutationActor(actor), params },
        {
          persistence: createGuestLimitMutationPersistence(),
          requireActiveVenueId,
          loadEventById: (eventId) => loadEventById(db, eventId),
        },
      ),
      error: null,
    };
  } catch (error: unknown) {
    if (error instanceof GuestLimitMutationError) {
      return { data: null, error: error.code };
    }
    await reportServerError("guest_limit.request.decide", error);
    return { data: null, error: "DECISION_FAILED" };
  }
}
