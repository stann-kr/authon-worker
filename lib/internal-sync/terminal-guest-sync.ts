import type { D1Database } from "@cloudflare/workers-types";
import {
  getContributorNameKey,
  normalizeContributorDisplayName,
} from "../contributors/domain.ts";
import {
  getExternalDjContributorId,
  getExternalDjCreatedAuditId,
  getExternalDjMappedAuditId,
} from "../contributors/external-dj.ts";

export interface TerminalGuestSyncPayload {
  name: string;
  email: string | null;
  instagram: string | null;
  terminalRequestId: string;
  date: string;
  createdAt: string | null;
  /** Terminal artist who invited the guest; routes the guest to that artist's external link. */
  artistName: string | null;
  /** Terminal's own guest limit for the artist; only raises the link's displayed capacity. */
  guestLimit: number | null;
}

const MAX_TERMINAL_GUEST_LIMIT = 1000;

export type TerminalGuestSyncPersistenceResult =
  | { outcome: "created"; guestId: string }
  | { outcome: "replayed"; guestId: string }
  | { outcome: "conflict"; guestId: null }
  | { outcome: "unavailable"; guestId: null }
  | { outcome: "event_not_ready"; guestId: null }
  | { outcome: "event_ambiguous"; guestId: null };

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
    (data.createdAt !== undefined && data.createdAt !== null && !isIsoTimestamp(data.createdAt)) ||
    (data.artistName !== undefined && data.artistName !== null &&
      !getContributorNameKey(data.artistName)) ||
    (data.guestLimit !== undefined && data.guestLimit !== null &&
      (!Number.isInteger(data.guestLimit) ||
        (data.guestLimit as number) < 1 ||
        (data.guestLimit as number) > MAX_TERMINAL_GUEST_LIMIT))
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
    artistName:
      typeof data.artistName === "string"
        ? normalizeContributorDisplayName(data.artistName)
        : null,
    guestLimit: typeof data.guestLimit === "number" ? data.guestLimit : null,
  };
}

export async function hashTerminalGuestSyncPayload(
  payload: TerminalGuestSyncPayload,
): Promise<string> {
  // The guest limit is left out: it may change between a first send and a resend of the same request.
  // A payload without an artist keeps the original hash, so earlier claims still replay.
  const canonicalFields: unknown[] = [
    payload.name,
    payload.email,
    payload.instagram,
    payload.date,
    payload.createdAt,
  ];
  if (payload.artistName) canonicalFields.push(getContributorNameKey(payload.artistName));
  const canonicalPayload = JSON.stringify(canonicalFields);
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

// ─── Artist-linked sync ─────────────────────────────────────────────────────
// A payload naming a terminal artist lands on the venue's own event for that business date, under
// a contributor-kind external link the sync keeps for (event, artist). Links are found by a
// deterministic id, so concurrent first guests of one artist share a single link.

const TERMINAL_LINK_ID_NAMESPACE = "authon:terminal-artist-link:v1";

export const SELECT_TERMINAL_TARGET_EVENTS_SQL = `
  SELECT event.id, event.name, event.business_date AS businessDate
  FROM events event
  JOIN venues venue ON venue.id = event.venue_id AND venue.active = 1
  WHERE event.venue_id = ?
    AND event.business_date = ?
    AND event.compatibility_key IS NULL
    AND event.state IN ('draft', 'open')
  ORDER BY event.created_at, event.id
  LIMIT 2
`;

export const SELECT_TERMINAL_CONTRIBUTOR_SQL = `
  SELECT id, display_name AS displayName, active
  FROM venue_contributors
  WHERE venue_id = ? AND name_key = ?
  LIMIT 1
`;

export const INSERT_TERMINAL_CONTRIBUTOR_SQL = `
  INSERT INTO venue_contributors (
    id, venue_id, display_name, name_key, kind, active, created_at, updated_at
  )
  SELECT ?, ?, ?, ?, 'dj', 1, ?, ?
  WHERE EXISTS (SELECT 1 FROM venues WHERE id = ? AND active = 1)
  ON CONFLICT DO NOTHING
`;

export const INSERT_TERMINAL_CONTRIBUTOR_CREATED_AUDIT_SQL = `
  INSERT INTO contributor_audit_events (
    id, venue_id, contributor_id, actor_user_id, source_kind, source_id,
    action, details, created_at
  )
  SELECT ?, ?, ?, NULL, 'contributor', ?, 'created', ?, ?
  WHERE EXISTS (
    SELECT 1 FROM venue_contributors
    WHERE id = ? AND venue_id = ? AND created_at = ?
  )
  ON CONFLICT DO NOTHING
`;

export const INSERT_TERMINAL_LINK_SQL = `
  INSERT INTO external_dj_links (
    id, venue_id, token, dj_name, contributor_id, event, date, event_id,
    max_guests, used_guests, active, expires_at, created_by, locale_mode,
    kind, created_at
  )
  SELECT ?, contributor.venue_id, ?, contributor.display_name, contributor.id,
         event.name, event.business_date, event.id,
         ?, 0, 1, ?, NULL, 'auto', 'contributor', ?
  FROM venue_contributors contributor
  JOIN events event
    ON event.id = ?
   AND event.venue_id = contributor.venue_id
   AND event.state IN ('draft', 'open')
  WHERE contributor.id = ?
    AND contributor.venue_id = ?
    AND contributor.active = 1
  ON CONFLICT DO NOTHING
`;

export const INSERT_TERMINAL_LINK_MAPPED_AUDIT_SQL = `
  INSERT INTO contributor_audit_events (
    id, venue_id, contributor_id, actor_user_id, source_kind, source_id,
    action, details, created_at
  )
  SELECT ?, link.venue_id, link.contributor_id, NULL, 'external_link', link.id,
         'mapped', ?, ?
  FROM external_dj_links link
  WHERE link.id = ? AND link.venue_id = ? AND link.contributor_id = ?
  ON CONFLICT DO NOTHING
`;

export const CLAIM_TERMINAL_EVENT_GUEST_SYNC_REQUEST_SQL = `
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
    WHERE id = ?
      AND venue_id = ?
      AND business_date = ?
      AND state IN ('draft', 'open')
  )
  ON CONFLICT DO NOTHING
  RETURNING guest_id AS guestId
`;

// The link is re-read inside the write: a link deleted or turned off since the lookup leaves the
// guest on the event without one, rather than failing the guest.
export const INSERT_CLAIMED_TERMINAL_EVENT_GUEST_SQL = `
  INSERT INTO guests (
    id, venue_id, name, email, instagram, terminal_request_id,
    external_link_id, event_id, source, status, date, created_at, updated_at
  )
  SELECT sync.guest_id, sync.venue_id, ?, ?, ?, sync.request_id,
         (
           SELECT link.id FROM external_dj_links link
           WHERE link.id = ?
             AND link.venue_id = sync.venue_id
             AND link.event_id = event.id
             AND link.kind = 'contributor'
             AND link.active = 1
             AND link.deleted_at IS NULL
         ),
         event.id, 'terminal', 'pending', ?, ?, ?
  FROM terminal_guest_sync_requests sync
  JOIN events event
    ON event.id = ?
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
  RETURNING id, external_link_id AS externalLinkId
`;

// Terminal holds the guest limit, so the link never refuses a synced guest: its capacity only
// grows to cover what was counted, and to terminal's limit when that is higher.
export const COUNT_TERMINAL_LINK_GUEST_SQL = `
  UPDATE external_dj_links
  SET used_guests = used_guests + 1,
      max_guests = MAX(max_guests, used_guests + 1, ?)
  WHERE id = ?
    AND EXISTS (
      SELECT 1 FROM guest_activity_ledger WHERE id = ?
    )
    AND EXISTS (
      SELECT 1 FROM guests
      WHERE id = ? AND external_link_id = external_dj_links.id
    )
  RETURNING id
`;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getTerminalArtistLinkId(
  venueId: string,
  eventId: string,
  contributorId: string,
): Promise<string> {
  const hex = await sha256Hex(
    `${TERMINAL_LINK_ID_NAMESPACE}\u0000${venueId}\u0000${eventId}\u0000${contributorId}`,
  );
  return `tl_${hex}`;
}

function linkExpiresAt(businessDate: string, receivedAt: string): string {
  const eventDay = new Date(`${businessDate}T23:59:59.999Z`);
  if (Number.isNaN(eventDay.getTime())) return receivedAt;
  eventDay.setUTCDate(eventDay.getUTCDate() + 1);
  return eventDay.toISOString();
}

interface TerminalTargetEvent {
  id: string;
  name: string;
  businessDate: string;
}

async function ensureTerminalContributor(
  db: D1Database,
  params: { venueId: string; artistName: string; nameKey: string; receivedAt: string },
): Promise<{ id: string; active: boolean } | null> {
  const select = () =>
    db
      .prepare(SELECT_TERMINAL_CONTRIBUTOR_SQL)
      .bind(params.venueId, params.nameKey)
      .first<{ id: string; active: number | boolean }>();
  let contributor = await select();
  if (!contributor) {
    const contributorId = await getExternalDjContributorId(params.venueId, params.nameKey);
    await db.batch([
      db.prepare(INSERT_TERMINAL_CONTRIBUTOR_SQL).bind(
        contributorId,
        params.venueId,
        params.artistName,
        params.nameKey,
        params.receivedAt,
        params.receivedAt,
        params.venueId,
      ),
      db.prepare(INSERT_TERMINAL_CONTRIBUTOR_CREATED_AUDIT_SQL).bind(
        getExternalDjCreatedAuditId(contributorId),
        params.venueId,
        contributorId,
        contributorId,
        JSON.stringify({ kind: "dj", source: "terminal_sync" }),
        params.receivedAt,
        contributorId,
        params.venueId,
        params.receivedAt,
      ),
    ]);
    contributor = await select();
  }
  if (!contributor) return null;
  return { id: contributor.id, active: Boolean(contributor.active) };
}

async function ensureTerminalArtistLink(
  db: D1Database,
  params: {
    venueId: string;
    event: TerminalTargetEvent;
    contributorId: string;
    guestLimit: number | null;
    receivedAt: string;
  },
): Promise<string> {
  const linkId = await getTerminalArtistLinkId(
    params.venueId,
    params.event.id,
    params.contributorId,
  );
  await db.batch([
    db.prepare(INSERT_TERMINAL_LINK_SQL).bind(
      linkId,
      crypto.randomUUID(),
      params.guestLimit ?? 1,
      linkExpiresAt(params.event.businessDate, params.receivedAt),
      params.receivedAt,
      params.event.id,
      params.contributorId,
      params.venueId,
    ),
    db.prepare(INSERT_TERMINAL_LINK_MAPPED_AUDIT_SQL).bind(
      await getExternalDjMappedAuditId(params.contributorId, linkId),
      JSON.stringify({ reason: "terminal_sync" }),
      params.receivedAt,
      linkId,
      params.venueId,
      params.contributorId,
    ),
  ]);
  return linkId;
}

async function readTerminalSyncReplay(
  db: D1Database,
  venueId: string,
  requestId: string,
  payloadHash: string,
): Promise<TerminalGuestSyncPersistenceResult | null> {
  const existing = await db
    .prepare(SELECT_TERMINAL_GUEST_SYNC_RESULT_SQL)
    .bind(venueId, requestId)
    .first<{ payloadHash: string; guestId: string }>();
  if (!existing) return null;
  if (existing.payloadHash !== payloadHash) return { outcome: "conflict", guestId: null };
  return { outcome: "replayed", guestId: existing.guestId };
}

async function persistTerminalArtistGuestSync(
  db: D1Database,
  params: {
    venueId: string;
    payload: TerminalGuestSyncPayload & { artistName: string };
    receivedAt: string;
  },
): Promise<TerminalGuestSyncPersistenceResult> {
  const { venueId, payload, receivedAt } = params;
  const payloadHash = await hashTerminalGuestSyncPayload(payload);
  const replay = await readTerminalSyncReplay(db, venueId, payload.terminalRequestId, payloadHash);
  if (replay) return replay;

  const events = await db
    .prepare(SELECT_TERMINAL_TARGET_EVENTS_SQL)
    .bind(venueId, payload.date)
    .all<TerminalTargetEvent>();
  const candidates = events.results ?? [];
  if (candidates.length === 0) return { outcome: "event_not_ready", guestId: null };
  if (candidates.length > 1) return { outcome: "event_ambiguous", guestId: null };
  const event = candidates[0];

  const nameKey = getContributorNameKey(payload.artistName);
  const contributor = nameKey
    ? await ensureTerminalContributor(db, {
        venueId,
        artistName: payload.artistName,
        nameKey,
        receivedAt,
      })
    : null;
  // An artist the venue turned off keeps the guest on the event without a link.
  const linkId = contributor?.active
    ? await ensureTerminalArtistLink(db, {
        venueId,
        event,
        contributorId: contributor.id,
        guestLimit: payload.guestLimit,
        receivedAt,
      })
    : null;

  const proposedGuestId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const guestCreatedAt = payload.createdAt ?? receivedAt;
  const statements = [
    db.prepare(CLAIM_TERMINAL_EVENT_GUEST_SYNC_REQUEST_SQL).bind(
      venueId,
      payload.terminalRequestId,
      payloadHash,
      proposedGuestId,
      receivedAt,
      venueId,
      event.id,
      venueId,
      payload.date,
    ),
    db.prepare(INSERT_CLAIMED_TERMINAL_EVENT_GUEST_SQL).bind(
      payload.name,
      payload.email,
      payload.instagram,
      linkId,
      payload.date,
      guestCreatedAt,
      guestCreatedAt,
      event.id,
      payload.date,
      venueId,
      payload.terminalRequestId,
      payloadHash,
      proposedGuestId,
    ),
    db.prepare(INSERT_TERMINAL_GUEST_ACTIVITY_SQL).bind(
      activityId,
      `terminal:${payload.terminalRequestId}`,
      payload.terminalRequestId,
      receivedAt,
      proposedGuestId,
      venueId,
    ),
  ];
  if (linkId) {
    statements.push(
      db.prepare(COUNT_TERMINAL_LINK_GUEST_SQL).bind(
        payload.guestLimit ?? 0,
        linkId,
        activityId,
        proposedGuestId,
      ),
    );
  }
  const [claimResult, guestResult, activityResult] = await db.batch<TerminalGuestSyncRow>(
    statements,
  );

  if (
    claimResult.results?.[0]?.guestId === proposedGuestId &&
    guestResult.results?.[0]?.id === proposedGuestId &&
    activityResult.results?.[0]?.id === activityId
  ) {
    return { outcome: "created", guestId: proposedGuestId };
  }

  return (
    (await readTerminalSyncReplay(db, venueId, payload.terminalRequestId, payloadHash)) ?? {
      outcome: "unavailable",
      guestId: null,
    }
  );
}

export async function persistTerminalGuestSync(
  db: D1Database,
  params: {
    venueId: string;
    payload: TerminalGuestSyncPayload;
    receivedAt: string;
  },
): Promise<TerminalGuestSyncPersistenceResult> {
  if (params.payload.artistName) {
    return persistTerminalArtistGuestSync(db, {
      ...params,
      payload: { ...params.payload, artistName: params.payload.artistName },
    });
  }
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
  // Retryable: the venue has not opened its own event for this date yet, or has more than one.
  if (result.outcome === "event_not_ready" || result.outcome === "event_ambiguous") {
    return {
      status: 503,
      body: {
        ok: false,
        error: result.outcome === "event_not_ready" ? "EVENT_NOT_READY" : "EVENT_AMBIGUOUS",
      },
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
