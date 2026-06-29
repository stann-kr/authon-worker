---
title: Security Remediation Plan
date: 2026-06-25
tags:
  - docs
  - security
  - remediation
---

# Authon Worker 보안/아키텍처 Remediation Plan

## 이번 턴에서 즉시 적용한 항목

### P0-1. 로그인 brute-force / reset abuse 완화
- 로그인: IP + email 기준 KV rate limit 추가
  - 파일: `app/api/auth/login/route.ts`, `lib/auth/rate-limit.ts`
  - 정책: 15분 동안 5회 초과 시 429 + `Retry-After`
- 비밀번호 재설정 요청: IP + email 기준 KV rate limit 추가
  - 파일: `app/api/auth/reset-password/route.ts`, `lib/auth/rate-limit.ts`
  - 정책: 1시간 동안 3회 초과 시 429 + `Retry-After`

### P0-2. 비밀번호 변경/재설정 시 기존 세션 무효화
- `users.session_version` 컬럼 추가
  - 파일: `migrations/0006_session_version_and_security.sql`, `lib/db/schema.ts`
- 로그인 시 JWT claim `sv` + KV 세션 `sessionVersion` 저장
- `requireAuth()`에서 JWT/KV/DB의 sessionVersion 일치 검증
- 비밀번호 변경/재설정 시 `session_version = session_version + 1`
- 프로필 비밀번호 변경 시 현재 쿠키와 KV 세션도 즉시 삭제 후 재로그인 유도

## 이번 턴에서 함께 줄인 위험

### P1-1. reset token 소비 원자화 강화
- 기존: SELECT 후 별도 batch update
- 변경: `UPDATE password_reset_tokens SET used = 1 WHERE token = ? AND used = 0 AND expires_at > ?`
- 효과: 동시 요청에서 동일 토큰 중복 사용 가능성 축소

## 아직 남아 있는 후속 과제

### P1. 중앙 인증 경로 통일
- 대상: `app/api/admin/migrate/route.ts`
- 상태: 2026-06-25 완료
- 변경: 수동 JWT role 검사 제거, `requireRole(["super_admin"])` 재사용

### P1. 외부 DJ 링크 만료 강제
- 대상: `lib/api/external-links.ts`
- 상태: 2026-06-25 완료
- 변경: 생성 시 기본 만료시간 강제
  - `date`가 있으면 event day 종료 후 +1일
  - 없으면 생성 시점 기준 7일 TTL

### P2. Rate limit 저장소 분리 검토
- 현재는 `SESSIONS` KV namespace를 세션/레이트리밋이 함께 사용
- 규모가 커지면 `RATE_LIMITS` 전용 KV namespace 분리 고려

### P2. 감사/관측성 확장
- 로그인 실패, reset 요청, 429 이벤트에 대한 구조화 로그 추가
- 운영 대시보드에서 abuse 징후 추적 가능하도록 이벤트 필드 정리

## 검증 체크리스트

- [ ] 로그인 6회 실패 시 429 반환 확인
- [ ] reset-password 4회 요청 시 429 반환 확인
- [ ] 비밀번호 변경 후 기존 세션으로 보호 페이지 접근 차단 확인
- [ ] reset-password 완료 후 이전 세션 접근 차단 확인
- [ ] D1 local/remote에 `session_version` 마이그레이션 적용 확인
- [ ] Docker compose 기준 lint/build 재검증
