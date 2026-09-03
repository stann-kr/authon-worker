import type { D1Database } from "@cloudflare/workers-types";

import { isEventState } from "./domain.ts";
import type { Event } from "./types.ts";
import {
  isRole,
  type AccountKind,
  type Role,
} from "../users/policy.ts";

export interface CompatibilityEventActorGuard {
  id: string;
  role: Role;
  accountKind: AccountKind;
  venueId: string | null;
  sessionVersion: number;
  doorAccessEnabled?: boolean;
  allowedRoles: readonly Role[];
}

export interface GuardedCompatibilityEventInput {
  proposedId: string;
  venueId: string;
  businessDate: string;
  compatibilityKey: string;
  actor: CompatibilityEventActorGuard;
  createdAt: string;
}

const INSERT_GUARDED_COMPATIBILITY_EVENT_SQL = `
  INSERT INTO events (
    id, venue_id, business_date, name, state, compatibility_key,
    created_by_user_id, updated_by_user_id, created_at, updated_at, opened_at
  )
  SELECT
    ?, mutation_venue.id, ?, ?, 'open', ?, mutation_actor.id,
    mutation_actor.id, ?, ?, ?
  FROM users AS mutation_actor
  JOIN venues AS mutation_venue
    ON mutation_venue.id = ?
    AND mutation_venue.active = 1
  WHERE mutation_actor.id = ?
    AND mutation_actor.role = ?
    AND mutation_actor.account_kind = ?
    AND mutation_actor.venue_id IS ?
    AND mutation_actor.session_version = ?
    AND mutation_actor.active = 1
    AND mutation_actor.deleted_at IS NULL
    AND (? = 0 OR mutation_actor.door_access_enabled = ?)
    AND (
      (? = 1 AND mutation_actor.role = 'super_admin')
      OR (? = 1 AND mutation_actor.role = 'venue_admin')
      OR (? = 1 AND mutation_actor.role = 'door_staff')
      OR (? = 1 AND mutation_actor.role = 'staff')
      OR (? = 1 AND mutation_actor.role = 'dj')
    )
    AND (
      mutation_actor.role = 'super_admin'
      OR mutation_actor.venue_id = mutation_venue.id
    )
  ON CONFLICT(compatibility_key) DO NOTHING
  RETURNING id
`;

const SELECT_COMPATIBILITY_EVENT_SQL = `
  SELECT
    compatibility_event.id,
    compatibility_event.venue_id AS venueId,
    compatibility_event.business_date AS businessDate,
    compatibility_event.name,
    compatibility_event.door_opens_at AS doorOpensAt,
    compatibility_event.guest_cutoff_at AS guestCutoffAt,
    compatibility_event.capacity,
    compatibility_event.target_guests AS targetGuests,
    compatibility_event.state,
    compatibility_event.template_source_event_id AS templateSourceEventId,
    compatibility_event.compatibility_key AS compatibilityKey,
    compatibility_event.created_by_user_id AS createdByUserId,
    compatibility_event.updated_by_user_id AS updatedByUserId,
    compatibility_event.created_at AS createdAt,
    compatibility_event.updated_at AS updatedAt,
    compatibility_event.opened_at AS openedAt,
    compatibility_event.closed_at AS closedAt
  FROM events AS compatibility_event
  JOIN venues AS mutation_venue
    ON mutation_venue.id = ?
    AND mutation_venue.active = 1
    AND compatibility_event.venue_id = mutation_venue.id
  JOIN users AS mutation_actor
    ON mutation_actor.id = ?
  WHERE compatibility_event.compatibility_key = ?
    AND compatibility_event.business_date = ?
    AND mutation_actor.role = ?
    AND mutation_actor.account_kind = ?
    AND mutation_actor.venue_id IS ?
    AND mutation_actor.session_version = ?
    AND mutation_actor.active = 1
    AND mutation_actor.deleted_at IS NULL
    AND (? = 0 OR mutation_actor.door_access_enabled = ?)
    AND (
      (? = 1 AND mutation_actor.role = 'super_admin')
      OR (? = 1 AND mutation_actor.role = 'venue_admin')
      OR (? = 1 AND mutation_actor.role = 'door_staff')
      OR (? = 1 AND mutation_actor.role = 'staff')
      OR (? = 1 AND mutation_actor.role = 'dj')
    )
    AND (
      mutation_actor.role = 'super_admin'
      OR mutation_actor.venue_id = mutation_venue.id
    )
  LIMIT 1
`;

type CompatibilityEventRow = Omit<Event, "state"> & { state: string };

function allowedRoleFlag(
  allowedRoles: readonly Role[],
  role: Role,
): 0 | 1 {
  return allowedRoles.includes(role) ? 1 : 0;
}

function validateActorGuard(actor: CompatibilityEventActorGuard): void {
  if (
    actor.allowedRoles.length === 0 ||
    actor.allowedRoles.some((role) => !isRole(role))
  ) {
    throw new Error("INVALID_EVENT_ACTOR_GUARD");
  }
}

function actorGuardBindings(actor: CompatibilityEventActorGuard) {
  const checksDoorAccess = actor.doorAccessEnabled !== undefined;
  return [
    actor.id,
    actor.role,
    actor.accountKind,
    actor.venueId,
    actor.sessionVersion,
    checksDoorAccess ? 1 : 0,
    actor.doorAccessEnabled ? 1 : 0,
    allowedRoleFlag(actor.allowedRoles, "super_admin"),
    allowedRoleFlag(actor.allowedRoles, "venue_admin"),
    allowedRoleFlag(actor.allowedRoles, "door_staff"),
    allowedRoleFlag(actor.allowedRoles, "staff"),
    allowedRoleFlag(actor.allowedRoles, "dj"),
  ] as const;
}

function toEvent(row: CompatibilityEventRow): Event {
  if (!isEventState(row.state)) throw new Error("INVALID_EVENT_STATE");
  return { ...row, state: row.state };
}

export async function resolveGuardedCompatibilityEvent(
  database: D1Database,
  input: GuardedCompatibilityEventInput,
): Promise<Event | null> {
  validateActorGuard(input.actor);
  const guardBindings = actorGuardBindings(input.actor);
  const results = await database.batch<Record<string, unknown>>([
    database.prepare(INSERT_GUARDED_COMPATIBILITY_EVENT_SQL).bind(
      input.proposedId,
      input.businessDate,
      input.businessDate,
      input.compatibilityKey,
      input.createdAt,
      input.createdAt,
      input.createdAt,
      input.venueId,
      ...guardBindings,
    ),
    database
      .prepare(SELECT_COMPATIBILITY_EVENT_SQL)
      .bind(
        input.venueId,
        input.actor.id,
        input.compatibilityKey,
        input.businessDate,
        ...guardBindings.slice(1),
      ),
  ]);
  const row = results[1]?.results[0] as CompatibilityEventRow | undefined;
  return row ? toEvent(row) : null;
}
