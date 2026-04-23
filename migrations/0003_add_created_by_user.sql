-- migrations/0003_add_created_by_user.sql
-- guests 테이블에 created_by_user_id 컬럼 추가
-- DJ별 필터링 및 게스트 등록자 추적에 사용

ALTER TABLE guests ADD COLUMN created_by_user_id TEXT REFERENCES users(id);
