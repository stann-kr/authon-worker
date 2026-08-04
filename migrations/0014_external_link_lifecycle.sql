-- 외부 게스트 링크의 사용 이력과 삭제 감사 정보 보존

ALTER TABLE external_dj_links
  ADD COLUMN deleted_at TEXT;

ALTER TABLE external_dj_links
  ADD COLUMN deleted_by TEXT REFERENCES users(id);

CREATE INDEX idx_external_links_venue_deleted_created
  ON external_dj_links (venue_id, deleted_at, created_at);
