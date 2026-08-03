-- 공용 계정 식별, Door capability, 등록자 attribution, 날짜별 추가 게스트 요청

ALTER TABLE users ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'personal'
  CHECK (account_kind IN ('personal', 'shared'));

ALTER TABLE users ADD COLUMN door_access_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (door_access_enabled IN (0, 1));

-- 기존 구현에서 0은 무제한으로 해석했으므로 새 의미(등록 불가) 적용 전에 NULL로 보존한다.
UPDATE users SET guest_limit = NULL WHERE guest_limit = 0;

ALTER TABLE guests ADD COLUMN registered_by_name TEXT;

CREATE INDEX idx_guests_creator_date_status
  ON guests(created_by_user_id, date, status);

CREATE TABLE guest_limit_requests (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  requested_extra INTEGER NOT NULL CHECK (requested_extra BETWEEN 1 AND 10),
  approved_extra INTEGER NOT NULL DEFAULT 0 CHECK (approved_extra BETWEEN 0 AND requested_extra),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by_user_id TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_guest_limit_requests_venue_status_date
  ON guest_limit_requests(venue_id, status, date);

CREATE INDEX idx_guest_limit_requests_user_date
  ON guest_limit_requests(user_id, date);

CREATE UNIQUE INDEX idx_guest_limit_requests_one_pending
  ON guest_limit_requests(user_id, date)
  WHERE status = 'pending';
