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
  | "rejected";

interface ExistingAttendanceActivity {
  id: string;
  payloadHash: string;
}

const SELECT_EXISTING_ATTENDANCE_SQL = `
  SELECT id, payload_hash AS payloadHash
  FROM attendance_activity_ledger
  WHERE venue_id = ? AND idempotency_key = ?
  LIMIT 1
`;

export const INSERT_WALK_IN_ATTENDANCE_SQL = `
  INSERT INTO attendance_activity_ledger (
    id, venue_id, business_date, event_id, action, delta,
    reverses_activity_id, adjustment_reason, actor_user_id, channel,
    request_id, idempotency_key, payload_hash, device_key_hash,
    device_sequence, occurred_at, created_at
  ) VALUES (?, ?, ?, ?, 'walk_in', 1, NULL, NULL, ?, 'door', ?, ?, ?, ?, ?, ?, ?)
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
      SELECT 1 FROM attendance_activity_ledger reversal
      WHERE reversal.reverses_activity_id = original.id
    )
  ON CONFLICT DO NOTHING
  RETURNING id
`;

export const INSERT_ATTENDANCE_ADJUSTMENT_SQL = `
  INSERT INTO attendance_activity_ledger (
    id, venue_id, business_date, event_id, action, delta,
    reverses_activity_id, adjustment_reason, actor_user_id, channel,
    request_id, idempotency_key, payload_hash, device_key_hash,
    device_sequence, occurred_at, created_at
  )
  SELECT ?, ?, ?, ?, 'manual_adjustment', ?, NULL, ?, ?, 'admin',
    ?, ?, ?, NULL, NULL, ?, ?
  WHERE (
    SELECT coalesce(sum(delta), 0) + ?
    FROM attendance_activity_ledger
    WHERE venue_id = ? AND business_date = ? AND event_id IS ?
  ) >= 0
  ON CONFLICT DO NOTHING
  RETURNING id
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
  action: DoorAttendanceAction | "manual_adjustment";
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
    params.action === "manual_adjustment"
      ? null
      : params.deviceSequence ?? null,
    params.action === "manual_adjustment" ? null : params.occurredAt,
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
        )
        .first<{ id: string }>();
  return resolveInsertOutcome({
    database: params.database,
    venueId: params.scope.venueId,
    idempotencyKey: params.idempotencyKey,
    payloadHash,
    insertedId: inserted?.id ?? null,
  });
}

export async function persistAttendanceAdjustment(params: {
  database: D1Database;
  scope: AttendanceScope;
  actorUserId: string;
  idempotencyKey: string;
  delta: number;
  reason: string;
  occurredAt: string;
}): Promise<{ outcome: AttendancePersistenceOutcome; activityId: string | null }> {
  const payloadHash = await hashAttendancePayload({
    scope: params.scope,
    action: "manual_adjustment",
    delta: params.delta,
    reason: params.reason,
    actorUserId: params.actorUserId,
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
  const activityId = crypto.randomUUID();
  const inserted = await params.database
    .prepare(INSERT_ATTENDANCE_ADJUSTMENT_SQL)
    .bind(
      activityId,
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
      params.delta,
      params.reason,
      params.actorUserId,
      crypto.randomUUID(),
      params.idempotencyKey,
      payloadHash,
      params.occurredAt,
      params.occurredAt,
      params.delta,
      params.scope.venueId,
      params.scope.businessDate,
      params.scope.eventId,
    )
    .first<{ id: string }>();
  return resolveInsertOutcome({
    database: params.database,
    venueId: params.scope.venueId,
    idempotencyKey: params.idempotencyKey,
    payloadHash,
    insertedId: inserted?.id ?? null,
  });
}
