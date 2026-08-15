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

export const INSERT_EVENT_CLOSEOUT_CONTRIBUTOR_METRIC_SQL = `
  INSERT INTO event_closeout_contributor_metrics (
    event_id, venue_id, contributor_id, source_kind, source_id,
    registered_count, checked_in_count, created_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM event_closeouts
    WHERE event_id = ? AND venue_id = ? AND confirmed_at = ? AND report_hash = ?
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id AS eventId
`;
