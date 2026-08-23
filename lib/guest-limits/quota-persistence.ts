import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

import type { getDb } from "../db/client.ts";
import {
  eventContributorLimits,
  guestLimitRequests,
  guests,
  venues,
} from "../db/schema.ts";

type GuestQuotaDb = ReturnType<typeof getDb>;

export interface GuestQuotaScope {
  venueId: string;
  userId: string;
  date: string;
  eventId: string | null;
  includeLegacyRows: boolean;
}

export async function loadGuestQuotaState(
  db: GuestQuotaDb,
  scope: GuestQuotaScope,
) {
  const guestEventScope = scope.eventId
    ? scope.includeLegacyRows
      ? or(
          eq(guests.eventId, scope.eventId),
          and(isNull(guests.eventId), eq(guests.date, scope.date)),
        )
      : eq(guests.eventId, scope.eventId)
    : and(isNull(guests.eventId), eq(guests.date, scope.date));
  const requestEventScope = scope.eventId
    ? scope.includeLegacyRows
      ? or(
          eq(guestLimitRequests.eventId, scope.eventId),
          and(
            isNull(guestLimitRequests.eventId),
            eq(guestLimitRequests.date, scope.date),
          ),
        )
      : eq(guestLimitRequests.eventId, scope.eventId)
    : and(
        isNull(guestLimitRequests.eventId),
        eq(guestLimitRequests.date, scope.date),
      );
  const activeVenueScope = sql<number>`EXISTS (
    SELECT 1
    FROM ${venues}
    WHERE ${venues.id} = ${scope.venueId}
      AND ${venues.active} = 1
  )`;

  const [usage, extra, pending, configuredLimit] = await Promise.all([
    db
      .select({
        used: sql<number>`count(*)`,
        venueActive: activeVenueScope,
      })
      .from(guests)
      .where(
        and(
          activeVenueScope,
          eq(guests.venueId, scope.venueId),
          eq(guests.createdByUserId, scope.userId),
          guestEventScope,
          ne(guests.status, "deleted"),
        ),
      ),
    db
      .select({
        approvedExtra: sql<number>`coalesce(sum(${guestLimitRequests.approvedExtra}), 0)`,
      })
      .from(guestLimitRequests)
      .where(
        and(
          activeVenueScope,
          eq(guestLimitRequests.venueId, scope.venueId),
          eq(guestLimitRequests.userId, scope.userId),
          requestEventScope,
          eq(guestLimitRequests.status, "approved"),
        ),
      ),
    db
      .select()
      .from(guestLimitRequests)
      .where(
        and(
          activeVenueScope,
          eq(guestLimitRequests.venueId, scope.venueId),
          eq(guestLimitRequests.userId, scope.userId),
          requestEventScope,
          eq(guestLimitRequests.status, "pending"),
        ),
      )
      .limit(1),
    scope.eventId
      ? db
          .select({ guestLimit: eventContributorLimits.guestLimit })
          .from(eventContributorLimits)
          .where(
            and(
              activeVenueScope,
              eq(eventContributorLimits.eventId, scope.eventId),
              eq(eventContributorLimits.userId, scope.userId),
              eq(eventContributorLimits.venueId, scope.venueId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  if (Number(usage[0]?.venueActive ?? 0) !== 1) {
    throw new Error("INACTIVE_VENUE");
  }

  return {
    used: Number(usage[0]?.used ?? 0),
    approvedExtra: Number(extra[0]?.approvedExtra ?? 0),
    pendingRequest: pending[0] ?? null,
    configuredLimit: configuredLimit[0]?.guestLimit,
  };
}
