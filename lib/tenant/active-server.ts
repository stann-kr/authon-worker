import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { venues } from "@/lib/db/schema";

export async function requireActiveVenueId(
  venueId: string | null | undefined,
): Promise<string> {
  if (!venueId) throw new Error("Venue unavailable");

  const db = getDb();
  const [venue] = await db
    .select({ id: venues.id })
    .from(venues)
    .where(and(eq(venues.id, venueId), eq(venues.active, true)))
    .limit(1);

  if (!venue) throw new Error("Venue unavailable");
  return venue.id;
}
