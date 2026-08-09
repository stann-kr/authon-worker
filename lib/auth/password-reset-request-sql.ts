export const CANCEL_EXPIRED_ADMIN_APPROVED_RESET_REQUESTS_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE user_id = ?
    AND status = 'approved'
    AND setup_method = 'admin_approved'
    AND expires_at <= ?
`;

export const INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_SQL = `
  INSERT INTO password_reset_requests (
    id, venue_id, user_id, source, status, created_at, updated_at
  )
  VALUES (?, ?, ?, 'self_service', 'pending', ?, ?)
  ON CONFLICT DO NOTHING
`;

export const COMPLETE_OPEN_PASSWORD_RESET_REQUEST_AFTER_USER_UPDATE_SQL = `
  UPDATE password_reset_requests
  SET status = 'completed',
      completed_at = ?,
      updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND changes() = 1
`;
