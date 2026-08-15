import { MANAGEABLE_PASSWORD_RESET_TARGET_SQL } from "./password-reset-lifecycle-sql.ts";

const MANAGED_PASSWORD_LINK_AUTHORIZATION_SQL = `
  EXISTS (
    SELECT 1
    FROM users link_target
    WHERE link_target.id = ?
      AND link_target.password_hash = ?
      AND link_target.session_version = ?
      AND link_target.active = 1
      AND link_target.deleted_at IS NULL
      AND (
        link_target.role = 'super_admin'
        OR EXISTS (
          SELECT 1 FROM venues link_venue
          WHERE link_venue.id = link_target.venue_id
            AND link_venue.active = 1
        )
      )
      AND ${MANAGEABLE_PASSWORD_RESET_TARGET_SQL}
  )
`;

export const INVALIDATE_OTHER_MANAGED_PASSWORD_LINKS_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE user_id = ?
    AND id <> ?
    AND ${MANAGED_PASSWORD_LINK_AUTHORIZATION_SQL}
`;

export const ACTIVATE_MANAGED_PASSWORD_LINK_SQL = `
  UPDATE password_reset_tokens
  SET used = 0
  WHERE id = ?
    AND user_id = ?
    AND used = 1
    AND expires_at > ?
    AND ${MANAGED_PASSWORD_LINK_AUTHORIZATION_SQL}
  RETURNING user_id
`;

export const INSERT_MANAGED_PASSWORD_LINK_AUDIT_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, link_target.venue_id, ?, link_target.id, ?, ?, ?
  FROM users link_target
  WHERE link_target.id = ?
    AND EXISTS (
      SELECT 1
      FROM password_reset_tokens link_token
      WHERE link_token.id = ?
        AND link_token.user_id = link_target.id
        AND link_token.used = 0
        AND link_token.expires_at > ?
    )
  RETURNING target_user_id
`;

export const CANCEL_MANAGED_PASSWORD_RESET_REQUESTS_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND EXISTS (
      SELECT 1
      FROM user_audit_events
      WHERE id = ?
        AND action IN ('invitation_reissued', 'password_reset_link_issued')
    )
`;
