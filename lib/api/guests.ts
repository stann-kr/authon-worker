"use server";

import { getRequestContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, ne, desc, asc } from "drizzle-orm";
import * as schema from "../db/schema";
import { venues, users, djs, externalDjLinks, guests, checkIns } from "../db/schema";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

// Helper to get Drizzle instance
async function getDb() {
  const { env } = getRequestContext() as unknown as { env: { DB: D1Database } };
  return drizzle(env.DB, { schema });
}

// Helper to get current user from JWT
async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default_secret_for_local_dev");
    const { payload } = await jwtVerify(token, secret);
    return payload as { sub: string; email: string; role: string; venueId: string | null };
  } catch {
    return null;
  }
}

// ============================================================
// Types
// ============================================================

export interface Venue {
  id: string;
  name: string;
  type: "club" | "bar" | "lounge" | "festival" | "private";
  address?: string | null;
  active: boolean;
}

export interface User {
  id: string;
  venueId: string | null; // null for super_admin
  email: string;
  name: string;
  role: "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
  guestLimit: number | null;
  active: boolean;
}

export interface Guest {
  id: string;
  venueId: string;
  name: string;
  email?: string | null;
  instagram?: string | null;
  djId?: string | null;
  externalLinkId?: string | null;
  status: "pending" | "checked" | "deleted";
  checkInTime?: string | null;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface DJ {
  id: string;
  venueId: string;
  userId?: string | null;
  name: string;
  event: string | null;
  active: boolean;
}

export interface ExternalDJLink {
  id: string;
  venueId: string;
  token: string;
  djName: string;
  event: string | null;
  date: string | null;
  maxGuests: number;
  usedGuests: number;
  active: boolean;
  expiresAt?: string | null;
  createdBy?: string | null;
}

// ============================================================
// Venue APIs
// ============================================================

export async function fetchVenues(includeInactive = false): Promise<{ data: Venue[] | null; error: any }> {
  try {
    const db = await getDb();
    let query = db.select().from(venues);
    if (!includeInactive) {
      query = query.where(eq(venues.active, 1)) as any;
    }
    const result = await query.orderBy(asc(venues.name));
    return { data: result.map(v => ({ ...v, type: v.type as any, active: v.active === 1 })), error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function createVenue(venue: {
  name: string;
  type: Venue["type"];
  address?: string;
  description?: string;
}): Promise<{ data: Venue | null; error: any }> {
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.insert(venues).values({
      id,
      name: venue.name,
      type: venue.type,
      address: venue.address || null,
      active: 1,
    });
    const result = await db.select().from(venues).where(eq(venues.id, id));
    return { data: result[0] ? { ...result[0], type: result[0].type as any, active: result[0].active === 1 } : null, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function updateVenue(
  id: string,
  updates: Partial<Pick<Venue, "name" | "type" | "address" | "active">>,
): Promise<{ data: Venue | null; error: any }> {
  try {
    const db = await getDb();
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.address !== undefined) dbUpdates.address = updates.address;
    if (updates.active !== undefined) dbUpdates.active = updates.active ? 1 : 0;

    await db.update(venues).set(dbUpdates).where(eq(venues.id, id));
    const result = await db.select().from(venues).where(eq(venues.id, id));
    return { data: result[0] ? { ...result[0], type: result[0].type as any, active: result[0].active === 1 } : null, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

// ============================================================
// User APIs
// ============================================================

export async function fetchUsersByVenue(venueId?: string | null): Promise<{ data: User[] | null; error: any }> {
  try {
    const db = await getDb();
    let query = db.select().from(users);
    if (venueId) {
      query = query.where(eq(users.venueId, venueId)) as any;
    }
    const result = await query.orderBy(asc(users.name));
    return { data: result.map(u => ({ ...u, role: u.role as any, active: u.active === 1 })), error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function updateUserProfile(
  userId: string,
  updates: {
    name?: string;
    guestLimit?: number;
    active?: boolean;
    role?: string;
  },
): Promise<{ data: User | null; error: any }> {
  try {
    const db = await getDb();
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.guestLimit !== undefined) dbUpdates.guestLimit = updates.guestLimit;
    if (updates.active !== undefined) dbUpdates.active = updates.active ? 1 : 0;
    if (updates.role !== undefined) dbUpdates.role = updates.role;

    await db.update(users).set(dbUpdates).where(eq(users.id, userId));
    const result = await db.select().from(users).where(eq(users.id, userId));
    return { data: result[0] ? { ...result[0], role: result[0].role as any, active: result[0].active === 1 } : null, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

// Placeholder for creating users - in real implementation this might need an API route if bcrypt isn't edge compatible
// but we have bcryptjs now
export async function createUserViaEdge(params: {
  email: string;
  name: string;
  role: "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
  venueId?: string | null;
  guestLimit?: number;
  password?: string;
}): Promise<{ data: any; error: any }> {
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    const bcryptjs = require("bcryptjs");
    const passwordHash = params.password ? await bcryptjs.hash(params.password, 10) : await bcryptjs.hash("123456", 10); // default password if not provided for now
    
    await db.insert(users).values({
      id,
      email: params.email,
      name: params.name,
      role: params.role,
      venueId: params.venueId || null,
      guestLimit: params.guestLimit || null,
      passwordHash,
      active: 1,
      createdAt: new Date().toISOString(),
    });
    return { data: { id }, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function deleteUserViaEdge(userId: string): Promise<{ error: any }> {
  try {
    const db = await getDb();
    await db.delete(users).where(eq(users.id, userId));
    return { error: null };
  } catch (error: any) {
    return { error: { message: error.message } };
  }
}

// ============================================================
// DJ APIs
// ============================================================

export async function fetchDJsByVenue(venueId: string): Promise<{ data: DJ[] | null; error: any }> {
  try {
    const db = await getDb();
    const result = await db.select().from(djs)
      .where(and(eq(djs.venueId, venueId), eq(djs.active, 1)))
      .orderBy(asc(djs.name));
    return { data: result.map(d => ({ ...d, active: d.active === 1 })), error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function createDJ(dj: {
  venueId: string;
  name: string;
  event: string;
  userId?: string;
}): Promise<{ data: DJ | null; error: any }> {
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.insert(djs).values({
      id,
      venueId: dj.venueId,
      name: dj.name,
      event: dj.event,
      userId: dj.userId || null,
      active: 1,
    });
    const result = await db.select().from(djs).where(eq(djs.id, id));
    return { data: result[0] ? { ...result[0], active: result[0].active === 1 } : null, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

// ============================================================
// Guest APIs
// ============================================================

export async function fetchGuestsByDate(date: string, venueId?: string): Promise<{ data: Guest[] | null; error: any }> {
  try {
    const db = await getDb();
    let conditions = [eq(guests.date, date), ne(guests.status, "deleted")];
    if (venueId) conditions.push(eq(guests.venueId, venueId));
    
    const result = await db.select().from(guests)
      .where(and(...conditions))
      .orderBy(desc(guests.createdAt));
      
    return { data: result.map(g => ({ ...g, status: g.status as any })), error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function fetchAllGuests(venueId?: string): Promise<{ data: Guest[] | null; error: any }> {
  try {
    const db = await getDb();
    let query = db.select().from(guests);
    if (venueId) {
      query = query.where(eq(guests.venueId, venueId)) as any;
    }
    const result = await query.orderBy(desc(guests.date), desc(guests.createdAt));
    return { data: result.map(g => ({ ...g, status: g.status as any })), error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function fetchGuestsByDJ(djId: string, date?: string): Promise<{ data: Guest[] | null; error: any }> {
  try {
    const db = await getDb();
    let conditions = [eq(guests.djId, djId), ne(guests.status, "deleted")];
    if (date) conditions.push(eq(guests.date, date));
    
    const result = await db.select().from(guests)
      .where(and(...conditions))
      .orderBy(desc(guests.createdAt));
      
    return { data: result.map(g => ({ ...g, status: g.status as any })), error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function createGuest(guest: {
  venueId: string;
  name: string;
  djId?: string | null;
  externalLinkId?: string | null;
  createdByUserId?: string | null;
  date: string;
  status?: "pending" | "checked" | "deleted";
}): Promise<{ data: Guest | null; error: any }> {
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(guests).values({
      id,
      venueId: guest.venueId,
      name: guest.name,
      djId: guest.djId || null,
      externalLinkId: guest.externalLinkId || null,
      date: guest.date,
      status: guest.status || "pending",
      createdAt: now,
      updatedAt: now,
    });
    const result = await db.select().from(guests).where(eq(guests.id, id));
    return { data: result[0] ? { ...result[0], status: result[0].status as any } : null, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function updateGuestStatus(
  guestId: string,
  status: "pending" | "checked" | "deleted",
): Promise<{ data: Guest | null; error: any }> {
  try {
    const db = await getDb();
    const updateData: any = { status, updatedAt: new Date().toISOString() };
    if (status === "checked") {
      updateData.checkInTime = new Date().toISOString();
    } else if (status === "pending") {
      updateData.checkInTime = null;
    }

    await db.update(guests).set(updateData).where(eq(guests.id, guestId));
    const result = await db.select().from(guests).where(eq(guests.id, guestId));
    return { data: result[0] ? { ...result[0], status: result[0].status as any } : null, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function deleteGuest(guestId: string): Promise<{ data: Guest | null; error: any }> {
  try {
    const db = await getDb();
    const guestRow = await db.select({ externalLinkId: guests.externalLinkId }).from(guests).where(eq(guests.id, guestId));
    const result = await updateGuestStatus(guestId, "deleted");
    
    if (!result.error && guestRow[0]?.externalLinkId) {
      const linkRow = await db.select({ usedGuests: externalDjLinks.usedGuests }).from(externalDjLinks).where(eq(externalDjLinks.id, guestRow[0].externalLinkId));
      if (linkRow[0]) {
        await db.update(externalDjLinks)
          .set({ usedGuests: Math.max(0, (linkRow[0].usedGuests || 0) - 1) })
          .where(eq(externalDjLinks.id, guestRow[0].externalLinkId));
      }
    }
    return result;
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function permanentlyDeleteGuest(guestId: string): Promise<{ error: any }> {
  try {
    const db = await getDb();
    await db.delete(guests).where(eq(guests.id, guestId));
    return { error: null };
  } catch (error: any) {
    return { error: { message: error.message } };
  }
}

export async function updateGuest(
  guestId: string,
  updates: {
    name?: string;
    djId?: string | null;
    date?: string;
    venueId?: string;
  },
): Promise<{ data: Guest | null; error: any }> {
  try {
    const db = await getDb();
    const updateData: any = { updatedAt: new Date().toISOString() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.djId !== undefined) updateData.djId = updates.djId;
    if (updates.date !== undefined) updateData.date = updates.date;
    if (updates.venueId !== undefined) updateData.venueId = updates.venueId;

    await db.update(guests).set(updateData).where(eq(guests.id, guestId));
    const result = await db.select().from(guests).where(eq(guests.id, guestId));
    return { data: result[0] ? { ...result[0], status: result[0].status as any } : null, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

// ============================================================
// External DJ Link APIs
// ============================================================

export async function fetchExternalLinks(venueId: string): Promise<{ data: ExternalDJLink[] | null; error: any }> {
  try {
    const db = await getDb();
    const result = await db.select().from(externalDjLinks)
      .where(eq(externalDjLinks.venueId, venueId))
      .orderBy(desc(externalDjLinks.date));
    return { data: result.map(l => ({ ...l, active: l.active === 1 })), error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function fetchExternalLinksByDate(venueId: string, date: string): Promise<{ data: ExternalDJLink[] | null; error: any }> {
  try {
    const db = await getDb();
    const result = await db.select().from(externalDjLinks)
      .where(and(eq(externalDjLinks.venueId, venueId), eq(externalDjLinks.date, date)))
      .orderBy(desc(externalDjLinks.id)); // Using id desc as created_at proxy if no created_at
    return { data: result.map(l => ({ ...l, active: l.active === 1 })), error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function createExternalLink(link: {
  venueId: string;
  djName: string;
  event: string;
  date: string;
  maxGuests: number;
  createdBy?: string;
}): Promise<{ data: ExternalDJLink | null; error: any }> {
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    const token = crypto.randomUUID(); // Simplistic token generation
    await db.insert(externalDjLinks).values({
      id,
      venueId: link.venueId,
      token,
      djName: link.djName,
      event: link.event,
      date: link.date,
      maxGuests: link.maxGuests,
      usedGuests: 0,
      active: 1,
      createdBy: link.createdBy || null,
    });
    const result = await db.select().from(externalDjLinks).where(eq(externalDjLinks.id, id));
    return { data: result[0] ? { ...result[0], active: result[0].active === 1 } : null, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function deleteExternalLink(linkId: string): Promise<{ error: any }> {
  try {
    const db = await getDb();
    await db.delete(externalDjLinks).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: any) {
    return { error: { message: error.message } };
  }
}

export async function deactivateExternalLink(linkId: string): Promise<{ error: any }> {
  try {
    const db = await getDb();
    await db.update(externalDjLinks).set({ active: 0 }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: any) {
    return { error: { message: error.message } };
  }
}

export async function activateExternalLink(linkId: string): Promise<{ error: any }> {
  try {
    const db = await getDb();
    await db.update(externalDjLinks).set({ active: 1 }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: any) {
    return { error: { message: error.message } };
  }
}
