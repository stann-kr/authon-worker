-- 자주 조회되는 컬럼에 인덱스 추가 (풀스캔 방지)

CREATE INDEX IF NOT EXISTS idx_guests_venue_date ON guests(venue_id, date);
CREATE INDEX IF NOT EXISTS idx_guests_external_link ON guests(external_link_id);
CREATE INDEX IF NOT EXISTS idx_guests_created_by ON guests(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_external_dj_links_venue ON external_dj_links(venue_id);
CREATE INDEX IF NOT EXISTS idx_users_venue ON users(venue_id);
