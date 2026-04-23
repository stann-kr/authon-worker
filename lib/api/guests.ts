"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, ne, desc, asc } from "drizzle-orm";
import * as schema from "../db/schema";
import { venues, users, djs, externalDjLinks, guests, checkIns, passwordResetTokens } from "../db/schema";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { sendEmail } from "./email";

// Helper to get Drizzle instance
async function getDb() {
  const { env } = getCloudflareContext() as unknown as { env: { DB: D1Database } };
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
      query = query.where(eq(venues.active, true)) as any;
    }
    const result = await query.orderBy(asc(venues.name));
    return { data: result.map(v => ({ ...v, type: v.type as any })), error: null };
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
      active: true,
    });
    const result = await db.select().from(venues).where(eq(venues.id, id));
    return { data: result[0] ? { ...result[0], type: result[0].type as any } : null, error: null };
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
    if (updates.active !== undefined) dbUpdates.active = updates.active;

    await db.update(venues).set(dbUpdates).where(eq(venues.id, id));
    const result = await db.select().from(venues).where(eq(venues.id, id));
    return { data: result[0] ? { ...result[0], type: result[0].type as any } : null, error: null };
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
    return { data: result.map(u => ({ ...u, role: u.role as any })), error: null };
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
    if (updates.active !== undefined) dbUpdates.active = updates.active;
    if (updates.role !== undefined) dbUpdates.role = updates.role;

    await db.update(users).set(dbUpdates).where(eq(users.id, userId));
    const result = await db.select().from(users).where(eq(users.id, userId));
    return { data: result[0] ? { ...result[0], role: result[0].role as any } : null, error: null };
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
    const passwordHash = params.password ? await bcrypt.hash(params.password, 10) : await bcrypt.hash("123456", 10); // default password if not provided for now
    
    await db.insert(users).values({
      id,
      email: params.email,
      name: params.name,
      role: params.role,
      venueId: params.venueId || null,
      guestLimit: params.guestLimit || null,
      passwordHash,
      active: true,
      createdAt: new Date().toISOString(),
    });

    // Send invitation email
    await resendInvitationViaEdge(id);

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
      .where(and(eq(djs.venueId, venueId), eq(djs.active, true)))
      .orderBy(asc(djs.name));
    return { data: result, error: null };
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
      active: true,
    });
    const result = await db.select().from(djs).where(eq(djs.id, id));
    return { data: result[0] ? { ...result[0] } : null, error: null };
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
      query.where(eq(guests.venueId, venueId));
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
    return { data: result, error: null };
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
    return { data: result, error: null };
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
      active: true,
      createdBy: link.createdBy || null,
    });
    const result = await db.select().from(externalDjLinks).where(eq(externalDjLinks.id, id));
    return { data: result[0] ? { ...result[0] } : null, error: null };
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
    await db.update(externalDjLinks).set({ active: false }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: any) {
    return { error: { message: error.message } };
  }
}

export async function activateExternalLink(linkId: string): Promise<{ error: any }> {
  try {
    const db = await getDb();
    await db.update(externalDjLinks).set({ active: true }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: any) {
    return { error: { message: error.message } };
  }
}

export async function validateExternalToken(token: string): Promise<{ data: any; error: any }> {
  try {
    const db = await getDb();
    const linkResult = await db.select().from(externalDjLinks).where(eq(externalDjLinks.token, token));
    const link = linkResult[0];

    if (!link || !link.active) {
      return { data: null, error: "Link is invalid or inactive." };
    }

    const venueResult = await db.select().from(venues).where(eq(venues.id, link.venueId));
    const venue = venueResult[0];

    if (!venue) {
      return { data: null, error: "Associated venue not found." };
    }

    const guestsResult = await db.select().from(guests).where(and(eq(guests.externalLinkId, link.id), ne(guests.status, "deleted")));

    return {
      data: {
        link,
        venue,
        guests: guestsResult,
      },
      error: null
    };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function createGuestViaExternalLink(params: {
  token: string;
  guestName: string;
  date: string;
}): Promise<{ data: Guest | null; error: any }> {
  try {
    const db = await getDb();
    const linkResult = await db.select().from(externalDjLinks).where(eq(externalDjLinks.token, params.token));
    const link = linkResult[0];

    if (!link || !link.active) {
      return { data: null, error: "Link is invalid or inactive." };
    }

    if (link.usedGuests >= link.maxGuests) {
      return { data: null, error: "Guest limit reached for this link." };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(guests).values({
      id,
      venueId: link.venueId,
      name: params.guestName,
      externalLinkId: link.id,
      date: params.date,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await db.update(externalDjLinks)
      .set({ usedGuests: link.usedGuests + 1 })
      .where(eq(externalDjLinks.id, link.id));

    const result = await db.select().from(guests).where(eq(guests.id, id));
    return { data: result[0] as unknown as Guest, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message } };
  }
}

export async function deleteGuestViaExternalLink(params: {
  token: string;
  guestId: string;
}): Promise<{ error: any }> {
  try {
    const db = await getDb();
    
    // Validate token first
    const linkResult = await db.select().from(externalDjLinks).where(eq(externalDjLinks.token, params.token));
    const link = linkResult[0];

    if (!link || !link.active) {
      return { error: "Link is invalid or inactive." };
    }

    // Call the existing deleteGuest function
    const result = await deleteGuest(params.guestId);
    return { error: result.error };
  } catch (error: any) {
    return { error: { message: error.message } };
  }
}

export async function resendInvitationViaEdge(userId: string): Promise<{ error: any }> {
  try {
    const { env } = getCloudflareContext() as unknown as { env: { DB: D1Database, NEXT_PUBLIC_APP_URL: string } };
    const db = await getDb();
    
    const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userResult[0];
    
    if (!user) return { error: { message: "User not found." } };

    // Create reset token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    await db.insert(passwordResetTokens).values({
      id: crypto.randomUUID(),
      userId: userId,
      token,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString(),
    });

    // Send email
    const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetLink = `${appUrl}/auth/reset-password?token=${token}`;

    await sendEmail({
      to: user.email,
      subject: "[Authon] 계정 초기 비밀번호 설정 안내",
      body: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>계정 초기 비밀번호 설정 안내</h2>
          <p>안녕하세요, ${user.name}님.</p>
          <p>관리자에 의해 귀하의 계정이 생성되었습니다. 아래 링크를 클릭하여 비밀번호를 설정하고 로그인을 완료해주세요.</p>
          <div style="margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px;">비밀번호 설정하기</a>
          </div>
          <p>이 링크는 7일 동안 유효합니다.</p>
          <p style="color: #666; font-size: 12px; margin-top: 40px;">본 메일은 발송 전용입니다.</p>
        </div>
      `,
    });

    return { error: null };
  } catch (error: any) {
    console.error("Resend invitation error:", error);
    return { error: { message: error.message } };
  }
}
