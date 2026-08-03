-- 사용자 계정 생명주기, 최근 로그인, 관리자 감사 기록

ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN deleted_by TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_venue_active_deleted
  ON users(venue_id, active, deleted_at);

CREATE TABLE user_audit_events (
  id TEXT PRIMARY KEY,
  venue_id TEXT REFERENCES venues(id),
  actor_user_id TEXT REFERENCES users(id),
  target_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_user_audit_events_target_created
  ON user_audit_events(target_user_id, created_at);

CREATE INDEX idx_user_audit_events_venue_created
  ON user_audit_events(venue_id, created_at);
