import "server-only";

import { getD1Database } from "@/lib/db/client";
import type { D1Database } from "@cloudflare/workers-types";

import type { Event } from "../events/types";
import type { GuestWriteActor } from "../guests/actor";
import {
  INSERT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL,
  SELECT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL,
} from "./mutation-sql";

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
  const d1 = getD1Database() as D1Database;
  await d1.prepare(INSERT_CURRENT_ACTOR_EVENT_CONTRIBUTOR_LIMIT_SQL).bind(
    input.event.templateSourceEventId,
    input.createdAt,
    input.actor.id,
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
