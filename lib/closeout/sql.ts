export const CONFIRM_EVENT_CLOSEOUT_SQL = `
  INSERT INTO event_closeouts (
    event_id, venue_id, confirmed_by_user_id, confirmed_at,
    report_hash, registered_count, checked_in_count, source_activity_count
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM events
    WHERE id = ? AND venue_id = ? AND state IN ('closed', 'archived')
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id AS eventId
`;
