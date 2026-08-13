export const INTERNAL_BULK_GUEST_INSERT_SQL = `INSERT INTO guests (
  id, venue_id, name, external_link_id, created_by_user_id, registered_by_name,
  event_id, date, status, created_at, updated_at
)
SELECT ?, ?, ?, NULL, ?, ?, ?, ?, 'pending', ?, ?
WHERE EXISTS (
  SELECT 1 FROM venues WHERE id = ? AND active = 1
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
    WHERE created_by_user_id = ?
      AND status != 'deleted'
      AND (event_id = ? OR (? = 1 AND event_id IS NULL AND date = ?))
  ) < ? + coalesce((
    SELECT sum(approved_extra) FROM guest_limit_requests
    WHERE user_id = ?
      AND status = 'approved'
      AND (event_id = ? OR (? = 1 AND event_id IS NULL AND date = ?))
  ), 0)
)
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
  ${duplicateGuards}
RETURNING id`;
}

export const EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL = `INSERT INTO guests (
  id, venue_id, name, external_link_id, event_id, date, status, created_at, updated_at
)
SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?
WHERE changes() = 1
RETURNING id`;

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
RETURNING id`;

export const PERMANENT_DELETE_GUEST_SQL = `DELETE FROM guests
WHERE id = ?
  AND venue_id = ?
  AND EXISTS (
    SELECT 1 FROM venues
    WHERE venues.id = guests.venue_id
      AND venues.active = 1
  )
RETURNING id`;
