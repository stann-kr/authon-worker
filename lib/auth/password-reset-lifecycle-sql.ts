export const MANAGEABLE_PASSWORD_RESET_TARGET_SQL = `
  EXISTS (
    SELECT 1
    FROM users actor
    JOIN users managed_target ON managed_target.id = ?
    WHERE actor.id = ?
      AND actor.session_version = ?
      AND actor.active = 1
      AND actor.deleted_at IS NULL
      AND managed_target.active = 1
      AND managed_target.deleted_at IS NULL
      AND (
        managed_target.role = 'super_admin'
        OR EXISTS (
          SELECT 1 FROM venues managed_venue
          WHERE managed_venue.id = managed_target.venue_id
            AND managed_venue.active = 1
        )
      )
      AND actor.id <> managed_target.id
      AND (
        actor.role = 'super_admin'
        OR (
          actor.role = 'venue_admin'
          AND actor.venue_id IS NOT NULL
          AND actor.venue_id = managed_target.venue_id
          AND managed_target.role IN ('door_staff', 'staff', 'dj')
        )
      )
  )
`;

export const APPROVE_BROWSER_PASSWORD_RESET_SQL = `
  UPDATE password_reset_requests
  SET status = 'approved',
      setup_method = 'admin_approved',
      decided_by_user_id = ?,
      decided_at = ?,
      expires_at = ?,
      updated_at = ?
  WHERE id = ?
    AND user_id = ?
    AND source = 'self_service'
    AND status = 'pending'
    AND expires_at > ?
    AND EXISTS (
      SELECT 1
      FROM users direct_target
      WHERE direct_target.id = password_reset_requests.user_id
        AND direct_target.venue_id IS password_reset_requests.venue_id
        AND direct_target.account_kind = 'personal'
        AND direct_target.role IN ('door_staff', 'staff', 'dj')
    )
    AND ${MANAGEABLE_PASSWORD_RESET_TARGET_SQL}
  RETURNING user_id
`;

export const INSERT_BROWSER_RESET_APPROVAL_AUDIT_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, venue_id, ?, id, 'password_reset_required', ?, ?
  FROM users
  WHERE id = ?
    AND changes() = 1
`;

export const SET_USER_SETUP_CODE_FOR_REQUEST_SQL = `
  UPDATE users
  SET password_hash = ?,
      migration_status = 'pending_reset',
      password_set_at = NULL,
      session_version = session_version + 1
  WHERE id = ?
    AND password_hash = ?
    AND session_version = ?
    AND active = 1
    AND deleted_at IS NULL
    AND (
      role = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM venues claim_venue
        WHERE claim_venue.id = users.venue_id
          AND claim_venue.active = 1
      )
    )
    AND EXISTS (
      SELECT 1
      FROM password_reset_requests
      WHERE id = ?
        AND user_id = ?
        AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > ?)
        AND password_reset_requests.venue_id IS users.venue_id
    )
    AND ${MANAGEABLE_PASSWORD_RESET_TARGET_SQL}
  RETURNING id
`;

export const APPROVE_SETUP_CODE_REQUEST_SQL = `
  UPDATE password_reset_requests
  SET status = 'approved',
      setup_method = 'setup_code',
      decided_by_user_id = ?,
      decided_at = ?,
      expires_at = ?,
      updated_at = ?
  WHERE id = ?
    AND user_id = ?
    AND status = 'pending'
    AND changes() = 1
  RETURNING user_id
`;

export const INVALIDATE_RESET_TOKENS_AFTER_AUDIT_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE user_id = ?
    AND EXISTS (
      SELECT 1 FROM user_audit_events WHERE id = ?
    )
`;

export const UPDATE_USER_WITH_APPROVED_RESET_SQL = `
  UPDATE users
  SET password_hash = ?,
      migration_status = CASE
        WHEN migration_status = 'pending_reset' THEN 'active'
        ELSE migration_status
      END,
      password_set_at = ?,
      session_version = session_version + 1
  WHERE id = ?
    AND password_hash = ?
    AND session_version = ?
    AND active = 1
    AND deleted_at IS NULL
    AND (
      role = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM venues claim_venue
        WHERE claim_venue.id = users.venue_id
          AND claim_venue.active = 1
      )
    )
    AND (? IS NULL OR venue_id = ? OR role = 'super_admin')
    AND (
      ? <> 'browser_receipt'
      OR (
        account_kind = 'personal'
        AND role IN ('door_staff', 'staff', 'dj')
      )
    )
    AND (
      (
        ? = 'legacy_setup_code'
        AND NOT EXISTS (
          SELECT 1 FROM password_reset_requests
          WHERE user_id = users.id
            AND setup_method = 'setup_code'
        )
      )
      OR EXISTS (
        SELECT 1
        FROM password_reset_requests pr
        WHERE pr.id = ?
          AND pr.user_id = users.id
          AND pr.status = 'approved'
          AND pr.setup_method = ?
          AND pr.expires_at > ?
          AND pr.venue_id IS users.venue_id
          AND EXISTS (
            SELECT 1
            FROM users reset_actor
            WHERE reset_actor.id = pr.decided_by_user_id
              AND reset_actor.active = 1
              AND reset_actor.deleted_at IS NULL
              AND reset_actor.id <> users.id
              AND (
                reset_actor.role = 'super_admin'
                OR (
                  reset_actor.role = 'venue_admin'
                  AND reset_actor.venue_id IS NOT NULL
                  AND reset_actor.venue_id = users.venue_id
                  AND users.role IN ('door_staff', 'staff', 'dj')
                )
              )
          )
      )
    )
  RETURNING id
`;

export const INSERT_PASSWORD_RESET_CLAIM_AUDIT_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, venue_id, id, id, 'password_setup_completed', ?, ?
  FROM users
  WHERE id = ?
    AND changes() = 1
`;

export const COMPLETE_EXACT_PASSWORD_RESET_REQUEST_SQL = `
  UPDATE password_reset_requests
  SET status = 'completed',
      completed_at = ?,
      updated_at = ?
  WHERE id = ?
    AND status = 'approved'
    AND EXISTS (
      SELECT 1 FROM user_audit_events WHERE id = ?
    )
`;

export const INVALIDATE_PASSWORD_RESET_CLAIM_TOKENS_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE user_id = ?
    AND EXISTS (
      SELECT 1 FROM user_audit_events WHERE id = ?
    )
`;

export const CANCEL_OTHER_PASSWORD_RESET_REQUESTS_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND id <> ?
    AND EXISTS (
      SELECT 1 FROM user_audit_events WHERE id = ?
    )
`;
