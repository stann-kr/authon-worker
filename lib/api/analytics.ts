"use server";

import {
  and,
  desc,
  eq,
  gte,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { requireAccess, type SessionUser } from "@/lib/auth/server";
import {
  attendanceActivityLedger,
  eventCloseoutContributorMetrics,
  eventCloseouts,
  events,
  externalDjLinks,
  guests,
  users,
  venueContributors,
  venues,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { reportServerError } from "@/lib/observability/structured-log";
import { isAnalyticsGranularity, resolveAnalyticsPeriod } from "@/lib/analytics/period";
import { buildAdminAnalyticsView } from "@/lib/analytics/service";
import type {
  AdminAnalyticsQuery,
  AdminAnalyticsView,
} from "@/lib/analytics/types";
import type { ApiResponse } from "@/lib/api/types";

const MAX_ANALYTICS_QUERY_ROWS = 2_000;

type AnalyticsErrorCode =
  | "ANALYTICS_LOAD_FAILED"
  | "FORBIDDEN"
  | "INVALID_ANALYTICS_QUERY"
  | "VENUE_UNAVAILABLE";

class AnalyticsActionError extends Error {
  constructor(readonly code: AnalyticsErrorCode) {
    super(code);
  }
}

function requireRequestedVenueId(
  actor: SessionUser,
  requestedVenueId: unknown,
): string {
  if (typeof requestedVenueId !== "string" || !requestedVenueId) {
    throw new AnalyticsActionError("INVALID_ANALYTICS_QUERY");
  }
  if (actor.role !== "super_admin" && actor.venueId !== requestedVenueId) {
    throw new AnalyticsActionError("FORBIDDEN");
  }
  return requestedVenueId;
}

function analyticsError(error: unknown): AnalyticsErrorCode {
  return error instanceof AnalyticsActionError
    ? error.code
    : error instanceof RangeError
      ? "INVALID_ANALYTICS_QUERY"
      : "ANALYTICS_LOAD_FAILED";
}

export async function fetchAdminAnalytics(
  query: AdminAnalyticsQuery,
): Promise<ApiResponse<AdminAnalyticsView>> {
  try {
    const actor = await requireAccess("admin");
    const venueId = requireRequestedVenueId(actor, query?.venueId);
    if (
      !isAnalyticsGranularity(query?.granularity) ||
      typeof query?.anchorDate !== "string" ||
      query?.compare !== "previous"
    ) {
      throw new AnalyticsActionError("INVALID_ANALYTICS_QUERY");
    }

    const db = getDb();
    const [venue] = await db
      .select({ id: venues.id, timezone: venues.timezone })
      .from(venues)
      .where(and(eq(venues.id, venueId), eq(venues.active, true)))
      .limit(1);
    if (!venue) throw new AnalyticsActionError("VENUE_UNAVAILABLE");

    const selection = resolveAnalyticsPeriod({
      granularity: query.granularity,
      anchorDate: query.anchorDate,
      timezone: venue.timezone,
    });
    const guestContributorId = sql<string | null>`case
      when ${guests.externalLinkId} is not null then ${externalDjLinks.contributorId}
      when ${guests.createdByUserId} is not null then ${users.contributorId}
      else null
    end`;
    const guestSourceKind = sql<string>`case
      when ${guests.externalLinkId} is not null then 'external_link'
      when ${guests.createdByUserId} is not null then 'user'
      else 'unattributed'
    end`;
    const guestSourceId = sql<string>`case
      when ${guests.externalLinkId} is not null then ${guests.externalLinkId}
      when ${guests.createdByUserId} is not null then ${guests.createdByUserId}
      else 'unattributed'
    end`;
    const guestSourceDisplayName = sql<string | null>`case
      when ${guests.externalLinkId} is not null then ${externalDjLinks.djName}
      when ${guests.createdByUserId} is not null then ${users.name}
      else null
    end`;
    const contributorSourceKindGroup = sql<string>`case when ${guestContributorId} is null then ${guestSourceKind} else '' end`;
    const contributorSourceIdGroup = sql<string>`case when ${guestContributorId} is null then ${guestSourceId} else ${guestContributorId} end`;

    const [eventRows, guestDayRows, walkInDayRows, contributorRows] = await Promise.all([
      db
        .select({
          eventId: events.id,
          businessDate: events.businessDate,
          name: events.name,
          state: events.state,
          compatibilityKey: events.compatibilityKey,
          confirmedAt: eventCloseouts.confirmedAt,
          registeredCount: eventCloseouts.registeredCount,
          checkedInCount: eventCloseouts.checkedInCount,
          contributorRegisteredCount: sql<number>`coalesce(sum(${eventCloseoutContributorMetrics.registeredCount}), 0)`.mapWith(Number),
          contributorCheckedInCount: sql<number>`coalesce(sum(${eventCloseoutContributorMetrics.checkedInCount}), 0)`.mapWith(Number),
        })
        .from(events)
        .leftJoin(
          eventCloseouts,
          and(
            eq(eventCloseouts.eventId, events.id),
            eq(eventCloseouts.venueId, venueId),
          ),
        )
        .leftJoin(
          eventCloseoutContributorMetrics,
          and(
            eq(
              eventCloseoutContributorMetrics.eventId,
              events.id,
            ),
            eq(eventCloseoutContributorMetrics.venueId, venueId),
          ),
        )
        .where(
          and(
            eq(events.venueId, venueId),
            or(
              and(
                gte(events.businessDate, selection.comparisonPeriod.startDate),
                lt(
                  events.businessDate,
                  selection.comparisonPeriod.endDateExclusive,
                ),
              ),
              and(
                gte(events.businessDate, selection.period.startDate),
                lt(events.businessDate, selection.period.dataEndDateExclusive),
              ),
            ),
          ),
        )
        .groupBy(events.id, eventCloseouts.eventId)
        .orderBy(desc(events.businessDate), desc(events.id))
        .limit(MAX_ANALYTICS_QUERY_ROWS + 1),
      db
        .select({
          businessDate: guests.date,
          registeredCount: sql<number>`count(*)`.mapWith(Number),
          checkedInCount: sql<number>`coalesce(sum(case when ${guests.status} = 'checked' then 1 else 0 end), 0)`.mapWith(Number),
        })
        .from(guests)
        .where(
          and(
            eq(guests.venueId, venueId),
            ne(guests.status, "deleted"),
            or(
              and(
                gte(guests.date, selection.comparisonPeriod.startDate),
                lt(guests.date, selection.comparisonPeriod.endDateExclusive),
              ),
              and(
                gte(guests.date, selection.period.startDate),
                lt(guests.date, selection.period.dataEndDateExclusive),
              ),
            ),
          ),
        )
        .groupBy(guests.date)
        .orderBy(desc(guests.date))
        .limit(MAX_ANALYTICS_QUERY_ROWS + 1),
      db
        .select({
          businessDate: attendanceActivityLedger.businessDate,
          walkInCount:
            sql<number>`coalesce(sum(${attendanceActivityLedger.delta}), 0)`.mapWith(Number),
        })
        .from(attendanceActivityLedger)
        .where(
          and(
            eq(attendanceActivityLedger.venueId, venueId),
            or(
              and(
                gte(
                  attendanceActivityLedger.businessDate,
                  selection.comparisonPeriod.startDate,
                ),
                lt(
                  attendanceActivityLedger.businessDate,
                  selection.comparisonPeriod.endDateExclusive,
                ),
              ),
              and(
                gte(
                  attendanceActivityLedger.businessDate,
                  selection.period.startDate,
                ),
                lt(
                  attendanceActivityLedger.businessDate,
                  selection.period.dataEndDateExclusive,
                ),
              ),
            ),
          ),
        )
        .groupBy(attendanceActivityLedger.businessDate)
        .orderBy(desc(attendanceActivityLedger.businessDate))
        .limit(MAX_ANALYTICS_QUERY_ROWS + 1),
      db
        .select({
          contributorId: guestContributorId,
          displayName: sql<string | null>`max(${venueContributors.displayName})`,
          sourceDisplayName: sql<string | null>`max(${guestSourceDisplayName})`,
          sourceKind: sql<string>`min(${guestSourceKind})`,
          sourceId: sql<string>`min(${guestSourceId})`,
          operatingDays: sql<number>`count(distinct ${guests.date})`.mapWith(Number),
          registered: sql<number>`count(*)`.mapWith(Number),
          checkedIn: sql<number>`coalesce(sum(case when ${guests.status} = 'checked' then 1 else 0 end), 0)`.mapWith(Number),
          guestRows: sql<number>`count(*)`.mapWith(Number),
        })
        .from(guests)
        .leftJoin(
          users,
          and(
            eq(users.id, guests.createdByUserId),
            eq(users.venueId, venueId),
          ),
        )
        .leftJoin(
          externalDjLinks,
          and(
            eq(externalDjLinks.id, guests.externalLinkId),
            eq(externalDjLinks.venueId, venueId),
          ),
        )
        .leftJoin(
          venueContributors,
          and(
            eq(venueContributors.id, guestContributorId),
            eq(venueContributors.venueId, venueId),
          ),
        )
        .where(
          and(
            eq(guests.venueId, venueId),
            ne(guests.status, "deleted"),
            gte(guests.date, selection.period.startDate),
            lt(guests.date, selection.period.dataEndDateExclusive),
          ),
        )
        .groupBy(
          guestContributorId,
          contributorSourceKindGroup,
          contributorSourceIdGroup,
        )
        .limit(MAX_ANALYTICS_QUERY_ROWS + 1),
    ]);
    if (
      eventRows.length > MAX_ANALYTICS_QUERY_ROWS ||
      guestDayRows.length > MAX_ANALYTICS_QUERY_ROWS ||
      walkInDayRows.length > MAX_ANALYTICS_QUERY_ROWS ||
      contributorRows.length > MAX_ANALYTICS_QUERY_ROWS
    ) {
      throw new AnalyticsActionError("INVALID_ANALYTICS_QUERY");
    }

    return {
      data: buildAdminAnalyticsView({
        selection,
        eventRows,
        guestDayRows,
        walkInDayRows,
        contributorRows,
      }),
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("analytics.admin.load", error);
    return { data: null, error: analyticsError(error) };
  }
}
