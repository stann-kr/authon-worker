-- migrations/0004_drop_djs.sql
-- DJ 도메인 제거: guests.dj_id 컬럼 삭제 및 djs 테이블 드롭
-- External DJ 링크 기반 초대 방식으로 완전 전환 (external_dj_links 테이블 유지)

ALTER TABLE guests DROP COLUMN dj_id;

DROP TABLE IF EXISTS djs;
