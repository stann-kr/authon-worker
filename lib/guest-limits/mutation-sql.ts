import { currentGuestActorPredicate } from "../guests/atomic-sql.ts";

export const INSERT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL = `
  INSERT INTO event_contributor_limits (
    event_id, venue_id, user_id, guest_limit, source_event_id,
    created_by_user_id, created_at
  )
  SELECT
    writable_event.id,
    writable_event.venue_id,
    mutation_actor.id,
    mutation_actor.guest_limit,
    ?,
    mutation_actor.id,
    ?
  FROM events AS writable_event
  JOIN venues AS mutation_venue
    ON mutation_venue.id = writable_event.venue_id
    AND mutation_venue.active = 1
  JOIN users AS mutation_actor
    ON mutation_actor.id = ?
  WHERE writable_event.id = ?
    AND writable_event.venue_id = ?
    AND writable_event.business_date = ?
    AND writable_event.state IN ('draft', 'open')
    AND ${currentGuestActorPredicate("guest", "writable_event.venue_id", false)}
  ON CONFLICT(event_id, user_id) DO NOTHING
  RETURNING guest_limit AS guestLimit
`;

export const SELECT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL = `
  SELECT configured_limit.guest_limit AS guestLimit
  FROM event_contributor_limits AS configured_limit
  JOIN events AS writable_event
    ON writable_event.id = configured_limit.event_id
    AND writable_event.venue_id = configured_limit.venue_id
    AND writable_event.business_date = ?
    AND writable_event.state IN ('draft', 'open')
  WHERE configured_limit.event_id = ?
    AND configured_limit.venue_id = ?
    AND configured_limit.user_id = ?
    AND ${currentGuestActorPredicate("guest", "configured_limit.venue_id", false)}
  LIMIT 1
`;

export const INSERT_GUARDED_COMPATIBILITY_EVENT_SQL = `
  INSERT INTO events (
    id, venue_id, business_date, name, state, compatibility_key,
    created_by_user_id, updated_by_user_id, created_at, updated_at, opened_at
  )
  SELECT
    ?, ?, ?, ?, 'open', ?, mutation_actor.id, mutation_actor.id, ?, ?, ?
  FROM users AS mutation_actor
  JOIN venues AS mutation_venue
    ON mutation_venue.id = ?
    AND mutation_venue.active = 1
  WHERE ? = 1
    AND mutation_actor.id = ?
    AND mutation_actor.role = ?
    AND mutation_actor.account_kind = ?
    AND mutation_actor.venue_id IS ?
    AND mutation_actor.session_version = ?
    AND mutation_actor.active = 1
    AND mutation_actor.deleted_at IS NULL
    AND mutation_actor.role IN ('staff', 'dj')
    AND mutation_actor.account_kind = 'personal'
    AND mutation_actor.guest_limit IS NOT NULL
  ON CONFLICT(compatibility_key) DO NOTHING
  RETURNING id
`;

export const INSERT_GUARDED_EVENT_CONTRIBUTOR_LIMIT_SQL = `
  INSERT INTO event_contributor_limits (
    event_id, venue_id, user_id, guest_limit, source_event_id,
    created_by_user_id, created_at
  )
  SELECT
    writable_event.id,
    ?,
    mutation_actor.id,
    mutation_actor.guest_limit,
    writable_event.template_source_event_id,
    mutation_actor.id,
    ?
  FROM events AS writable_event
  JOIN venues AS mutation_venue
    ON mutation_venue.id = ?
    AND mutation_venue.active = 1
  JOIN users AS mutation_actor
    ON mutation_actor.id = ?
    AND mutation_actor.role = ?
    AND mutation_actor.account_kind = ?
    AND mutation_actor.venue_id IS ?
    AND mutation_actor.session_version = ?
    AND mutation_actor.active = 1
    AND mutation_actor.deleted_at IS NULL
    AND mutation_actor.role IN ('staff', 'dj')
    AND mutation_actor.account_kind = 'personal'
  WHERE (
      (? = 1 AND writable_event.id = ?)
      OR (? = 0 AND writable_event.compatibility_key = ?)
    )
    AND writable_event.venue_id = ?
    AND writable_event.business_date = ?
    AND writable_event.state IN ('draft', 'open')
    AND (
      mutation_actor.guest_limit IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM event_contributor_limits AS current_limit
        WHERE current_limit.event_id = writable_event.id
          AND current_limit.venue_id = ?
          AND current_limit.user_id = mutation_actor.id
          AND current_limit.guest_limit IS NOT NULL
      )
    )
  ON CONFLICT(event_id, user_id) DO NOTHING
  RETURNING event_id AS eventId
`;

export const INSERT_GUARDED_GUEST_LIMIT_REQUEST_SQL = `
  INSERT INTO guest_limit_requests (
    id, venue_id, user_id, date, event_id, requested_extra, approved_extra,
    reason, status, decided_by_user_id, decided_at, decision_note,
    created_at, updated_at
  )
  SELECT
    ?,
    writable_event.venue_id,
    mutation_actor.id,
    ?,
    writable_event.id,
    ?,
    0,
    ?,
    'pending',
    NULL,
    NULL,
    NULL,
    ?,
    ?
  FROM events AS writable_event
  JOIN venues AS mutation_venue
    ON mutation_venue.id = ?
    AND mutation_venue.active = 1
  JOIN users AS mutation_actor
    ON mutation_actor.id = ?
    AND mutation_actor.role = ?
    AND mutation_actor.account_kind = ?
    AND mutation_actor.venue_id IS ?
    AND mutation_actor.session_version = ?
    AND mutation_actor.active = 1
    AND mutation_actor.deleted_at IS NULL
    AND mutation_actor.role IN ('staff', 'dj')
    AND mutation_actor.account_kind = 'personal'
  JOIN event_contributor_limits AS configured_limit
    ON configured_limit.event_id = writable_event.id
    AND configured_limit.venue_id = writable_event.venue_id
    AND configured_limit.user_id = mutation_actor.id
    AND configured_limit.guest_limit IS NOT NULL
  WHERE (
      (? = 1 AND writable_event.id = ?)
      OR (? = 0 AND writable_event.compatibility_key = ?)
    )
    AND writable_event.venue_id = ?
    AND writable_event.business_date = ?
    AND writable_event.state IN ('draft', 'open')
  RETURNING
    id,
    venue_id AS venueId,
    user_id AS userId,
    date,
    event_id AS eventId,
    requested_extra AS requestedExtra,
    approved_extra AS approvedExtra,
    reason,
    status,
    decided_by_user_id AS decidedByUserId,
    decided_at AS decidedAt,
    decision_note AS decisionNote,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

export const SELECT_USABLE_EVENT_CONTRIBUTOR_LIMIT_SQL = `
  WITH writable_scope AS (
    SELECT
      writable_event.id AS event_id,
      writable_event.venue_id AS venue_id,
      mutation_actor.id AS actor_id
    FROM events AS writable_event
    JOIN venues AS mutation_venue
      ON mutation_venue.id = ?
      AND mutation_venue.active = 1
    JOIN users AS mutation_actor
      ON mutation_actor.id = ?
      AND mutation_actor.role = ?
      AND mutation_actor.account_kind = ?
      AND mutation_actor.venue_id IS ?
      AND mutation_actor.session_version = ?
      AND mutation_actor.active = 1
      AND mutation_actor.deleted_at IS NULL
      AND mutation_actor.role IN ('staff', 'dj')
      AND mutation_actor.account_kind = 'personal'
    WHERE (
        (? = 1 AND writable_event.id = ?)
        OR (? = 0 AND writable_event.compatibility_key = ?)
      )
      AND writable_event.venue_id = ?
      AND writable_event.business_date = ?
      AND writable_event.state IN ('draft', 'open')
  )
  SELECT
    EXISTS (SELECT 1 FROM writable_scope) AS scopeValid,
    EXISTS (
      SELECT 1
      FROM writable_scope
      JOIN event_contributor_limits AS configured_limit
        ON configured_limit.event_id = writable_scope.event_id
        AND configured_limit.venue_id = writable_scope.venue_id
        AND configured_limit.user_id = writable_scope.actor_id
        AND configured_limit.guest_limit IS NOT NULL
    ) AS limitAvailable
`;

export const SELECT_GUEST_LIMIT_REQUEST_SQL = `
  SELECT
    id,
    venue_id AS venueId,
    user_id AS userId,
    date,
    event_id AS eventId,
    requested_extra AS requestedExtra,
    approved_extra AS approvedExtra,
    reason,
    status,
    decided_by_user_id AS decidedByUserId,
    decided_at AS decidedAt,
    decision_note AS decisionNote,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM guest_limit_requests
  WHERE id = ?
  LIMIT 1
`;

export const DECIDE_GUEST_LIMIT_REQUEST_SQL = `
  UPDATE guest_limit_requests
  SET
    status = ?,
    approved_extra = ?,
    decided_by_user_id = ?,
    decided_at = ?,
    decision_note = ?,
    updated_at = ?
  WHERE id = ?
    AND venue_id = ?
    AND user_id = ?
    AND date = ?
    AND event_id IS ?
    AND requested_extra = ?
    AND approved_extra = ?
    AND reason IS ?
    AND decided_by_user_id IS ?
    AND decided_at IS ?
    AND decision_note IS ?
    AND created_at = ?
    AND updated_at = ?
    AND status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM venues AS mutation_venue
      WHERE mutation_venue.id = guest_limit_requests.venue_id
        AND mutation_venue.active = 1
    )
    AND EXISTS (
      SELECT 1
      FROM users AS mutation_actor
      WHERE mutation_actor.id = ?
        AND mutation_actor.role = ?
        AND mutation_actor.account_kind = ?
        AND mutation_actor.venue_id IS ?
        AND mutation_actor.session_version = ?
        AND mutation_actor.active = 1
        AND mutation_actor.deleted_at IS NULL
        AND mutation_actor.role IN ('super_admin', 'venue_admin')
        AND (
          mutation_actor.role = 'super_admin'
          OR mutation_actor.venue_id = guest_limit_requests.venue_id
        )
    )
    AND (
      guest_limit_requests.event_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM events AS writable_event
        WHERE writable_event.id = guest_limit_requests.event_id
          AND writable_event.venue_id = guest_limit_requests.venue_id
          AND writable_event.business_date = guest_limit_requests.date
          AND writable_event.state IN ('draft', 'open')
      )
    )
  RETURNING
    id,
    venue_id AS venueId,
    user_id AS userId,
    date,
    event_id AS eventId,
    requested_extra AS requestedExtra,
    approved_extra AS approvedExtra,
    reason,
    status,
    decided_by_user_id AS decidedByUserId,
    decided_at AS decidedAt,
    decision_note AS decisionNote,
    created_at AS createdAt,
    updated_at AS updatedAt
`;
