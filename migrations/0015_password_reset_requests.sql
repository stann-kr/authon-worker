-- 관리자 비밀번호 재설정 요청과 일회성 승인 상태

CREATE TABLE password_reset_requests (
  id TEXT PRIMARY KEY,
  venue_id TEXT REFERENCES venues(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'self_service'
    CHECK (source IN ('self_service', 'admin')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  setup_method TEXT
    CHECK (setup_method IS NULL OR setup_method IN ('setup_code', 'admin_approved')),
  decided_by_user_id TEXT REFERENCES users(id),
  decided_at TEXT,
  expires_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_password_reset_requests_venue_status_created
  ON password_reset_requests(venue_id, status, created_at);

CREATE INDEX idx_password_reset_requests_user_created
  ON password_reset_requests(user_id, created_at);

CREATE UNIQUE INDEX idx_password_reset_requests_one_open
  ON password_reset_requests(user_id)
  WHERE status IN ('pending', 'approved');
