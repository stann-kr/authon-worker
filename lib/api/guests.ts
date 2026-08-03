"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq, and, ne, desc, sql } from "drizzle-orm";
import { guests, externalDjLinks } from "../db/schema";
import { type Guest, type ApiResponse } from "./types";
import { requireAccess, requireAuth, requireRole, type SessionUser } from "../auth/server";
import { getDb } from "../db/client";
import { hasAccess } from "@/lib/users/policy";

type Db = ReturnType<typeof getDb>;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function scopedVenueId(user: SessionUser, requestedVenueId?: string | null): string | undefined {
  if (user.role === "super_admin") return requestedVenueId ?? undefined;
  if (!user.venueId) throw new Error("Forbidden");
  if (requestedVenueId && requestedVenueId !== user.venueId) throw new Error("Forbidden");
  return user.venueId;
}

async function getAccessibleGuest(db: Db, user: SessionUser, guestId: string) {
  const rows = await db
    .select({
      id: guests.id,
      venueId: guests.venueId,
      externalLinkId: guests.externalLinkId,
      createdByUserId: guests.createdByUserId,
      status: guests.status,
    })
    .from(guests)
    .where(eq(guests.id, guestId))
    .limit(1);
  const guest = rows[0];
  if (!guest) throw new Error("Guest not found");
  if (user.role !== "super_admin" && guest.venueId !== user.venueId) throw new Error("Forbidden");
  return guest;
}

export async function fetchGuestsByDate(date: string, venueId?: string): Promise<ApiResponse<Guest[]>> {
  try {
    const user = await requireAccess("guest");
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, venueId);
    const conditions = [eq(guests.date, date), ne(guests.status, "deleted")];
    if (effectiveVenueId) conditions.push(eq(guests.venueId, effectiveVenueId));

    const result = await db.select().from(guests)
      .where(and(...conditions))
      .orderBy(desc(guests.createdAt));

    return { data: result.map((g) => ({ ...g, status: g.status as Guest["status"] })), error: null };
  } catch (error: unknown) {
    console.error("Failed to fetch guests by date:", error);
    return { data: null, error: "Unable to load guests right now." };
  }
}

export async function fetchAllGuests(venueId?: string): Promise<ApiResponse<Guest[]>> {
  try {
    const user = await requireAccess("guest");
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, venueId);
    const baseQuery = db.select().from(guests);
    const result = await (
      effectiveVenueId ? baseQuery.where(eq(guests.venueId, effectiveVenueId)) : baseQuery
    ).orderBy(desc(guests.date), desc(guests.createdAt));

    return { data: result.map((g) => ({ ...g, status: g.status as Guest["status"] })), error: null };
  } catch (error: unknown) {
    console.error("Failed to fetch all guests:", error);
    return { data: null, error: "Unable to load guests right now." };
  }
}

export async function createGuest(guest: {
  venueId: string;
  name: string;
  registeredByName?: string | null;
  date: string;
}): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireAccess("guest");
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, guest.venueId);
    if (!effectiveVenueId) throw new Error("Venue is required");

    const name = guest.name.trim();
    if (!name || name.length > 100) return { data: null, error: "INVALID_GUEST_NAME" };
    if (!isValidDate(guest.date)) return { data: null, error: "INVALID_DATE" };
    const registeredByName = guest.registeredByName?.trim() || null;
    if (user.accountKind === "shared" && (!registeredByName || registeredByName.length > 80)) {
      return { data: null, error: "REGISTERED_BY_REQUIRED" };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const { env } = getCloudflareContext();
    const inserted = await env.DB.prepare(
      `INSERT INTO guests (
        id, venue_id, name, external_link_id, created_by_user_id, registered_by_name,
        date, status, created_at, updated_at
      )
      SELECT ?, ?, ?, NULL, ?, ?, ?, 'pending', ?, ?
      WHERE ? IS NULL OR (
        SELECT count(*) FROM guests
        WHERE created_by_user_id = ? AND date = ? AND status != 'deleted'
      ) < ? + coalesce((
        SELECT sum(approved_extra) FROM guest_limit_requests
        WHERE user_id = ? AND date = ? AND status = 'approved'
      ), 0)
      RETURNING id`,
    )
      .bind(
        id,
        effectiveVenueId,
        name,
        user.id,
        user.accountKind === "shared" ? registeredByName : null,
        guest.date,
        now,
        now,
        user.guestLimit,
        user.id,
        guest.date,
        user.guestLimit ?? 0,
        user.id,
        guest.date,
      )
      .first<{ id: string }>();
    if (!inserted) return { data: null, error: "GUEST_LIMIT_REACHED" };
    const result = await db.select().from(guests).where(eq(guests.id, id));
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to create guest:", error);
    return { data: null, error: "Unable to create guest right now." };
  }
}

export async function updateGuestStatus(
  guestId: string,
  status: "pending" | "checked",
): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireAccess("door");
    const db = getDb();
    await getAccessibleGuest(db, user, guestId);

    const updateData: Partial<typeof guests.$inferInsert> = { status, updatedAt: new Date().toISOString() };

    if (status === "checked") {
      updateData.checkInTime = new Date().toISOString();
    } else if (status === "pending") {
      updateData.checkInTime = null;
    }

    await db.update(guests).set(updateData).where(eq(guests.id, guestId));
    const result = await db.select().from(guests).where(eq(guests.id, guestId));
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to update guest status:", error);
    return { data: null, error: "Unable to update guest status right now." };
  }
}

export async function deleteGuest(guestId: string): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireAuth();
    const db = getDb();

    // 현재 상태 확인 — 이미 deleted이면 카운터 이중 차감 방지
    const current = await getAccessibleGuest(db, user, guestId);
    if (!hasAccess(user, ["door"]) && current.createdByUserId !== user.id) {
      throw new Error("Forbidden");
    }
    const wasAlreadyDeleted = current.status === "deleted";

    const updateData: Partial<typeof guests.$inferInsert> = {
      status: "deleted",
      updatedAt: new Date().toISOString(),
    };
    await db.update(guests).set(updateData).where(eq(guests.id, guestId));
    const updatedRows = await db.select().from(guests).where(eq(guests.id, guestId));
    const updated = updatedRows[0];

    if (!wasAlreadyDeleted && current.externalLinkId) {
      await db.update(externalDjLinks)
        .set({ usedGuests: sql`max(0, ${externalDjLinks.usedGuests} - 1)` })
        .where(eq(externalDjLinks.id, current.externalLinkId));
    }

    return { data: updated ? { ...updated, status: updated.status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to delete guest:", error);
    return { data: null, error: "Unable to delete guest right now." };
  }
}

export async function permanentlyDeleteGuest(guestId: string): Promise<{ error: string | null }> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    await getAccessibleGuest(db, user, guestId);
    await db.delete(guests).where(eq(guests.id, guestId));
    return { error: null };
  } catch (error: unknown) {
    console.error("Failed to permanently delete guest:", error);
    return { error: "Unable to permanently delete guest right now." };
  }
}

export async function updateGuest(
  guestId: string,
  updates: {
    name?: string;
    date?: string;
    venueId?: string;
  },
): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireAuth();
    const db = getDb();
    const current = await getAccessibleGuest(db, user, guestId);
    const canAdministerGuests = hasAccess(user, ["admin"]);
    if (!canAdministerGuests && current.createdByUserId !== user.id) {
      throw new Error("Forbidden");
    }
    if (!canAdministerGuests && (updates.date !== undefined || updates.venueId !== undefined)) {
      throw new Error("Forbidden");
    }
    const updateData: Partial<typeof guests.$inferInsert> = { updatedAt: new Date().toISOString() };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.date !== undefined) updateData.date = updates.date;
    if (updates.venueId !== undefined) {
      const effectiveVenueId = scopedVenueId(user, updates.venueId);
      if (!effectiveVenueId) throw new Error("Venue is required");
      updateData.venueId = effectiveVenueId;
    }

    await db.update(guests).set(updateData).where(eq(guests.id, guestId));
    const result = await db.select().from(guests).where(eq(guests.id, guestId));
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to update guest:", error);
    return { data: null, error: "Unable to update guest right now." };
  }
}
