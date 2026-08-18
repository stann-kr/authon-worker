"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { requireAccess, type SessionUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import {
  attendanceActivityLedger,
  attendanceCloseouts,
  guests,
  venues,
} from "@/lib/db/schema";
import { getBusinessDate } from "@/lib/date";
import { getCompatibilityEventKey } from "@/lib/events/domain";
import { loadEventById, findCompatibilityEvent } from "@/lib/events/server";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import { reportServerError } from "@/lib/observability/structured-log";
import { hashOpaqueIdentifier } from "@/lib/guests/activity-ledger";
import {
  canApplyAttendanceEventMutation,
  isAttendanceScope,
  isAttendanceIdempotencyKey,
  prepareAttendanceReconciliation,
  prepareAttendanceSyncBatch,
  type AttendanceScope,
} from "@/lib/attendance/domain";
import {
  persistAttendanceReconciliation,
  persistDoorAttendanceMutation,
} from "@/lib/attendance/persistence";
import type {
  AttendanceSyncResponse,
  AttendanceSyncResult,
  DoorAttendanceSummary,
} from "@/lib/attendance/types";
import type { ApiResponse, Event } from "@/lib/api/types";

type VenueSettings = {
  id: string;
  timezone: string;
  openingTime: string;
  closingTime: string;
};

class AttendanceActionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function resolveRequestedVenueId(
  actor: SessionUser,
  requestedVenueId: string,
): string {
  const venueId = actor.role === "super_admin" ? requestedVenueId : actor.venueId;
  if (!venueId || venueId !== requestedVenueId) {
    throw new AttendanceActionError("ATTENDANCE_FORBIDDEN");
  }
  return venueId;
}

async function loadAttendanceScope(params: {
  actor: SessionUser;
  scope: AttendanceScope;
}): Promise<{ venue: VenueSettings; event: Event | null }> {
  if (!isAttendanceScope(params.scope)) {
    throw new AttendanceActionError("INVALID_ATTENDANCE_SCOPE");
  }
  const venueId = resolveRequestedVenueId(params.actor, params.scope.venueId);
  await requireActiveVenueId(venueId);
  const [venue] = await getDb()
    .select({
      id: venues.id,
      timezone: venues.timezone,
      openingTime: venues.openingTime,
      closingTime: venues.closingTime,
    })
    .from(venues)
    .where(and(eq(venues.id, venueId), eq(venues.active, true)))
    .limit(1);
  if (!venue) throw new AttendanceActionError("ATTENDANCE_VENUE_UNAVAILABLE");
  const event = params.scope.eventId
    ? await loadEventById(getDb(), params.scope.eventId)
    : null;
  if (
    params.scope.eventId &&
    (!event ||
      event.venueId !== venueId ||
      event.businessDate !== params.scope.businessDate ||
      event.compatibilityKey !== null)
  ) {
    throw new AttendanceActionError("ATTENDANCE_EVENT_UNAVAILABLE");
  }
  return { venue, event };
}

async function countCheckedInGuests(
  scope: AttendanceScope,
): Promise<number> {
  const compatibilityEvent = scope.eventId
    ? null
    : await findCompatibilityEvent(scope.venueId, scope.businessDate);
  const eventScope = scope.eventId
    ? eq(guests.eventId, scope.eventId)
    : compatibilityEvent
      ? or(isNull(guests.eventId), eq(guests.eventId, compatibilityEvent.id))
      : isNull(guests.eventId);
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(guests)
    .where(
      and(
        eq(guests.venueId, scope.venueId),
        eq(guests.date, scope.businessDate),
        eq(guests.status, "checked"),
        ne(guests.status, "deleted"),
        eventScope,
      ),
    );
  return Number(row?.count ?? 0);
}

async function buildDoorAttendanceSummary(params: {
  scope: AttendanceScope;
  actorUserId: string;
  deviceKeyHash: string | null;
  venue: VenueSettings;
  event: Event | null;
}): Promise<DoorAttendanceSummary> {
  const eventCondition = params.scope.eventId
    ? eq(attendanceActivityLedger.eventId, params.scope.eventId)
    : isNull(attendanceActivityLedger.eventId);
  const closeoutCondition = params.scope.eventId
    ? eq(attendanceCloseouts.eventId, params.scope.eventId)
    : isNull(attendanceCloseouts.eventId);
  const [closeout] = await getDb()
    .select({
      checkedInGuests: attendanceCloseouts.checkedInGuests,
      finalWalkIns: attendanceCloseouts.finalWalkIns,
      targetTotalAttendance: attendanceCloseouts.targetTotalAttendance,
      sourceActivityCount: attendanceCloseouts.sourceActivityCount,
      finalizedAt: attendanceCloseouts.finalizedAt,
    })
    .from(attendanceCloseouts)
    .where(and(
      eq(attendanceCloseouts.venueId, params.scope.venueId),
      eq(attendanceCloseouts.businessDate, params.scope.businessDate),
      closeoutCondition,
    ))
    .limit(1);
  if (closeout) {
    return {
      venueId: params.scope.venueId,
      businessDate: params.scope.businessDate,
      eventId: params.scope.eventId,
      checkedInGuests: closeout.checkedInGuests,
      walkIns: closeout.finalWalkIns,
      totalAttendance: closeout.targetTotalAttendance,
      sourceActivityCount: closeout.sourceActivityCount,
      isFinalized: true,
      finalizedAt: closeout.finalizedAt,
      canFinalize: false,
      lastUndoableIdempotencyKey: null,
      canRecord: false,
      unavailableReason: "scope_closed",
      serverUpdatedAt: new Date().toISOString(),
    };
  }
  const [totals, checkedInGuests, lastUndoable] = await Promise.all([
    getDb()
      .select({
        walkIns: sql<number>`coalesce(sum(${attendanceActivityLedger.delta}), 0)`.mapWith(Number),
        sourceActivityCount: sql<number>`count(*)`.mapWith(Number),
      })
      .from(attendanceActivityLedger)
      .where(
        and(
          eq(attendanceActivityLedger.venueId, params.scope.venueId),
          eq(attendanceActivityLedger.businessDate, params.scope.businessDate),
          eventCondition,
        ),
      ),
    countCheckedInGuests(params.scope),
    params.deviceKeyHash
      ? getDb().all<{ idempotencyKey: string }>(sql`
          SELECT original.idempotency_key AS idempotencyKey
          FROM attendance_activity_ledger original
          WHERE original.venue_id = ${params.scope.venueId}
            AND original.business_date = ${params.scope.businessDate}
            AND original.event_id IS ${params.scope.eventId}
            AND original.actor_user_id = ${params.actorUserId}
            AND original.device_key_hash = ${params.deviceKeyHash}
            AND original.action = 'walk_in'
            AND NOT EXISTS (
              SELECT 1 FROM attendance_activity_ledger reversal
              WHERE reversal.reverses_activity_id = original.id
            )
          ORDER BY original.device_sequence DESC, original.occurred_at DESC
          LIMIT 1
        `)
      : Promise.resolve([]),
  ]);
  const walkIns = Number(totals[0]?.walkIns ?? 0);
  if (!Number.isSafeInteger(walkIns) || walkIns < 0) {
    throw new AttendanceActionError("ATTENDANCE_TOTAL_INVALID");
  }
  const currentBusinessDate = getBusinessDate(params.venue);
  const isCurrentDate = params.scope.businessDate === currentBusinessDate;
  const isEventActive = !params.event || params.event.state === "open";
  return {
    venueId: params.scope.venueId,
    businessDate: params.scope.businessDate,
    eventId: params.scope.eventId,
    checkedInGuests,
    walkIns,
    totalAttendance: checkedInGuests + walkIns,
    sourceActivityCount: Number(totals[0]?.sourceActivityCount ?? 0),
    isFinalized: false,
    finalizedAt: null,
    canFinalize:
      !params.event ||
      params.event.state === "closed" ||
      params.event.state === "archived",
    lastUndoableIdempotencyKey: lastUndoable[0]?.idempotencyKey ?? null,
    canRecord: isCurrentDate && isEventActive,
    unavailableReason: !isCurrentDate
      ? "past_date"
      : !isEventActive
        ? "event_inactive"
        : null,
    serverUpdatedAt: new Date().toISOString(),
  };
}

export async function fetchDoorAttendanceSummary(params: {
  scope: AttendanceScope;
  deviceId?: string | null;
}): Promise<ApiResponse<DoorAttendanceSummary>> {
  try {
    const actor = await requireAccess("door");
    const { venue, event } = await loadAttendanceScope({ actor, scope: params.scope });
    const deviceKeyHash = params.deviceId
      ? await hashOpaqueIdentifier(params.deviceId)
      : null;
    return {
      data: await buildDoorAttendanceSummary({
        scope: params.scope,
        actorUserId: actor.id,
        deviceKeyHash,
        venue,
        event,
      }),
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("attendance.summary", error);
    return {
      data: null,
      error: error instanceof AttendanceActionError
        ? error.code
        : "ATTENDANCE_SUMMARY_FAILED",
    };
  }
}

export async function syncDoorAttendanceMutations(params: {
  scope: AttendanceScope;
  deviceId: string;
  items: unknown[];
}): Promise<ApiResponse<AttendanceSyncResponse>> {
  try {
    const actor = await requireAccess("door");
    const { venue, event } = await loadAttendanceScope({ actor, scope: params.scope });
    const items = prepareAttendanceSyncBatch({
      deviceId: params.deviceId,
      items: params.items,
    });
    const deviceKeyHash = await hashOpaqueIdentifier(params.deviceId);
    const { env } = getCloudflareContext();
    const results: AttendanceSyncResult[] = [];
    for (const item of items) {
      const canApplyNew =
        !item.isExpired &&
        getBusinessDate(venue, new Date(item.occurredAt)) === params.scope.businessDate &&
        (!event || event.state === "open") &&
        canApplyAttendanceEventMutation(event, item.occurredAt);
      const persisted = await persistDoorAttendanceMutation({
        database: env.DB,
        scope: params.scope,
        actorUserId: actor.id,
        deviceKeyHash,
        deviceSequence: item.sequence,
        idempotencyKey: item.idempotencyKey,
        action: item.action,
        reversesIdempotencyKey: item.reversesIdempotencyKey,
        occurredAt: item.occurredAt,
        createdAt: new Date().toISOString(),
        canApplyNew,
      });
      results.push({
        idempotencyKey: item.idempotencyKey,
        state:
          persisted.outcome === "applied"
            ? "confirmed"
            : persisted.outcome,
        activityId: persisted.activityId,
      });
    }
    return {
      data: {
        items: results,
        summary: await buildDoorAttendanceSummary({
          scope: params.scope,
          actorUserId: actor.id,
          deviceKeyHash,
          venue,
          event,
        }),
      },
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("attendance.sync", error);
    return { data: null, error: "ATTENDANCE_SYNC_FAILED" };
  }
}

export async function reconcileDoorAttendance(params: {
  scope: AttendanceScope;
  targetTotalAttendance: number;
  expectedCheckedInGuests: number;
  expectedWalkIns: number;
  expectedSourceActivityCount: number;
  reason: string;
  idempotencyKey: string;
}): Promise<ApiResponse<DoorAttendanceSummary>> {
  try {
    const actor = await requireAccess("admin");
    const { venue, event } = await loadAttendanceScope({ actor, scope: params.scope });
    const reconciliation = prepareAttendanceReconciliation(params);
    if (
      !isAttendanceIdempotencyKey(params.idempotencyKey) ||
      params.idempotencyKey.length < 8
    ) {
      throw new AttendanceActionError("INVALID_ATTENDANCE_RECONCILIATION");
    }
    const { env } = getCloudflareContext();
    const occurredAt = new Date().toISOString();
    const result = await persistAttendanceReconciliation({
      database: env.DB,
      scope: params.scope,
      compatibilityEventKey: getCompatibilityEventKey(
        params.scope.venueId,
        params.scope.businessDate,
      ),
      actorUserId: actor.id,
      idempotencyKey: params.idempotencyKey,
      targetTotalAttendance: reconciliation.targetTotalAttendance,
      expectedCheckedInGuests: reconciliation.expectedCheckedInGuests,
      expectedWalkIns: reconciliation.expectedWalkIns,
      expectedSourceActivityCount: reconciliation.expectedSourceActivityCount,
      reason: reconciliation.reason,
      occurredAt,
    });
    if (result.outcome === "conflict") {
      throw new AttendanceActionError("ATTENDANCE_IDEMPOTENCY_CONFLICT");
    }
    if (result.outcome === "stale") {
      throw new AttendanceActionError("ATTENDANCE_RECONCILIATION_STALE");
    }
    if (result.outcome === "scope_closed") {
      throw new AttendanceActionError("ATTENDANCE_SCOPE_CLOSED");
    }
    if (result.outcome === "rejected") {
      throw new AttendanceActionError("ATTENDANCE_RECONCILIATION_REJECTED");
    }
    return {
      data: await buildDoorAttendanceSummary({
        scope: params.scope,
        actorUserId: actor.id,
        deviceKeyHash: null,
        venue,
        event,
      }),
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("attendance.reconcile", error);
    return {
      data: null,
      error: error instanceof AttendanceActionError
        ? error.code
        : "ATTENDANCE_RECONCILIATION_FAILED",
    };
  }
}
