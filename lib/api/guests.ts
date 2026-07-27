"use server";

import { eq, and, ne, desc, sql } from "drizzle-orm";
import { guests, externalDjLinks } from "../db/schema";
import { type Guest, type ApiResponse } from "./types";
import { requireRole, type SessionUser } from "../auth/server";
import { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

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
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
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
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
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
  externalLinkId?: string | null;
  createdByUserId?: string | null;
  date: string;
  status?: "pending" | "checked" | "deleted";
}): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, guest.venueId);
    if (!effectiveVenueId) throw new Error("Venue is required");

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(guests).values({
      id,
      venueId: effectiveVenueId,
      name: guest.name,
      externalLinkId: guest.externalLinkId || null,
      createdByUserId: user.role === "super_admin" ? (guest.createdByUserId || user.id) : user.id,
      date: guest.date,
      status: guest.status || "pending",
      createdAt: now,
      updatedAt: now,
    });
    const result = await db.select().from(guests).where(eq(guests.id, id));
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to create guest:", error);
    return { data: null, error: "Unable to create guest right now." };
  }
}

export async function updateGuestStatus(
  guestId: string,
  status: "pending" | "checked" | "deleted",
): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
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
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
    const db = getDb();

    // 현재 상태 확인 — 이미 deleted이면 카운터 이중 차감 방지
    const current = await getAccessibleGuest(db, user, guestId);
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
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
    const db = getDb();
    await getAccessibleGuest(db, user, guestId);
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
