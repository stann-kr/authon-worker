import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

import type { Event } from "../events/types";
import { currentGuestActorPredicate } from "../guests/atomic-sql";
import type { GuestWriteActor } from "../guests/actor";

const INSERT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL = `
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
  WHERE writable_event.id = ?
    AND writable_event.venue_id = ?
    AND writable_event.business_date = ?
    AND writable_event.state IN ('draft', 'open')
    AND ${currentGuestActorPredicate("guest", "writable_event.venue_id", false)}
  ON CONFLICT(event_id, user_id) DO NOTHING
  RETURNING guest_limit AS guestLimit
`;

const SELECT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL = `
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

function actorBindings(actor: GuestWriteActor, includeGuestLimit = true) {
  const bindings = [
    actor.id,
    actor.role,
    actor.accountKind,
    actor.doorAccessEnabled ? 1 : 0,
    actor.venueId,
  ];
  if (includeGuestLimit) bindings.push(actor.guestLimit);
  bindings.push(actor.sessionVersion);
  return bindings;
}

export async function getOrCreateEventContributorGuestLimit(input: {
  event: Event;
  venueId: string;
  userId: string;
  actor: GuestWriteActor;
  createdByUserId: string;
  createdAt: string;
}): Promise<number | null> {
  if (
    input.event.venueId !== input.venueId ||
    input.userId !== input.actor.id ||
    input.createdByUserId !== input.actor.id
  ) {
    throw new Error("EVENT_NOT_FOUND");
  }
  const d1 = getCloudflareContext().env.DB as D1Database;
  await d1.prepare(INSERT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL).bind(
    input.event.templateSourceEventId,
    input.createdAt,
    input.event.id,
    input.venueId,
    input.event.businessDate,
    ...actorBindings(input.actor, false),
  ).run();
  const configured = await d1
    .prepare(SELECT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL)
    .bind(
      input.event.businessDate,
      input.event.id,
      input.venueId,
      input.userId,
      ...actorBindings(input.actor, false),
    )
    .first<{ guestLimit: number | null }>();
  if (!configured) throw new Error("Forbidden");
  return configured.guestLimit;
}
