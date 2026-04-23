"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, asc } from "drizzle-orm";
import * as schema from "../db/schema";
import { djs } from "../db/schema";
import { type DJ, type ApiResponse } from "./types";

// Helper to get Drizzle instance
async function getDb() {
  const { env } = getCloudflareContext() as unknown as { env: { DB: any } };
  return drizzle(env.DB, { schema });
}

export async function fetchDJsByVenue(venueId: string): Promise<ApiResponse<DJ[]>> {
  try {
    const db = await getDb();
    const result = await db.select().from(djs)
      .where(and(eq(djs.venueId, venueId), eq(djs.active, true)))
      .orderBy(asc(djs.name));
    return { data: result, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch DJs" };
  }
}

export async function createDJ(dj: {
  venueId: string;
  name: string;
  event: string;
  userId?: string;
}): Promise<ApiResponse<DJ>> {
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
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to create DJ" };
  }
}
