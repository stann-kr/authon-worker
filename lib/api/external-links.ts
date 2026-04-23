"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, ne, desc } from "drizzle-orm";
import * as schema from "../db/schema";
import { externalDjLinks, venues, guests } from "../db/schema";
import { type ExternalDJLink, type Guest, type Venue, type ApiResponse } from "./types";
import { deleteGuest } from "./guests";

// Helper to get Drizzle instance
async function getDb() {
  const { env } = getCloudflareContext() as unknown as { env: { DB: any } };
  return drizzle(env.DB, { schema });
}

export async function fetchExternalLinks(venueId: string): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const db = await getDb();
    const result = await db.select().from(externalDjLinks)
      .where(eq(externalDjLinks.venueId, venueId))
      .orderBy(desc(externalDjLinks.date));
    return { data: result, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch external links" };
  }
}

export async function fetchExternalLinksByDate(venueId: string, date: string): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const db = await getDb();
    const result = await db.select().from(externalDjLinks)
      .where(and(eq(externalDjLinks.venueId, venueId), eq(externalDjLinks.date, date)))
      .orderBy(desc(externalDjLinks.id));
    return { data: result, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch external links by date" };
  }
}

export async function createExternalLink(link: {
  venueId: string;
  djName: string;
  event: string;
  date: string;
  maxGuests: number;
  createdBy?: string;
}): Promise<ApiResponse<ExternalDJLink>> {
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    const token = crypto.randomUUID(); 
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
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to create external link" };
  }
}

export async function deleteExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const db = await getDb();
    await db.delete(externalDjLinks).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to delete external link" };
  }
}

export async function deactivateExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const db = await getDb();
    await db.update(externalDjLinks).set({ active: false }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to deactivate external link" };
  }
}

export async function activateExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const db = await getDb();
    await db.update(externalDjLinks).set({ active: true }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to activate external link" };
  }
}

export async function validateExternalToken(token: string): Promise<ApiResponse<{ link: ExternalDJLink; venue: Venue; guests: Guest[] }>> {
  try {
    const db = await getDb();
    const linkResult = await db.select().from(externalDjLinks).where(eq(externalDjLinks.token, token));
    const link = linkResult[0];

    if (!link || !link.active) {
      return { data: null, error: "Link is invalid or inactive." };
    }

    const venueResult = await db.select().from(venues).where(eq(venues.id, link.venueId));
    const venue = venueResult[0] as Venue;

    if (!venue) {
      return { data: null, error: "Associated venue not found." };
    }

    const guestsResult = await db.select().from(guests).where(and(eq(guests.externalLinkId, link.id), ne(guests.status, "deleted")));

    return {
      data: {
        link,
        venue,
        guests: guestsResult.map(g => ({ ...g, status: g.status as Guest["status"] })),
      },
      error: null
    };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to validate external token" };
  }
}

export async function createGuestViaExternalLink(params: {
  token: string;
  guestName: string;
  date: string;
}): Promise<ApiResponse<Guest>> {
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
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to create guest via external link" };
  }
}

export async function deleteGuestViaExternalLink(params: {
  token: string;
  guestId: string;
}): Promise<{ error: string | null }> {
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
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to delete guest via external link" };
  }
}
