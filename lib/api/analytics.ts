"use server";

import {
  and,
  desc,
  eq,
  gte,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { requireAccess, type SessionUser } from "@/lib/auth/server";
import {
  eventCloseoutContributorMetrics,
  eventCloseouts,
  events,
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
    const sourceKindGroup = sql<string>`case when ${eventCloseoutContributorMetrics.contributorId} is null then ${eventCloseoutContributorMetrics.sourceKind} else '' end`;
    const sourceIdGroup = sql<string>`case when ${eventCloseoutContributorMetrics.contributorId} is null then ${eventCloseoutContributorMetrics.sourceId} else ${eventCloseoutContributorMetrics.contributorId} end`;

    const [eventRows, contributorRows] = await Promise.all([
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
          contributorId: eventCloseoutContributorMetrics.contributorId,
          displayName: sql<string | null>`max(${venueContributors.displayName})`,
          sourceKind: sql<string>`min(${eventCloseoutContributorMetrics.sourceKind})`,
          sourceId: sql<string>`min(${eventCloseoutContributorMetrics.sourceId})`,
          events: sql<number>`count(distinct ${eventCloseoutContributorMetrics.eventId})`.mapWith(Number),
          registered: sql<number>`coalesce(sum(${eventCloseoutContributorMetrics.registeredCount}), 0)`.mapWith(Number),
          checkedIn: sql<number>`coalesce(sum(${eventCloseoutContributorMetrics.checkedInCount}), 0)`.mapWith(Number),
          snapshotRows: sql<number>`count(*)`.mapWith(Number),
        })
        .from(eventCloseoutContributorMetrics)
        .innerJoin(
          events,
          and(
            eq(events.id, eventCloseoutContributorMetrics.eventId),
            eq(events.venueId, venueId),
          ),
        )
        .leftJoin(
          venueContributors,
          and(
            eq(
              venueContributors.id,
              eventCloseoutContributorMetrics.contributorId,
            ),
            eq(venueContributors.venueId, venueId),
          ),
        )
        .where(
          and(
            eq(eventCloseoutContributorMetrics.venueId, venueId),
            gte(events.businessDate, selection.period.startDate),
            lt(events.businessDate, selection.period.dataEndDateExclusive),
          ),
        )
        .groupBy(
          eventCloseoutContributorMetrics.contributorId,
          sourceKindGroup,
          sourceIdGroup,
        )
        .limit(MAX_ANALYTICS_QUERY_ROWS + 1),
    ]);
    if (
      eventRows.length > MAX_ANALYTICS_QUERY_ROWS ||
      contributorRows.length > MAX_ANALYTICS_QUERY_ROWS
    ) {
      throw new AnalyticsActionError("INVALID_ANALYTICS_QUERY");
    }

    return {
      data: buildAdminAnalyticsView({
        selection,
        eventRows,
        contributorRows,
      }),
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("analytics.admin.load", error);
    return { data: null, error: analyticsError(error) };
  }
}
