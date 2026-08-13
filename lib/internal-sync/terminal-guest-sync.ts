import type { D1Database } from "@cloudflare/workers-types";

export interface TerminalGuestSyncPayload {
  name: string;
  email: string | null;
  instagram: string | null;
  terminalRequestId: string;
  date: string;
  createdAt: string | null;
}

export type TerminalGuestSyncPersistenceResult =
  | { outcome: "created"; guestId: string }
  | { outcome: "replayed"; guestId: string }
  | { outcome: "conflict"; guestId: null }
  | { outcome: "unavailable"; guestId: null };

export type TerminalGuestSyncHttpResult =
  | { status: 200; body: { ok: true; guestId: string } }
  | { status: 400 | 409 | 503; body: { ok: false; error: string } };

function isShortText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

export function parseTerminalGuestSyncPayload(value: unknown): TerminalGuestSyncPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;

  if (
    !isShortText(data.name, 100) ||
    !isShortText(data.terminalRequestId, 128) ||
    !isIsoDate(data.date) ||
    (data.email !== undefined && data.email !== null && !isShortText(data.email, 254)) ||
    (data.instagram !== undefined && data.instagram !== null && !isShortText(data.instagram, 100)) ||
    (data.createdAt !== undefined && data.createdAt !== null && !isIsoTimestamp(data.createdAt))
  ) {
    return null;
  }

  return {
    name: data.name.trim(),
    email: typeof data.email === "string" ? data.email.trim() : null,
    instagram: typeof data.instagram === "string" ? data.instagram.trim() : null,
    terminalRequestId: data.terminalRequestId.trim(),
    date: data.date,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : null,
  };
}

export async function hashTerminalGuestSyncPayload(
  payload: TerminalGuestSyncPayload,
): Promise<string> {
  const canonicalPayload = JSON.stringify([
    payload.name,
    payload.email,
    payload.instagram,
    payload.date,
    payload.createdAt,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPayload),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const CLAIM_TERMINAL_GUEST_SYNC_REQUEST_SQL = `
  INSERT INTO terminal_guest_sync_requests (
    venue_id, request_id, payload_hash, guest_id, created_at
  )
  SELECT ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM venues
    WHERE id = ? AND active = 1
  )
  AND EXISTS (
    SELECT 1 FROM events
    WHERE compatibility_key = ?
      AND venue_id = ?
      AND state IN ('draft', 'open')
  )
  ON CONFLICT DO NOTHING
  RETURNING guest_id AS guestId
`;

export const ENSURE_TERMINAL_COMPATIBILITY_EVENT_SQL = `
  INSERT INTO events (
    id, venue_id, business_date, name, state, compatibility_key,
    created_at, updated_at
  )
  SELECT ?, ?, ?, ?, 'open', ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM venues WHERE id = ? AND active = 1
  )
  ON CONFLICT DO NOTHING
  RETURNING id
`;

export const INSERT_CLAIMED_TERMINAL_GUEST_SQL = `
  INSERT INTO guests (
    id, venue_id, name, email, instagram, terminal_request_id,
    event_id, source, status, date, created_at, updated_at
  )
  SELECT sync.guest_id, sync.venue_id, ?, ?, ?, sync.request_id,
         event.id, 'terminal', 'pending', ?, ?, ?
  FROM terminal_guest_sync_requests sync
  JOIN events event
    ON event.compatibility_key = ?
   AND event.venue_id = sync.venue_id
   AND event.business_date = ?
   AND event.state IN ('draft', 'open')
  WHERE sync.venue_id = ?
    AND sync.request_id = ?
    AND sync.payload_hash = ?
    AND sync.guest_id = ?
    AND NOT EXISTS (
      SELECT 1 FROM guests existing_guest
      WHERE existing_guest.id = sync.guest_id
    )
  RETURNING id
`;

export const INSERT_TERMINAL_GUEST_ACTIVITY_SQL = `
  INSERT INTO guest_activity_ledger (
    id, venue_id, event_id, guest_id, action,
    actor_user_id, actor_type, channel,
    request_id, idempotency_key, payload_hash,
    outcome, previous_status, next_status, occurred_at
  )
  SELECT ?, guest.venue_id, guest.event_id, guest.id, 'add',
    NULL, 'terminal', 'terminal', ?, ?, NULL,
    'applied', NULL, 'pending', ?
  FROM guests guest
  WHERE changes() = 1
    AND guest.id = ?
    AND guest.venue_id = ?
  RETURNING id
`;

export const SELECT_TERMINAL_GUEST_SYNC_RESULT_SQL = `
  SELECT sync.payload_hash AS payloadHash, sync.guest_id AS guestId
  FROM terminal_guest_sync_requests sync
  JOIN guests guest ON guest.id = sync.guest_id
  WHERE sync.venue_id = ?
    AND sync.request_id = ?
  LIMIT 1
`;

interface TerminalGuestSyncRow {
  guestId?: string;
  id?: string;
  payloadHash?: string;
}

export async function persistTerminalGuestSync(
  db: D1Database,
  params: {
    venueId: string;
    payload: TerminalGuestSyncPayload;
    receivedAt: string;
  },
): Promise<TerminalGuestSyncPersistenceResult> {
  const payloadHash = await hashTerminalGuestSyncPayload(params.payload);
  const proposedGuestId = crypto.randomUUID();
  const proposedEventId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const guestCreatedAt = params.payload.createdAt ?? params.receivedAt;
  const compatibilityKey = `legacy:${params.venueId}:${params.payload.date}`;

  const [, claimResult, guestResult, activityResult] = await db.batch<TerminalGuestSyncRow>([
    db.prepare(ENSURE_TERMINAL_COMPATIBILITY_EVENT_SQL).bind(
      proposedEventId,
      params.venueId,
      params.payload.date,
      params.payload.date,
      compatibilityKey,
      params.receivedAt,
      params.receivedAt,
      params.venueId,
    ),
    db.prepare(CLAIM_TERMINAL_GUEST_SYNC_REQUEST_SQL).bind(
      params.venueId,
      params.payload.terminalRequestId,
      payloadHash,
      proposedGuestId,
      params.receivedAt,
      params.venueId,
      compatibilityKey,
      params.venueId,
    ),
    db.prepare(INSERT_CLAIMED_TERMINAL_GUEST_SQL).bind(
      params.payload.name,
      params.payload.email,
      params.payload.instagram,
      params.payload.date,
      guestCreatedAt,
      guestCreatedAt,
      compatibilityKey,
      params.payload.date,
      params.venueId,
      params.payload.terminalRequestId,
      payloadHash,
      proposedGuestId,
    ),
    db.prepare(INSERT_TERMINAL_GUEST_ACTIVITY_SQL).bind(
      activityId,
      `terminal:${params.payload.terminalRequestId}`,
      params.payload.terminalRequestId,
      params.receivedAt,
      proposedGuestId,
      params.venueId,
    ),
  ]);

  const claimedGuestId = claimResult.results?.[0]?.guestId;
  const insertedGuestId = guestResult.results?.[0]?.id;
  const insertedActivityId = activityResult.results?.[0]?.id;
  if (
    claimedGuestId === proposedGuestId &&
    insertedGuestId === proposedGuestId &&
    insertedActivityId === activityId
  ) {
    return { outcome: "created", guestId: proposedGuestId };
  }

  const existing = await db
    .prepare(SELECT_TERMINAL_GUEST_SYNC_RESULT_SQL)
    .bind(params.venueId, params.payload.terminalRequestId)
    .first<{ payloadHash: string; guestId: string }>();

  if (!existing) return { outcome: "unavailable", guestId: null };
  if (existing.payloadHash !== payloadHash) {
    return { outcome: "conflict", guestId: null };
  }
  return { outcome: "replayed", guestId: existing.guestId };
}

export async function handleTerminalGuestSyncPayload(
  db: D1Database,
  params: {
    venueId: string;
    rawPayload: unknown;
    receivedAt: string;
  },
): Promise<TerminalGuestSyncHttpResult> {
  const payload = parseTerminalGuestSyncPayload(params.rawPayload);
  if (!payload) {
    return {
      status: 400,
      body: { ok: false, error: "Invalid request payload" },
    };
  }

  const result = await persistTerminalGuestSync(db, {
    venueId: params.venueId,
    payload,
    receivedAt: params.receivedAt,
  });

  if (result.outcome === "conflict") {
    return {
      status: 409,
      body: { ok: false, error: "Idempotency key already used with a different payload" },
    };
  }
  if (result.outcome === "unavailable") {
    return {
      status: 503,
      body: { ok: false, error: "Endpoint not available" },
    };
  }
  return { status: 200, body: { ok: true, guestId: result.guestId } };
}
