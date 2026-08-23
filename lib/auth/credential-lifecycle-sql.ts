export const UPDATE_USER_FOR_LOGIN_SQL = `
  UPDATE users
  SET last_login_at = ?,
      password_hash = ?
  WHERE id = ?
    AND password_hash = ?
    AND session_version = ?
    AND active = 1
    AND deleted_at IS NULL
    AND (
      role = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM venues login_venue
        WHERE login_venue.id = users.venue_id
          AND login_venue.active = 1
      )
    )
  RETURNING session_version
`;

export const CANCEL_OPEN_PASSWORD_RESET_REQUESTS_AFTER_LOGIN_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND changes() = 1
`;

export const SELECT_LATEST_SETUP_CODE_REQUEST_SQL = `
  SELECT status, setup_method, expires_at
  FROM password_reset_requests
  WHERE user_id = ?
    AND setup_method = 'setup_code'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`;

export const SELECT_VALID_RESET_TOKEN_CANDIDATE_SQL = `
  SELECT prt.user_id, u.migration_status, u.password_set_at
  FROM password_reset_tokens prt
  JOIN users u ON u.id = prt.user_id
  WHERE prt.token = ?
    AND prt.used = 0
    AND prt.expires_at > ?
    AND u.active = 1
    AND u.deleted_at IS NULL
    AND (
      u.role = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM venues candidate_venue
        WHERE candidate_venue.id = u.venue_id
          AND candidate_venue.active = 1
      )
    )
    AND (? IS NULL OR u.venue_id = ?)
  LIMIT 1
`;

export const UPDATE_PASSWORD_WITH_VALID_TOKEN_SQL = `
  UPDATE users
  SET password_hash = ?,
      session_version = session_version + 1,
      migration_status = CASE
        WHEN migration_status = 'pending_reset' THEN 'active'
        ELSE migration_status
      END,
      password_set_at = ?
  WHERE id = (
    SELECT prt.user_id
    FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE prt.token = ?
      AND prt.used = 0
      AND prt.expires_at > ?
      AND u.active = 1
      AND u.deleted_at IS NULL
      AND (
        u.role = 'super_admin'
        OR EXISTS (
          SELECT 1 FROM venues candidate_venue
          WHERE candidate_venue.id = u.venue_id
            AND candidate_venue.active = 1
        )
      )
      AND (? IS NULL OR u.venue_id = ?)
  )
  RETURNING id
`;

export const CONSUME_EXACT_RESET_TOKEN_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE token = ?
    AND used = 0
    AND expires_at > ?
    AND changes() = 1
  RETURNING user_id
`;

export const INSERT_TOKEN_RESET_AUDIT_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, u.venue_id, u.id, u.id, ?, ?, ?
  FROM users u
  JOIN password_reset_tokens prt ON prt.user_id = u.id
  WHERE prt.token = ?
    AND prt.used = 1
    AND changes() = 1
  RETURNING target_user_id
`;

export const INVALIDATE_ALL_USER_RESET_TOKENS_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE used = 0
    AND user_id = (
      SELECT target_user_id
      FROM user_audit_events
      WHERE id = ?
        AND action IN ('password_setup_completed', 'password_reset_completed')
    )
`;

export const COMPLETE_TOKEN_RESET_REQUESTS_SQL = `
  UPDATE password_reset_requests
  SET status = 'completed',
      completed_at = ?,
      updated_at = ?
  WHERE status IN ('pending', 'approved')
    AND user_id = (
      SELECT target_user_id
      FROM user_audit_events
      WHERE id = ?
        AND action IN ('password_setup_completed', 'password_reset_completed')
    )
`;

export const UPDATE_PROFILE_PASSWORD_CAS_SQL = `
  UPDATE users
  SET password_hash = ?,
      password_set_at = ?,
      session_version = session_version + 1
  WHERE id = ?
    AND password_hash = ?
    AND session_version = ?
    AND active = 1
    AND deleted_at IS NULL
  RETURNING id
`;

export const INSERT_PROFILE_PASSWORD_AUDIT_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, venue_id, id, id, 'password_changed', ?, ?
  FROM users
  WHERE id = ?
    AND changes() = 1
  RETURNING target_user_id
`;

export const INVALIDATE_PROFILE_RESET_TOKENS_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE user_id = ?
    AND used = 0
    AND EXISTS (
      SELECT 1
      FROM user_audit_events
      WHERE id = ?
        AND target_user_id = ?
        AND action = 'password_changed'
    )
`;

export const CANCEL_PROFILE_RESET_REQUESTS_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND EXISTS (
      SELECT 1
      FROM user_audit_events
      WHERE id = ?
        AND target_user_id = ?
        AND action = 'password_changed'
    )
`;
