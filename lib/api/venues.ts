"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq, asc } from "drizzle-orm";
import * as schema from "../db/schema";
import { venues } from "../db/schema";
import { type Venue, type ApiResponse } from "./types";

// Helper to get Drizzle instance
async function getDb() {
  const { env } = getCloudflareContext() as unknown as { env: { DB: any } };
  return drizzle(env.DB, { schema });
}

export async function fetchVenues(includeInactive = false): Promise<ApiResponse<Venue[]>> {
  try {
    const db = await getDb();
    let query = db.select().from(venues).$dynamic();
    
    if (!includeInactive) {
      query = query.where(eq(venues.active, true));
    }
    
    const result = await query.orderBy(asc(venues.name));
    return { data: result.map(v => ({ ...v, type: v.type as Venue["type"] })), error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch venues" };
  }
}

export async function createVenue(venue: {
  name: string;
  type: Venue["type"];
  address?: string;
  description?: string;
}): Promise<ApiResponse<Venue>> {
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
    return { data: result[0] ? { ...result[0], type: result[0].type as Venue["type"] } : null, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to create venue" };
  }
}

export async function updateVenue(
  id: string,
  updates: Partial<Pick<Venue, "name" | "type" | "address" | "active">>,
): Promise<ApiResponse<Venue>> {
  try {
    const db = await getDb();
    
    // 명시적인 타입이 지정된 dbUpdates 객체 생성
    const dbUpdates: Partial<typeof venues.$inferInsert> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.address !== undefined) dbUpdates.address = updates.address;
    if (updates.active !== undefined) dbUpdates.active = updates.active;

    await db.update(venues).set(dbUpdates).where(eq(venues.id, id));
    const result = await db.select().from(venues).where(eq(venues.id, id));
    return { data: result[0] ? { ...result[0], type: result[0].type as Venue["type"] } : null, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to update venue" };
  }
}
