import type { D1Database } from "@cloudflare/workers-types";

import type { PreparedEventDraft } from "./domain.ts";

export interface GuardedEventDetailUpdate {
  eventId: string;
  venueId: string;
  /** The state and revision read before validation; the write applies only if neither changed since. */
  expectedState: string;
  expectedUpdatedAt: string;
  values: PreparedEventDraft;
  actorUserId: string;
  updatedAt: string;
}

// Archived events never take detail edits, even when the expected state was read before the archive.
const UPDATE_EVENT_DETAILS_SQL = `
  UPDATE events
  SET business_date = ?, name = ?, door_opens_at = ?, guest_cutoff_at = ?,
      capacity = ?, target_guests = ?, template_source_event_id = ?,
      updated_by_user_id = ?, updated_at = ?
  WHERE id = ?
    AND venue_id = ?
    AND state = ?
    AND state <> 'archived'
    AND updated_at = ?
`;

/** Returns false when the event was archived or changed by someone else after it was read. */
export async function updateEventDetailsGuarded(
  database: D1Database,
  input: GuardedEventDetailUpdate,
): Promise<boolean> {
  const { values } = input;
  const result = await database
    .prepare(UPDATE_EVENT_DETAILS_SQL)
    .bind(
      values.businessDate,
      values.name,
      values.doorOpensAt,
      values.guestCutoffAt,
      values.capacity,
      values.targetGuests,
      values.templateSourceEventId,
      input.actorUserId,
      input.updatedAt,
      input.eventId,
      input.venueId,
      input.expectedState,
      input.expectedUpdatedAt,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
