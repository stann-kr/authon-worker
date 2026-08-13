import type { D1Database } from "@cloudflare/workers-types";

export type GuestActivityAction =
  | "check_in"
  | "cancel_check_in"
  | "re_entry";

export type GuestActivityChannel = "admin" | "door";

export type GuestActivityMutationResult =
  | {
      outcome: "applied" | "replayed";
      guestId: string;
      status: "pending" | "checked";
      checkInTime: string | null;
      activityId: string;
    }
  | {
      outcome: "conflict" | "rejected" | "unavailable";
      guestId: string | null;
      status: null;
      checkInTime: null;
      activityId: string | null;
    };

interface GuestActivityRequestRow {
  payloadHash: string;
  activityId: string;
  guestId: string;
  action: string;
  outcome: string;
  resultStatus: string | null;
}

interface GuestActivityLedgerRow {
  previousStatus: string | null;
  nextStatus: string | null;
  occurredAt: string;
}

function isBoundedKey(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isActivityAction(value: unknown): value is GuestActivityAction {
  return (
    value === "check_in" ||
    value === "cancel_check_in" ||
    value === "re_entry"
  );
}

function isChannel(value: unknown): value is GuestActivityChannel {
  return value === "admin" || value === "door";
}

export async function hashOpaqueIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashGuestActivityPayload(params: {
  venueId: string;
  eventId: string | null;
  guestId: string;
  action: GuestActivityAction;
  actorUserId: string;
  channel: GuestActivityChannel;
}): Promise<string> {
  return hashOpaqueIdentifier(JSON.stringify([
    params.venueId,
    params.eventId,
    params.guestId,
    params.action,
    params.actorUserId,
    params.channel,
  ]));
}

export const CLAIM_GUEST_ACTIVITY_REQUEST_SQL = `
  INSERT INTO guest_activity_requests (
    venue_id, idempotency_key, payload_hash, activity_id,
    guest_id, action, outcome, created_at
  )
  SELECT ?, ?, ?, ?, ?, ?, 'claimed', ?
  WHERE EXISTS (
    SELECT 1 FROM venues WHERE id = ? AND active = 1
  )
  ON CONFLICT DO NOTHING
  RETURNING activity_id AS activityId
`;

export const APPLY_GUEST_ACTIVITY_STATUS_SQL = `
  UPDATE guests
  SET status = ?, check_in_time = ?, updated_at = ?,
    event_id = coalesce(event_id, ?)
  WHERE id = ?
    AND venue_id = ?
    AND status = ?
    AND (event_id = ? OR (? = 1 AND event_id IS NULL AND date = ?))
    AND EXISTS (
      SELECT 1 FROM events
      WHERE events.id = ?
        AND events.venue_id = guests.venue_id
        AND events.business_date = guests.date
        AND events.state = 'open'
    )
    AND EXISTS (
      SELECT 1 FROM guest_activity_requests request
      WHERE request.venue_id = ?
        AND request.idempotency_key = ?
        AND request.payload_hash = ?
        AND request.activity_id = ?
        AND request.outcome = 'claimed'
    )
  RETURNING id, event_id AS eventId, status,
    check_in_time AS checkInTime
`;

export const INSERT_APPLIED_GUEST_ACTIVITY_SQL = `
  INSERT INTO guest_activity_ledger (
    id, venue_id, event_id, guest_id, action,
    actor_user_id, actor_type, channel,
    request_id, idempotency_key, payload_hash,
    outcome, previous_status, next_status,
    device_key_hash, session_key_hash, occurred_at
  )
  SELECT ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?,
    'applied', ?, ?, ?, ?, ?
  WHERE changes() = 1
  RETURNING id
`;

export const COMPLETE_GUEST_ACTIVITY_REQUEST_SQL = `
  UPDATE guest_activity_requests
  SET outcome = 'applied', result_status = ?, completed_at = ?
  WHERE venue_id = ?
    AND idempotency_key = ?
    AND payload_hash = ?
    AND activity_id = ?
    AND outcome = 'claimed'
    AND EXISTS (
      SELECT 1 FROM guest_activity_ledger
      WHERE id = ? AND outcome = 'applied'
    )
  RETURNING activity_id AS activityId
`;

export const INSERT_REJECTED_GUEST_ACTIVITY_SQL = `
  INSERT INTO guest_activity_ledger (
    id, venue_id, event_id, guest_id, action,
    actor_user_id, actor_type, channel,
    request_id, idempotency_key, payload_hash,
    outcome, previous_status, next_status,
    device_key_hash, session_key_hash, occurred_at
  )
  SELECT ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?,
    'rejected', guest.status, guest.status, ?, ?, ?
  FROM guest_activity_requests request
  LEFT JOIN guests guest
    ON guest.id = request.guest_id AND guest.venue_id = request.venue_id
  WHERE request.venue_id = ?
    AND request.idempotency_key = ?
    AND request.payload_hash = ?
    AND request.activity_id = ?
    AND request.outcome = 'claimed'
    AND NOT EXISTS (
      SELECT 1 FROM guest_activity_ledger WHERE id = ?
    )
  RETURNING id
`;

export const REJECT_GUEST_ACTIVITY_REQUEST_SQL = `
  UPDATE guest_activity_requests
  SET outcome = 'rejected', completed_at = ?
  WHERE venue_id = ?
    AND idempotency_key = ?
    AND payload_hash = ?
    AND activity_id = ?
    AND outcome = 'claimed'
    AND EXISTS (
      SELECT 1 FROM guest_activity_ledger
      WHERE id = ? AND outcome = 'rejected'
    )
  RETURNING activity_id AS activityId
`;

export const SELECT_GUEST_ACTIVITY_REQUEST_SQL = `
  SELECT payload_hash AS payloadHash, activity_id AS activityId,
    guest_id AS guestId, action, outcome, result_status AS resultStatus
  FROM guest_activity_requests
  WHERE venue_id = ? AND idempotency_key = ?
  LIMIT 1
`;

export const SELECT_GUEST_ACTIVITY_LEDGER_SQL = `
  SELECT previous_status AS previousStatus, next_status AS nextStatus,
    occurred_at AS occurredAt
  FROM guest_activity_ledger
  WHERE id = ? AND venue_id = ?
  LIMIT 1
`;

export const INSERT_CONFLICT_GUEST_ACTIVITY_SQL = `
  INSERT INTO guest_activity_ledger (
    id, venue_id, event_id, guest_id, action,
    actor_user_id, actor_type, channel,
    request_id, idempotency_key, payload_hash,
    outcome, previous_status, next_status,
    device_key_hash, session_key_hash, occurred_at
  )
  SELECT ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?,
    'conflict', guest.status, guest.status, ?, ?, ?
  FROM guests guest
  WHERE guest.id = ? AND guest.venue_id = ?
    AND EXISTS (
      SELECT 1 FROM venues WHERE id = ? AND active = 1
    )
  RETURNING id
`;

export const INSERT_GUEST_ACTIVITY_AFTER_CHANGE_SQL = `
  INSERT INTO guest_activity_ledger (
    id, venue_id, event_id, guest_id, action,
    actor_user_id, actor_type, channel,
    request_id, idempotency_key, payload_hash,
    outcome, previous_status, next_status,
    device_key_hash, session_key_hash, occurred_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
    'applied', ?, ?, ?, ?, ?
  WHERE changes() = 1
  RETURNING id
`;

export function prepareGuestActivityAfterChange(
  db: D1Database,
  params: {
    activityId: string;
    venueId: string;
    eventId: string | null;
    guestId: string;
    action: "add" | "update" | "delete" | "restore" | "permanent_delete";
    actorUserId: string | null;
    actorType: "user" | "external_link" | "terminal" | "system";
    channel: "admin" | "door" | "guest" | "external_link" | "terminal" | "system";
    requestId: string;
    idempotencyKey?: string | null;
    previousStatus: string | null;
    nextStatus: string | null;
    deviceKeyHash?: string | null;
    sessionKeyHash?: string | null;
    occurredAt: string;
  },
) {
  return db.prepare(INSERT_GUEST_ACTIVITY_AFTER_CHANGE_SQL).bind(
    params.activityId,
    params.venueId,
    params.eventId,
    params.guestId,
    params.action,
    params.actorUserId,
    params.actorType,
    params.channel,
    params.requestId,
    params.idempotencyKey ?? null,
    params.previousStatus,
    params.nextStatus,
    params.deviceKeyHash ?? null,
    params.sessionKeyHash ?? null,
    params.occurredAt,
  );
}

export async function persistGuestStatusActivity(
  db: D1Database,
  params: {
    venueId: string;
    eventId: string | null;
    includeLegacyDateRows?: boolean;
    businessDate: string;
    guestId: string;
    action: GuestActivityAction;
    actorUserId: string;
    channel: GuestActivityChannel;
    idempotencyKey: string;
    occurredAt: string;
    deviceKeyHash?: string | null;
    sessionKeyHash?: string | null;
  },
): Promise<GuestActivityMutationResult> {
  if (
    !isBoundedKey(params.venueId, 128) ||
    !isBoundedKey(params.guestId, 128) ||
    !isBoundedKey(params.actorUserId, 128) ||
    !isBoundedKey(params.idempotencyKey, 128) ||
    !isActivityAction(params.action) ||
    !isChannel(params.channel) ||
    Number.isNaN(new Date(params.occurredAt).getTime())
  ) {
    return {
      outcome: "rejected",
      guestId: null,
      status: null,
      checkInTime: null,
      activityId: null,
    };
  }

  const payloadHash = await hashGuestActivityPayload(params);
  const activityId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const expectedStatus = params.action === "cancel_check_in" ? "checked" : "pending";
  const nextStatus = params.action === "cancel_check_in" ? "pending" : "checked";
  const checkInTime = nextStatus === "checked" ? params.occurredAt : null;

  const [claim, mutation, ledger, completion, rejection, rejectionCompletion] = await db.batch<{
    activityId?: string;
    id?: string;
    eventId?: string | null;
    status?: string;
    checkInTime?: string | null;
  }>([
    db.prepare(CLAIM_GUEST_ACTIVITY_REQUEST_SQL).bind(
      params.venueId,
      params.idempotencyKey,
      payloadHash,
      activityId,
      params.guestId,
      params.action,
      params.occurredAt,
      params.venueId,
    ),
    db.prepare(APPLY_GUEST_ACTIVITY_STATUS_SQL).bind(
      nextStatus,
      checkInTime,
      params.occurredAt,
      params.eventId,
      params.guestId,
      params.venueId,
      expectedStatus,
      params.eventId,
      params.includeLegacyDateRows ? 1 : 0,
      params.businessDate,
      params.eventId,
      params.venueId,
      params.idempotencyKey,
      payloadHash,
      activityId,
    ),
    db.prepare(INSERT_APPLIED_GUEST_ACTIVITY_SQL).bind(
      activityId,
      params.venueId,
      params.eventId,
      params.guestId,
      params.action,
      params.actorUserId,
      params.channel,
      requestId,
      params.idempotencyKey,
      payloadHash,
      expectedStatus,
      nextStatus,
      params.deviceKeyHash ?? null,
      params.sessionKeyHash ?? null,
      params.occurredAt,
    ),
    db.prepare(COMPLETE_GUEST_ACTIVITY_REQUEST_SQL).bind(
      nextStatus,
      params.occurredAt,
      params.venueId,
      params.idempotencyKey,
      payloadHash,
      activityId,
      activityId,
    ),
    db.prepare(INSERT_REJECTED_GUEST_ACTIVITY_SQL).bind(
      activityId,
      params.venueId,
      params.eventId,
      params.guestId,
      params.action,
      params.actorUserId,
      params.channel,
      requestId,
      params.idempotencyKey,
      payloadHash,
      params.deviceKeyHash ?? null,
      params.sessionKeyHash ?? null,
      params.occurredAt,
      params.venueId,
      params.idempotencyKey,
      payloadHash,
      activityId,
      activityId,
    ),
    db.prepare(REJECT_GUEST_ACTIVITY_REQUEST_SQL).bind(
      params.occurredAt,
      params.venueId,
      params.idempotencyKey,
      payloadHash,
      activityId,
      activityId,
    ),
  ]);

  const claimed = claim.results?.[0]?.activityId === activityId;
  const changed = mutation.results?.[0]?.id === params.guestId;
  const recorded = ledger.results?.[0]?.id === activityId;
  const completed = completion.results?.[0]?.activityId === activityId;
  if (claimed && changed && recorded && completed) {
    return {
      outcome: "applied",
      guestId: params.guestId,
      status: nextStatus,
      checkInTime,
      activityId,
    };
  }


  if (claimed && !changed && !recorded && !completed) {
    if (
      rejection.results?.[0]?.id === activityId &&
      rejectionCompletion.results?.[0]?.activityId === activityId
    ) {
      return {
        outcome: "rejected",
        guestId: null,
        status: null,
        checkInTime: null,
        activityId,
      };
    }
  }

  const existing = await db
    .prepare(SELECT_GUEST_ACTIVITY_REQUEST_SQL)
    .bind(params.venueId, params.idempotencyKey)
    .first<GuestActivityRequestRow>();
  if (!existing) {
    return {
      outcome: "unavailable",
      guestId: null,
      status: null,
      checkInTime: null,
      activityId: null,
    };
  }
  if (
    existing.payloadHash !== payloadHash ||
    existing.guestId !== params.guestId ||
    existing.action !== params.action
  ) {
    const conflictActivityId = crypto.randomUUID();
    const [conflict] = await db.batch<{ id?: string }>([
      db.prepare(INSERT_CONFLICT_GUEST_ACTIVITY_SQL).bind(
        conflictActivityId,
        params.venueId,
        params.eventId,
        params.guestId,
        params.action,
        params.actorUserId,
        params.channel,
        crypto.randomUUID(),
        params.idempotencyKey,
        payloadHash,
        params.deviceKeyHash ?? null,
        params.sessionKeyHash ?? null,
        params.occurredAt,
        params.guestId,
        params.venueId,
        params.venueId,
      ),
    ]);
    if (conflict.results?.[0]?.id !== conflictActivityId) {
      return {
        outcome: "unavailable",
        guestId: null,
        status: null,
        checkInTime: null,
        activityId: null,
      };
    }
    return {
      outcome: "conflict",
      guestId: null,
      status: null,
      checkInTime: null,
      activityId: conflictActivityId,
    };
  }
  if (existing.outcome !== "applied" || !existing.resultStatus) {
    return {
      outcome: "rejected",
      guestId: null,
      status: null,
      checkInTime: null,
      activityId: existing.activityId,
    };
  }
  const event = await db
    .prepare(SELECT_GUEST_ACTIVITY_LEDGER_SQL)
    .bind(existing.activityId, params.venueId)
    .first<GuestActivityLedgerRow>();
  if (!event || event.nextStatus !== existing.resultStatus) {
    return {
      outcome: "unavailable",
      guestId: null,
      status: null,
      checkInTime: null,
      activityId: existing.activityId,
    };
  }
  return {
    outcome: "replayed",
    guestId: existing.guestId,
    status: existing.resultStatus as "pending" | "checked",
    checkInTime: existing.resultStatus === "checked" ? event.occurredAt : null,
    activityId: existing.activityId,
  };
}
