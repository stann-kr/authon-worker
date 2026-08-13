"use server";

import { and, desc, eq, ne, sql } from "drizzle-orm";
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

export async function fetchMyGuestQuota(date: string): Promise<ApiResponse<GuestQuota>> {
  try {
    if (!isValidDate(date)) throw new Error("INVALID_DATE");
    const actor = await requireAccess("guest");
    const db = getDb();

    const [usage, extra, pending] = await Promise.all([
      db
        .select({ used: sql<number>`count(*)` })
        .from(guests)
        .where(
          and(
            eq(guests.createdByUserId, actor.id),
            eq(guests.date, date),
            ne(guests.status, "deleted"),
          ),
        ),
      db
        .select({ approvedExtra: sql<number>`coalesce(sum(${guestLimitRequests.approvedExtra}), 0)` })
        .from(guestLimitRequests)
        .where(
          and(
            eq(guestLimitRequests.userId, actor.id),
            eq(guestLimitRequests.date, date),
            eq(guestLimitRequests.status, "approved"),
          ),
        ),
      db
        .select()
        .from(guestLimitRequests)
        .where(
          and(
            eq(guestLimitRequests.userId, actor.id),
            eq(guestLimitRequests.date, date),
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
    console.error("Failed to load guest quota:", error);
    return { data: null, error: "Unable to load guest quota right now." };
  }
}

export async function createGuestLimitRequest(params: {
  date: string;
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
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.insert(guestLimitRequests).values({
      id,
      venueId: actor.venueId,
      userId: actor.id,
      date: params.date,
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
    console.error("Failed to create guest limit request:", error);
    return { data: null, error: "REQUEST_FAILED" };
  }
}

export async function fetchGuestLimitRequests(
  venueId?: string | null,
): Promise<ApiResponse<GuestLimitRequestView[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const effectiveVenueId = actor.role === "super_admin" ? venueId : actor.venueId;
    if (!effectiveVenueId) throw new Error("FORBIDDEN");
    await requireActiveVenueId(effectiveVenueId);
    const db = getDb();
    const rows = await db
      .select({
        request: guestLimitRequests,
        userName: users.name,
        userRole: users.role,
      })
      .from(guestLimitRequests)
      .innerJoin(users, eq(guestLimitRequests.userId, users.id))
      .where(eq(guestLimitRequests.venueId, effectiveVenueId))
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
    console.error("Failed to load guest limit requests:", error);
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
    console.error("Failed to load pending guest limit request count:", error);
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
    console.error("Failed to decide guest limit request:", error);
    return { data: null, error: "DECISION_FAILED" };
  }
}
