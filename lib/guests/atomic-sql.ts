export type GuestWriteAccess = "guest" | "door" | "admin";

export function currentGuestActorPredicate(
  access: GuestWriteAccess,
  targetVenue: string,
  verifyGuestLimit = true,
): string {
  const accessPredicate = access === "admin"
    ? "mutation_actor.role IN ('super_admin', 'venue_admin')"
    : access === "door"
      ? "(mutation_actor.role IN ('super_admin', 'venue_admin', 'door_staff') OR (mutation_actor.account_kind = 'shared' AND mutation_actor.door_access_enabled = 1))"
      : "mutation_actor.role IN ('super_admin', 'venue_admin', 'door_staff', 'staff', 'dj')";

  return `EXISTS (
    SELECT 1
    FROM users AS mutation_actor
    WHERE mutation_actor.id = ?
      AND mutation_actor.role = ?
      AND mutation_actor.account_kind = ?
      AND mutation_actor.door_access_enabled = ?
      AND mutation_actor.venue_id IS ?
      ${verifyGuestLimit ? "AND mutation_actor.guest_limit IS ?" : ""}
      AND mutation_actor.session_version = ?
      AND mutation_actor.active = 1
      AND mutation_actor.deleted_at IS NULL
      AND ${accessPredicate}
      AND (
        mutation_actor.role = 'super_admin'
        OR mutation_actor.venue_id = ${targetVenue}
      )
  )`;
}

export const INTERNAL_BULK_GUEST_INSERT_SQL = `INSERT INTO guests (
  id, venue_id, name, external_link_id, created_by_user_id, registered_by_name,
  event_id, date, status, created_at, updated_at
)
SELECT ?, ?, ?, NULL, ?, ?, ?, ?, 'pending', ?, ?
WHERE EXISTS (
  SELECT 1 FROM venues WHERE id = ? AND active = 1
)
AND EXISTS (
  SELECT 1 FROM events
  WHERE id = ?
    AND venue_id = ?
    AND business_date = ?
    AND state IN ('draft', 'open')
)
AND (
  ? = 1 OR NOT EXISTS (
    SELECT 1 FROM guests
    WHERE venue_id = ?
      AND created_by_user_id = ?
      AND status != 'deleted'
      AND (event_id = ? OR (? = 1 AND event_id IS NULL AND date = ?))
      AND name = ?
  )
)
AND (
  ? IS NULL OR (
    SELECT count(*) FROM guests
    WHERE venue_id = ?
      AND created_by_user_id = ?
      AND status != 'deleted'
      AND (event_id = ? OR (? = 1 AND event_id IS NULL AND date = ?))
  ) < ? + coalesce((
    SELECT sum(approved_extra) FROM guest_limit_requests
    WHERE venue_id = ?
      AND user_id = ?
      AND status = 'approved'
      AND (event_id = ? OR (? = 1 AND event_id IS NULL AND date = ?))
  ), 0)
)
AND EXISTS (
  SELECT 1 FROM event_contributor_limits AS configured_limit
  WHERE configured_limit.event_id = ?
    AND configured_limit.venue_id = ?
    AND configured_limit.user_id = ?
    AND configured_limit.guest_limit IS ?
)
AND ${currentGuestActorPredicate("guest", "?", false)}
RETURNING id`;

export function buildExternalGuestReservationSql(
  guardedNameCount: number,
): string {
  if (!Number.isInteger(guardedNameCount) || guardedNameCount < 0 || guardedNameCount > 25) {
    throw new Error("Invalid external guest duplicate guard count");
  }

  const duplicateGuards = Array.from(
    { length: guardedNameCount },
    () => `AND NOT EXISTS (
      SELECT 1 FROM guests
      WHERE external_link_id = ? AND status != 'deleted' AND name = ?
    )`,
  ).join("\n");

  return `UPDATE external_dj_links
SET used_guests = used_guests + ?
WHERE id = ?
  AND active = 1
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = external_dj_links.venue_id
      AND venues.active = 1
  )
  AND deleted_at IS NULL
  AND (expires_at IS NULL OR expires_at > ?)
  AND date = ?
  AND used_guests + ? <= max_guests
  AND (external_dj_links.event_id IS NULL OR external_dj_links.event_id = ?)
  AND EXISTS (
    SELECT 1 FROM events
    WHERE events.id = ?
      AND events.venue_id = external_dj_links.venue_id
      AND events.business_date = external_dj_links.date
      AND events.state IN ('draft', 'open')
  )
  ${duplicateGuards}
RETURNING id`;
}

export const EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL = `INSERT INTO guests (
  id, venue_id, name, external_link_id, event_id, date, status, created_at, updated_at
)
SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?
WHERE changes() = 1
RETURNING id`;

export const RESERVE_SELF_RSVP_SLOT_SQL = `UPDATE external_dj_links
SET used_guests = used_guests + 1
WHERE id = ?
  AND token = ?
  AND venue_id = ?
  AND kind = 'self_rsvp'
  AND active = 1
  AND deleted_at IS NULL
  AND (expires_at IS NULL OR expires_at > ?)
  AND date = ?
  AND used_guests < max_guests
  AND (external_dj_links.event_id IS NULL OR external_dj_links.event_id = ?)
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = external_dj_links.venue_id
      AND venues.active = 1
  )
  AND EXISTS (
    SELECT 1 FROM events
    WHERE events.id = ?
      AND events.venue_id = external_dj_links.venue_id
      AND events.business_date = external_dj_links.date
      AND events.state IN ('draft', 'open')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM external_guest_owners owner
    JOIN guests guest ON guest.id = owner.guest_id
    WHERE owner.external_link_id = external_dj_links.id
      AND owner.owner_key_hash = ?
      AND owner.released_at IS NULL
      AND guest.status != 'deleted'
  )
RETURNING id`;

export const INSERT_SELF_RSVP_OWNER_AFTER_GUEST_SQL = `INSERT INTO external_guest_owners (
  guest_id, external_link_id, owner_key_hash, created_at, released_at
)
SELECT ?, ?, ?, ?, NULL
WHERE changes() = 1
RETURNING guest_id AS guestId`;

export const SOFT_DELETE_GUEST_SQL = `UPDATE guests
SET status = 'deleted', updated_at = ?, event_id = coalesce(event_id, ?)
WHERE id = ?
  AND venue_id = ?
  AND status != 'deleted'
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = guests.venue_id
      AND venues.active = 1
  )
  AND (event_id = ? OR (? = 1 AND event_id IS NULL AND date = ?))
  AND EXISTS (
    SELECT 1 FROM events
    WHERE events.id = ?
      AND events.venue_id = guests.venue_id
      AND events.business_date = guests.date
      AND events.state IN ('draft', 'open')
  )
  AND (? = 1 OR created_by_user_id = ?)
  AND ${currentGuestActorPredicate("guest", "guests.venue_id")}
RETURNING id`;

export const UPDATE_ACTIVE_GUEST_STATUS_SQL = `UPDATE guests
SET status = ?, check_in_time = ?, updated_at = ?
WHERE id = ?
  AND venue_id = ?
  AND status != 'deleted'
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = guests.venue_id
      AND venues.active = 1
  )
  AND ? IN ('pending', 'checked')
RETURNING id`;

export const UPDATE_GUEST_DETAILS_SQL = `UPDATE guests
SET venue_id = ?, name = ?, date = ?, event_id = ?, updated_at = ?
WHERE id = ?
  AND venue_id = ?
  AND status != 'deleted'
  AND EXISTS (
    SELECT 1 FROM venues WHERE id = ? AND active = 1
  )
  AND EXISTS (
    SELECT 1 FROM events
    WHERE events.id = ?
      AND events.venue_id = ?
      AND events.business_date = ?
      AND events.state IN ('draft', 'open')
  )
  AND (? = 1 OR created_by_user_id = ?)
  AND ${currentGuestActorPredicate("guest", "guests.venue_id")}
RETURNING id`;

export const RESTORE_DELETED_GUEST_SQL = `UPDATE guests
SET status = 'pending', check_in_time = NULL, updated_at = ?,
  event_id = coalesce(event_id, ?)
WHERE id = ?
  AND venue_id = ?
  AND status = 'deleted'
  AND (event_id = ? OR (? = 1 AND event_id IS NULL AND date = ?))
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = guests.venue_id AND venues.active = 1
  )
  AND EXISTS (
    SELECT 1 FROM events
    WHERE events.id = ?
      AND events.venue_id = guests.venue_id
      AND events.business_date = guests.date
      AND events.state IN ('draft', 'open')
  )
  AND ${currentGuestActorPredicate("admin", "guests.venue_id")}
RETURNING id`;

export const DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL = `UPDATE external_dj_links
SET used_guests = max(0, used_guests - 1)
WHERE id = ?
  AND token = ?
  AND venue_id = ?
  AND active = 1
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = external_dj_links.venue_id
      AND venues.active = 1
  )
  AND deleted_at IS NULL
  AND (expires_at IS NULL OR expires_at > ?)
  AND date = ?
  AND EXISTS (
    SELECT 1 FROM guests
    WHERE id = ?
      AND external_link_id = ?
      AND venue_id = ?
      AND date = ?
      AND status = 'pending'
  )
RETURNING id`;

export const SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL = `UPDATE guests
SET status = 'deleted', updated_at = ?
WHERE changes() = 1
  AND id = ?
  AND external_link_id = ?
  AND venue_id = ?
  AND date = ?
  AND status = 'pending'
RETURNING id`;

export const DECREMENT_SELF_RSVP_FOR_PENDING_GUEST_SQL = `UPDATE external_dj_links
SET used_guests = max(0, used_guests - 1)
WHERE id = ?
  AND token = ?
  AND venue_id = ?
  AND kind = 'self_rsvp'
  AND active = 1
  AND deleted_at IS NULL
  AND (expires_at IS NULL OR expires_at > ?)
  AND date = ?
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = external_dj_links.venue_id
      AND venues.active = 1
  )
  AND EXISTS (
    SELECT 1
    FROM guests guest
    JOIN external_guest_owners owner ON owner.guest_id = guest.id
    WHERE guest.id = ?
      AND guest.external_link_id = ?
      AND guest.venue_id = ?
      AND guest.date = ?
      AND guest.status = 'pending'
      AND owner.external_link_id = external_dj_links.id
      AND owner.owner_key_hash = ?
      AND owner.released_at IS NULL
  )
RETURNING id`;

export const UPDATE_SELF_RSVP_GUEST_SQL = `UPDATE guests
SET name = ?, updated_at = ?
WHERE id = ?
  AND external_link_id = ?
  AND venue_id = ?
  AND date = ?
  AND status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM external_guest_owners owner
    WHERE owner.guest_id = guests.id
      AND owner.external_link_id = guests.external_link_id
      AND owner.owner_key_hash = ?
      AND owner.released_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM external_dj_links link
    JOIN venues venue ON venue.id = link.venue_id
    WHERE link.id = guests.external_link_id
      AND link.token = ?
      AND link.kind = 'self_rsvp'
      AND link.active = 1
      AND link.deleted_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at > ?)
      AND link.venue_id = guests.venue_id
      AND link.date = guests.date
      AND (link.event_id IS NULL OR link.event_id = ?)
      AND (guests.event_id IS NULL OR guests.event_id = ?)
      AND venue.active = 1
      AND EXISTS (
        SELECT 1 FROM events
        WHERE events.id = ?
          AND events.venue_id = link.venue_id
          AND events.business_date = link.date
          AND events.state IN ('draft', 'open')
      )
  )
RETURNING id`;

export const DECREMENT_EXTERNAL_LINK_AFTER_CHANGE_SQL = `UPDATE external_dj_links
SET used_guests = max(0, used_guests - 1)
WHERE id = ?
  AND changes() = 1
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = external_dj_links.venue_id
      AND venues.active = 1
  )
RETURNING id`;

export const DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL = `UPDATE external_dj_links
SET used_guests = max(0, used_guests - 1)
WHERE id = ?
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = external_dj_links.venue_id
      AND venues.active = 1
  )
  AND EXISTS (
    SELECT 1 FROM guests
    WHERE id = ?
      AND external_link_id = ?
      AND venue_id = ?
      AND status != 'deleted'
  )
  AND ${currentGuestActorPredicate("admin", "external_dj_links.venue_id")}
RETURNING id`;

export const PERMANENT_DELETE_GUEST_SQL = `DELETE FROM guests
WHERE id = ?
  AND venue_id = ?
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = guests.venue_id
      AND venues.active = 1
  )
  AND ${currentGuestActorPredicate("admin", "guests.venue_id")}
RETURNING id`;
