import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "../db/client";
import { eventContributorLimits } from "../db/schema";
import type { Event } from "../events/types";

export async function getOrCreateEventContributorGuestLimit(input: {
  event: Event;
  venueId: string;
  userId: string;
  fallbackGuestLimit: number | null;
  createdByUserId: string;
  createdAt: string;
}): Promise<number | null> {
  if (input.event.venueId !== input.venueId) {
    throw new Error("EVENT_NOT_FOUND");
  }
  const db = getDb();
  await db
    .insert(eventContributorLimits)
    .values({
      eventId: input.event.id,
      venueId: input.venueId,
      userId: input.userId,
      guestLimit: input.fallbackGuestLimit,
      sourceEventId: input.event.templateSourceEventId,
      createdByUserId: input.createdByUserId,
      createdAt: input.createdAt,
    })
    .onConflictDoNothing();
  const [configured] = await db
    .select({ guestLimit: eventContributorLimits.guestLimit })
    .from(eventContributorLimits)
    .where(
      and(
        eq(eventContributorLimits.eventId, input.event.id),
        eq(eventContributorLimits.userId, input.userId),
        eq(eventContributorLimits.venueId, input.venueId),
      ),
    )
    .limit(1);
  return configured ? configured.guestLimit : input.fallbackGuestLimit;
}
