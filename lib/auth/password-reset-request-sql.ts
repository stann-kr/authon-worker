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

export const CANCEL_EXPIRED_OPEN_PASSWORD_RESET_REQUESTS_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND (
      (expires_at IS NOT NULL AND expires_at <= ?)
      OR (source = 'self_service' AND expires_at IS NULL)
    )
`;

export const INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_WITH_EXPIRY_SQL = `
  INSERT INTO password_reset_requests (
    id, venue_id, user_id, source, status, expires_at, created_at, updated_at
  )
  SELECT ?, venue_id, id, 'self_service', 'pending', ?, ?, ?
  FROM users
  WHERE id = ?
    AND active = 1
    AND deleted_at IS NULL
    AND (? = 'platform' OR venue_id = ? OR role = 'super_admin')
  ON CONFLICT DO NOTHING
  RETURNING id
`;

export const SELECT_EXISTING_BROWSER_PASSWORD_RESET_REQUEST_SQL = `
  SELECT pr.id
  FROM password_reset_requests pr
  JOIN users request_user ON request_user.id = pr.user_id
  WHERE pr.id = ?
    AND pr.user_id = ?
    AND pr.source = 'self_service'
    AND pr.status IN ('pending', 'approved')
    AND pr.expires_at > ?
    AND pr.venue_id IS request_user.venue_id
    AND (? = 'platform' OR request_user.venue_id = ? OR request_user.role = 'super_admin')
  LIMIT 1
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
