"use server";

import { eq, and, ne, desc } from "drizzle-orm";
import * as schema from "../db/schema";
import { guests, externalDjLinks } from "../db/schema";
import { type Guest, type ApiResponse } from "./types";
import { requireRole } from "../auth/server";
import { getDb } from "../db/client";

export async function fetchGuestsByDate(date: string, venueId?: string): Promise<ApiResponse<Guest[]>> {
  try {
    await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const conditions = [eq(guests.date, date), ne(guests.status, "deleted")];
    if (venueId) conditions.push(eq(guests.venueId, venueId));

    const result = await db.select().from(guests)
      .where(and(...conditions))
      .orderBy(desc(guests.createdAt));

    return { data: result.map((g) => ({ ...g, status: g.status as Guest["status"] })), error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch guests by date" };
  }
}

export async function fetchAllGuests(venueId?: string): Promise<ApiResponse<Guest[]>> {
  try {
    await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const baseQuery = db.select().from(guests);
    const result = await (
      venueId ? baseQuery.where(eq(guests.venueId, venueId)) : baseQuery
    ).orderBy(desc(guests.date), desc(guests.createdAt));

    return { data: result.map((g) => ({ ...g, status: g.status as Guest["status"] })), error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch all guests" };
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
    await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(guests).values({
      id,
      venueId: guest.venueId,
      name: guest.name,
      externalLinkId: guest.externalLinkId || null,
      createdByUserId: guest.createdByUserId || null,
      date: guest.date,
      status: guest.status || "pending",
      createdAt: now,
      updatedAt: now,
    });
    const result = await db.select().from(guests).where(eq(guests.id, id));
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to create guest" };
  }
}

export async function updateGuestStatus(
  guestId: string,
  status: "pending" | "checked" | "deleted",
): Promise<ApiResponse<Guest>> {
  try {
    await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
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
    return { data: null, error: error instanceof Error ? error.message : "Failed to update guest status" };
  }
}

export async function deleteGuest(guestId: string): Promise<ApiResponse<Guest>> {
  try {
    await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();

    // 현재 상태 확인 — 이미 deleted이면 카운터 이중 차감 방지
    const guestRow = await db
      .select({ externalLinkId: guests.externalLinkId, status: guests.status })
      .from(guests)
      .where(eq(guests.id, guestId))
      .limit(1);

    const current = guestRow[0];
    const wasAlreadyDeleted = current?.status === "deleted";

    const result = await updateGuestStatus(guestId, "deleted");

    if (!result.error && !wasAlreadyDeleted && current?.externalLinkId) {
      const linkRow = await db
        .select({ usedGuests: externalDjLinks.usedGuests })
        .from(externalDjLinks)
        .where(eq(externalDjLinks.id, current.externalLinkId));
      if (linkRow[0]) {
        await db.update(externalDjLinks)
          .set({ usedGuests: Math.max(0, (linkRow[0].usedGuests || 0) - 1) })
          .where(eq(externalDjLinks.id, current.externalLinkId));
      }
    }
    return result;
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to delete guest" };
  }
}

export async function permanentlyDeleteGuest(guestId: string): Promise<{ error: string | null }> {
  try {
    await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    await db.delete(guests).where(eq(guests.id, guestId));
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to permanently delete guest" };
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
    await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const updateData: Partial<typeof guests.$inferInsert> = { updatedAt: new Date().toISOString() };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.date !== undefined) updateData.date = updates.date;
    if (updates.venueId !== undefined) updateData.venueId = updates.venueId;

    await db.update(guests).set(updateData).where(eq(guests.id, guestId));
    const result = await db.select().from(guests).where(eq(guests.id, guestId));
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to update guest" };
  }
}
