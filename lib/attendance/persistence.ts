import type { D1Database } from "@cloudflare/workers-types";
import { hashOpaqueIdentifier } from "../guests/activity-ledger.ts";
import type {
  AttendanceScope,
  DoorAttendanceAction,
} from "./domain.ts";

export type AttendancePersistenceOutcome =
  | "applied"
  | "replayed"
  | "conflict"
  | "scope_closed"
  | "rejected";

export type AttendanceReconciliationOutcome =
  | AttendancePersistenceOutcome
  | "stale";

interface ExistingAttendanceActivity {
  id: string;
  payloadHash: string;
}

interface ExistingAttendanceCloseout {
  id: string;
  payloadHash: string;
  adjustmentActivityId: string | null;
}

const SELECT_EXISTING_ATTENDANCE_SQL = `
  SELECT id, payload_hash AS payloadHash
  FROM attendance_activity_ledger
  WHERE venue_id = ? AND idempotency_key = ?
  LIMIT 1
`;

const SELECT_EXISTING_ATTENDANCE_CLOSEOUT_SQL = `
  SELECT
    id,
    payload_hash AS payloadHash,
    adjustment_activity_id AS adjustmentActivityId
  FROM attendance_closeouts
  WHERE venue_id = ? AND idempotency_key = ?
  LIMIT 1
`;

const SELECT_ATTENDANCE_SCOPE_CLOSEOUT_SQL = `
  SELECT id
  FROM attendance_closeouts
  WHERE venue_id = ? AND business_date = ? AND event_id IS ?
  LIMIT 1
`;

export const INSERT_WALK_IN_ATTENDANCE_SQL = `
  INSERT INTO attendance_activity_ledger (
    id, venue_id, business_date, event_id, action, delta,
    reverses_activity_id, adjustment_reason, actor_user_id, channel,
    request_id, idempotency_key, payload_hash, device_key_hash,
    device_sequence, occurred_at, created_at
  )
  SELECT ?, ?, ?, ?, 'walk_in', 1, NULL, NULL, ?, 'door', ?, ?, ?, ?, ?, ?, ?
  WHERE NOT EXISTS (
    SELECT 1 FROM attendance_closeouts
    WHERE venue_id = ? AND business_date = ? AND event_id IS ?
  )
    AND NOT EXISTS (
      SELECT 1 FROM attendance_closeouts
      WHERE venue_id = ? AND idempotency_key = ?
    )
  ON CONFLICT DO NOTHING
  RETURNING id
`;

export const INSERT_REVERSAL_ATTENDANCE_SQL = `
  INSERT INTO attendance_activity_ledger (
    id, venue_id, business_date, event_id, action, delta,
    reverses_activity_id, adjustment_reason, actor_user_id, channel,
    request_id, idempotency_key, payload_hash, device_key_hash,
    device_sequence, occurred_at, created_at
  )
  SELECT ?, original.venue_id, original.business_date, original.event_id,
    'reversal', -1, original.id, NULL, ?, 'door', ?, ?, ?, ?, ?, ?, ?
  FROM attendance_activity_ledger original
  WHERE original.venue_id = ?
    AND original.business_date = ?
    AND original.event_id IS ?
    AND original.idempotency_key = ?
    AND original.action = 'walk_in'
    AND original.actor_user_id = ?
    AND original.device_key_hash = ?
    AND NOT EXISTS (
      SELECT 1 FROM attendance_closeouts
      WHERE venue_id = original.venue_id
        AND business_date = original.business_date
        AND event_id IS original.event_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM attendance_closeouts
      WHERE venue_id = original.venue_id
        AND idempotency_key = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM attendance_activity_ledger reversal
      WHERE reversal.reverses_activity_id = original.id
  )
  ON CONFLICT DO NOTHING
  RETURNING id
`;

export const INSERT_ATTENDANCE_CLOSEOUT_SQL = `
  WITH current_counts AS (
    SELECT
      (
        SELECT count(*)
        FROM guests
        WHERE venue_id = ?
          AND date = ?
          AND status = 'checked'
          AND (
            (? IS NOT NULL AND event_id = ?)
            OR
            (? IS NULL AND (
              event_id IS NULL
              OR event_id = (
                SELECT id
                FROM events
                WHERE venue_id = ?
                  AND business_date = ?
                  AND compatibility_key = ?
                LIMIT 1
              )
            ))
          )
      ) AS checked_in_guests,
      (
        SELECT coalesce(sum(delta), 0)
        FROM attendance_activity_ledger
        WHERE venue_id = ? AND business_date = ? AND event_id IS ?
      ) AS walk_ins
      ,(
        SELECT count(*)
        FROM attendance_activity_ledger
        WHERE venue_id = ? AND business_date = ? AND event_id IS ?
      ) AS source_activity_count
  ),
  candidate AS (
    SELECT
      checked_in_guests,
      walk_ins,
      source_activity_count,
      ? - checked_in_guests - walk_ins AS delta
    FROM current_counts
  )
  INSERT INTO attendance_closeouts (
    id, venue_id, business_date, event_id,
    target_total_attendance, checked_in_guests, pre_adjustment_walk_ins,
    final_walk_ins, adjustment_delta, source_activity_count,
    adjustment_activity_id, adjustment_reason, actor_user_id, request_id,
    idempotency_key, payload_hash, report_hash, finalized_at, created_at
  )
  SELECT ?, ?, ?, ?, ?, candidate.checked_in_guests, candidate.walk_ins,
    candidate.walk_ins + candidate.delta, candidate.delta,
    candidate.source_activity_count,
    CASE WHEN candidate.delta = 0 THEN NULL ELSE ? END,
    ?, ?, ?, ?, ?, ?, ?, ?
  FROM candidate
  WHERE candidate.checked_in_guests = ?
    AND candidate.walk_ins = ?
    AND candidate.source_activity_count = ?
    AND ? >= candidate.checked_in_guests
    AND candidate.delta BETWEEN -500 AND 500
    AND NOT EXISTS (
      SELECT 1 FROM attendance_activity_ledger
      WHERE venue_id = ? AND idempotency_key = ?
    )
    AND (
      ? IS NULL
      OR EXISTS (
        SELECT 1 FROM events
        WHERE id = ?
          AND venue_id = ?
          AND business_date = ?
          AND compatibility_key IS NULL
          AND state IN ('closed', 'archived')
      )
  )
  ON CONFLICT DO NOTHING
  RETURNING id, adjustment_activity_id AS adjustmentActivityId
`;

const SELECT_ATTENDANCE_CLOSEOUT_COUNTS_SQL = `
  SELECT
    (
      SELECT count(*)
      FROM guests
      WHERE venue_id = ?
        AND date = ?
        AND status = 'checked'
        AND (
          (? IS NOT NULL AND event_id = ?)
          OR
          (? IS NULL AND (
            event_id IS NULL
            OR event_id = (
              SELECT id
              FROM events
              WHERE venue_id = ?
                AND business_date = ?
                AND compatibility_key = ?
              LIMIT 1
            )
          ))
        )
    ) AS checkedInGuests,
    (
      SELECT coalesce(sum(delta), 0)
      FROM attendance_activity_ledger
      WHERE venue_id = ? AND business_date = ? AND event_id IS ?
    ) AS walkIns,
    (
      SELECT count(*)
      FROM attendance_activity_ledger
      WHERE venue_id = ? AND business_date = ? AND event_id IS ?
    ) AS sourceActivityCount
`;

async function loadExisting(
  database: D1Database,
  venueId: string,
  idempotencyKey: string,
): Promise<ExistingAttendanceActivity | null> {
  return database
    .prepare(SELECT_EXISTING_ATTENDANCE_SQL)
    .bind(venueId, idempotencyKey)
    .first<ExistingAttendanceActivity>();
}

async function loadExistingCloseout(
  database: D1Database,
  venueId: string,
  idempotencyKey: string,
): Promise<ExistingAttendanceCloseout | null> {
  return database
    .prepare(SELECT_EXISTING_ATTENDANCE_CLOSEOUT_SQL)
    .bind(venueId, idempotencyKey)
    .first<ExistingAttendanceCloseout>();
}

async function hasClosedAttendanceScope(
  database: D1Database,
  scope: AttendanceScope,
): Promise<boolean> {
  const closeout = await database
    .prepare(SELECT_ATTENDANCE_SCOPE_CLOSEOUT_SQL)
    .bind(scope.venueId, scope.businessDate, scope.eventId)
    .first<{ id: string }>();
  return Boolean(closeout);
}

async function resolveInsertOutcome(params: {
  database: D1Database;
  venueId: string;
  idempotencyKey: string;
  payloadHash: string;
  insertedId: string | null;
}): Promise<{ outcome: AttendancePersistenceOutcome; activityId: string | null }> {
  if (params.insertedId) {
    return { outcome: "applied", activityId: params.insertedId };
  }
  const existing = await loadExisting(
    params.database,
    params.venueId,
    params.idempotencyKey,
  );
  if (!existing) return { outcome: "rejected", activityId: null };
  return existing.payloadHash === params.payloadHash
    ? { outcome: "replayed", activityId: existing.id }
    : { outcome: "conflict", activityId: null };
}

export async function hashAttendancePayload(params: {
  scope: AttendanceScope;
  action: DoorAttendanceAction;
  delta: number;
  reversesIdempotencyKey?: string | null;
  reason?: string | null;
  actorUserId: string;
  deviceSequence?: number | null;
  occurredAt: string;
}): Promise<string> {
  return hashOpaqueIdentifier(JSON.stringify([
    params.scope.venueId,
    params.scope.businessDate,
    params.scope.eventId,
    params.action,
    params.delta,
    params.reversesIdempotencyKey ?? null,
    params.reason ?? null,
    params.actorUserId,
    params.deviceSequence ?? null,
    params.occurredAt,
  ]));
}

export async function hashAttendanceReconciliationPayload(params: {
  scope: AttendanceScope;
  targetTotalAttendance: number;
  expectedCheckedInGuests: number;
  expectedWalkIns: number;
  expectedSourceActivityCount: number;
  reason: string;
  actorUserId: string;
}): Promise<string> {
  return hashOpaqueIdentifier(JSON.stringify([
    params.scope.venueId,
    params.scope.businessDate,
    params.scope.eventId,
    "total_reconciliation",
    params.targetTotalAttendance,
    params.expectedCheckedInGuests,
    params.expectedWalkIns,
    params.expectedSourceActivityCount,
    params.reason,
    params.actorUserId,
  ]));
}

export async function hashAttendanceCloseoutReport(params: {
  scope: AttendanceScope;
  targetTotalAttendance: number;
  checkedInGuests: number;
  preAdjustmentWalkIns: number;
  adjustmentDelta: number;
  sourceActivityCount: number;
  reason: string;
  actorUserId: string;
  finalizedAt: string;
}): Promise<string> {
  return hashOpaqueIdentifier(JSON.stringify([
    "attendance-closeout:v1",
    params.scope.venueId,
    params.scope.businessDate,
    params.scope.eventId,
    params.targetTotalAttendance,
    params.checkedInGuests,
    params.preAdjustmentWalkIns,
    params.preAdjustmentWalkIns + params.adjustmentDelta,
    params.adjustmentDelta,
    params.sourceActivityCount,
    params.reason,
    params.actorUserId,
    params.finalizedAt,
  ]));
}

export async function persistDoorAttendanceMutation(params: {
  database: D1Database;
  scope: AttendanceScope;
  actorUserId: string;
  deviceKeyHash: string;
  deviceSequence: number;
  idempotencyKey: string;
  action: DoorAttendanceAction;
  reversesIdempotencyKey: string | null;
  occurredAt: string;
  createdAt: string;
  canApplyNew: boolean;
}): Promise<{ outcome: AttendancePersistenceOutcome; activityId: string | null }> {
  const delta = params.action === "walk_in" ? 1 : -1;
  const payloadHash = await hashAttendancePayload({
    scope: params.scope,
    action: params.action,
    delta,
    reversesIdempotencyKey: params.reversesIdempotencyKey,
    actorUserId: params.actorUserId,
    deviceSequence: params.deviceSequence,
    occurredAt: params.occurredAt,
  });
  const existing = await loadExisting(
    params.database,
    params.scope.venueId,
    params.idempotencyKey,
  );
  if (existing) {
    return existing.payloadHash === payloadHash
      ? { outcome: "replayed", activityId: existing.id }
      : { outcome: "conflict", activityId: null };
  }
  const existingCloseout = await loadExistingCloseout(
    params.database,
    params.scope.venueId,
    params.idempotencyKey,
  );
  if (existingCloseout) {
    return { outcome: "conflict", activityId: null };
  }
  if (!params.canApplyNew) {
    return { outcome: "rejected", activityId: null };
  }
  if (await hasClosedAttendanceScope(params.database, params.scope)) {
    return { outcome: "scope_closed", activityId: null };
  }

  const activityId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const inserted = params.action === "walk_in"
    ? await params.database
        .prepare(INSERT_WALK_IN_ATTENDANCE_SQL)
        .bind(
          activityId,
          params.scope.venueId,
          params.scope.businessDate,
          params.scope.eventId,
          params.actorUserId,
          requestId,
          params.idempotencyKey,
          payloadHash,
          params.deviceKeyHash,
          params.deviceSequence,
          params.occurredAt,
          params.createdAt,
          params.scope.venueId,
          params.scope.businessDate,
          params.scope.eventId,
          params.scope.venueId,
          params.idempotencyKey,
        )
        .first<{ id: string }>()
    : await params.database
        .prepare(INSERT_REVERSAL_ATTENDANCE_SQL)
        .bind(
          activityId,
          params.actorUserId,
          requestId,
          params.idempotencyKey,
          payloadHash,
          params.deviceKeyHash,
          params.deviceSequence,
          params.occurredAt,
          params.createdAt,
          params.scope.venueId,
          params.scope.businessDate,
          params.scope.eventId,
          params.reversesIdempotencyKey,
          params.actorUserId,
          params.deviceKeyHash,
          params.idempotencyKey,
        )
        .first<{ id: string }>();
  const outcome = await resolveInsertOutcome({
    database: params.database,
    venueId: params.scope.venueId,
    idempotencyKey: params.idempotencyKey,
    payloadHash,
    insertedId: inserted?.id ?? null,
  });
  if (outcome.outcome !== "rejected") return outcome;
  const racedCloseout = await loadExistingCloseout(
    params.database,
    params.scope.venueId,
    params.idempotencyKey,
  );
  if (racedCloseout) {
    return { outcome: "conflict", activityId: null };
  }
  return (await hasClosedAttendanceScope(params.database, params.scope))
    ? { outcome: "scope_closed", activityId: null }
    : outcome;
}

export async function persistAttendanceReconciliation(params: {
  database: D1Database;
  scope: AttendanceScope;
  compatibilityEventKey: string;
  actorUserId: string;
  idempotencyKey: string;
  targetTotalAttendance: number;
  expectedCheckedInGuests: number;
  expectedWalkIns: number;
  expectedSourceActivityCount: number;
  reason: string;
  occurredAt: string;
}): Promise<{ outcome: AttendanceReconciliationOutcome; activityId: string | null }> {
  const payloadHash = await hashAttendanceReconciliationPayload({
    scope: params.scope,
    targetTotalAttendance: params.targetTotalAttendance,
    expectedCheckedInGuests: params.expectedCheckedInGuests,
    expectedWalkIns: params.expectedWalkIns,
    expectedSourceActivityCount: params.expectedSourceActivityCount,
    reason: params.reason,
    actorUserId: params.actorUserId,
  });
  const existingCloseout = await loadExistingCloseout(
    params.database,
    params.scope.venueId,
    params.idempotencyKey,
  );
  if (existingCloseout) {
    return existingCloseout.payloadHash === payloadHash
      ? { outcome: "replayed", activityId: existingCloseout.adjustmentActivityId }
      : { outcome: "conflict", activityId: null };
  }
  const existingActivity = await loadExisting(
    params.database,
    params.scope.venueId,
    params.idempotencyKey,
  );
  if (existingActivity) return { outcome: "conflict", activityId: null };
  if (await hasClosedAttendanceScope(params.database, params.scope)) {
    return { outcome: "scope_closed", activityId: null };
  }
  const closeoutId = crypto.randomUUID();
  const adjustmentActivityId = crypto.randomUUID();
  const reportHash = await hashAttendanceCloseoutReport({
    scope: params.scope,
    targetTotalAttendance: params.targetTotalAttendance,
    checkedInGuests: params.expectedCheckedInGuests,
    preAdjustmentWalkIns: params.expectedWalkIns,
    adjustmentDelta: params.targetTotalAttendance
      - params.expectedCheckedInGuests - params.expectedWalkIns,
    sourceActivityCount: params.expectedSourceActivityCount,
    reason: params.reason,
    actorUserId: params.actorUserId,
    finalizedAt: params.occurredAt,
  });
  const inserted = await params.database
    .prepare(INSERT_ATTENDANCE_CLOSEOUT_SQL)
    .bind(
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
      params.scope.eventId,
      params.scope.eventId,
      params.scope.venueId,
      params.scope.businessDate,
      params.compatibilityEventKey,
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
      params.targetTotalAttendance,
      closeoutId,
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
      params.targetTotalAttendance,
      adjustmentActivityId,
      params.reason,
      params.actorUserId,
      crypto.randomUUID(),
      params.idempotencyKey,
      payloadHash,
      reportHash,
      params.occurredAt,
      params.occurredAt,
      params.expectedCheckedInGuests,
      params.expectedWalkIns,
      params.expectedSourceActivityCount,
      params.targetTotalAttendance,
      params.scope.venueId,
      params.idempotencyKey,
      params.scope.eventId,
      params.scope.eventId,
      params.scope.venueId,
      params.scope.businessDate,
    )
    .first<{ id: string; adjustmentActivityId: string | null }>();
  if (inserted) {
    return { outcome: "applied", activityId: inserted.adjustmentActivityId };
  }
  const racedCloseout = await loadExistingCloseout(
    params.database,
    params.scope.venueId,
    params.idempotencyKey,
  );
  if (racedCloseout) {
    return racedCloseout.payloadHash === payloadHash
      ? { outcome: "replayed", activityId: racedCloseout.adjustmentActivityId }
      : { outcome: "conflict", activityId: null };
  }
  const racedActivity = await loadExisting(
    params.database,
    params.scope.venueId,
    params.idempotencyKey,
  );
  if (racedActivity) {
    return { outcome: "conflict", activityId: null };
  }
  if (await hasClosedAttendanceScope(params.database, params.scope)) {
    return { outcome: "scope_closed", activityId: null };
  }

  const current = await params.database
    .prepare(SELECT_ATTENDANCE_CLOSEOUT_COUNTS_SQL)
    .bind(
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
      params.scope.eventId,
      params.scope.eventId,
      params.scope.venueId,
      params.scope.businessDate,
      params.compatibilityEventKey,
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
    )
    .first<{ checkedInGuests: number; walkIns: number; sourceActivityCount: number }>();
  const checkedInGuests = Number(current?.checkedInGuests ?? -1);
  const walkIns = Number(current?.walkIns ?? -1);
  const sourceActivityCount = Number(current?.sourceActivityCount ?? -1);
  if (
    checkedInGuests !== params.expectedCheckedInGuests ||
    walkIns !== params.expectedWalkIns ||
    sourceActivityCount !== params.expectedSourceActivityCount
  ) {
    return { outcome: "stale", activityId: null };
  }
  return { outcome: "rejected", activityId: null };
}
