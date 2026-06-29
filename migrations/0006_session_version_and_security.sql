-- 사용자 세션 버전 추가: 비밀번호 변경/재설정 시 전 세션 무효화에 사용
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
