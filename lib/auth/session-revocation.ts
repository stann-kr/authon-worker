export const REVOKE_USER_SESSIONS_SQL = `
  UPDATE users
  SET session_version = session_version + 1
  WHERE id = ? AND session_version = ?
  RETURNING session_version AS sessionVersion
`;
