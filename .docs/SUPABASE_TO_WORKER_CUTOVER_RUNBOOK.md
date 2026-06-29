---
title: Supabase to Worker Cutover Runbook
date: 2026-06-25
tags:
  - docs
  - migration
  - runbook
  - cutover
---

# Supabase → Cloudflare Worker Cutover Runbook

이 문서는 기존 서비스 중인 Supabase + Cloudflare Pages(정적) 기반 Authon v1을
Cloudflare Workers + D1 + KV 기반 Authon Worker v2로 전환할 때의 실제 실행 순서를 정리한다.

기준 구조:
- 구 시스템: Supabase Auth + Postgres + Pages 정적 배포
- 신 시스템: OpenNext on Cloudflare Workers + D1 + KV + 자체 JWT 세션 + AWS SES

관련 문서:
- `TECH_SPEC.md` — Supabase 의존 요소가 현재 Worker 구조에서 어떻게 대체됐는지
- `DEPLOYMENT.md` — 빌드/배포/도메인/운영 절차
- `MIGRATION_TODO.md` — 전환 완료 범위와 남은 후속 과제
- `REMEDIATION_PLAN.md` — 전환 이후 보안 보강 계획/적용 현황

---

## 0. 목표와 컷오버 원칙

목표:
- 사용자 입장에서는 서비스 주소/핵심 기능이 유지된 상태로 백엔드 구조만 교체
- Supabase Auth 의존을 제거하고 Worker 자체 인증/세션으로 전환
- guest / door / admin / external link 흐름을 신 시스템에서 동일하거나 더 안전하게 제공

원칙:
- 데이터 스키마 전환보다 먼저 “기능 대체 매핑”이 완료되어야 한다.
- 배포 전 로컬 D1 마이그레이션 + 앱 빌드 검증이 선행되어야 한다.
- 사용자 비밀번호는 평문 이관하지 않고, 레거시 유저는 reset-password 링크 기반으로 전환한다.
- DNS/도메인 전환은 마지막 단계에서 수행한다.
- 롤백은 “도메인/트래픽 복귀 + 데이터 freeze 상태 보존” 기준으로 준비한다.

---

## 1. 사전 준비 체크리스트

### 1-1. Cloudflare 리소스 준비
- [ ] Worker 생성
- [ ] D1 database 생성 (`authon-db`)
- [ ] KV namespace 생성 (`SESSIONS`)
- [ ] Assets binding 준비
- [ ] `wrangler.toml`에 실제 `database_id`, `kv namespace id` 반영

### 1-2. 시크릿/환경변수 준비
로컬/원격에 아래 값이 준비되어 있어야 한다.

필수:
- [ ] `JWT_SECRET`
- [ ] `NEXT_PUBLIC_APP_URL`
- [ ] `AWS_SES_ACCESS_KEY`
- [ ] `AWS_SES_SECRET_KEY`
- [ ] `AWS_SES_REGION`
- [ ] `AWS_SES_FROM_EMAIL`

운영 CLI용:
- [ ] `CLOUDFLARE_API_TOKEN`
- [ ] `CLOUDFLARE_ACCOUNT_ID`

### 1-3. Wrangler 인증 확인
현재 Hermes 세션 기준 실제 확인 결과:
- `npm exec wrangler whoami` → `Not logged in`
- 따라서 remote D1 확인/적용 전 Wrangler 인증 복구가 필요함

권장 점검 순서:
```bash
cd /Users/stann/dev/authon-worker
npm exec wrangler whoami
npm exec wrangler d1 list
npm exec wrangler d1 migrations list authon-db --remote
```

정상이어야 하는 상태:
- `whoami`가 account/email 반환
- `d1 list`에 `authon-db` 노출
- `migrations list ... --remote`가 remote DB 상태 반환

실패 시 확인 항목:
```bash
printenv CLOUDFLARE_API_TOKEN
printenv CLOUDFLARE_ACCOUNT_ID
cat .env | grep CLOUDFLARE_
```

복구 액션 예시:
- Cloudflare API token 재발급/재설정
- `wrangler login` 또는 토큰 기반 인증 재구성
- Hermes/쉘에서 올바른 `.env` 로드 여부 확인

---

## 2. 기능 대체 매핑 점검

컷오버 전에 아래 기능이 Supabase 없이 모두 대체되었는지 확인한다.

- [x] 로그인/세션: 자체 JWT + KV
- [x] 사용자 프로필: D1 `users`
- [x] 비밀번호 검증/재설정: PBKDF2/bcrypt 호환 + D1 reset tokens + SES
- [x] 역할/권한 제어: `requireAuth()` / `requireRole()` + venue scoping
- [x] 외부 DJ 링크: `external_dj_links.token`
- [x] 내부 동기화: Worker route + shared secret
- [x] 레거시 유저 이관 경로: `/api/admin/migrate`

참고: 상세 매핑은 `TECH_SPEC.md`의 “Supabase → Worker 대체 매핑” 표를 기준으로 본다.

---

## 3. 데이터 마이그레이션 준비

### 3-1. D1 스키마 적용
로컬에서 먼저 전체 마이그레이션을 검증한다.

```bash
cd /Users/stann/dev/authon-worker
npm run db:migrate:local
npm run build
npm run lint
```

현재 기준 로컬 검증 완료 항목:
- `0001_init.sql` ~ `0006_session_version_and_security.sql`
- 호스트 기준 `npm run build` 통과
- 호스트 기준 `npm run lint` 통과

### 3-2. 원격 D1 적용
Wrangler 인증 복구 후 실행:

```bash
cd /Users/stann/dev/authon-worker
npm run db:migrate:remote
```

적용 후 확인 권장:
```bash
npm exec wrangler d1 migrations list authon-db --remote
npm exec wrangler d1 execute authon-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

### 3-3. 레거시 데이터 추출 범위 정리
Supabase에서 직접 평문 비밀번호를 가져오지 않는다. 추출 대상은 다음에 제한한다.

권장 추출 대상:
- venues
- users의 프로필 필드
  - email
  - name
  - role
  - venue_id
  - guest_limit
  - active
- guests
- external_dj_links (필요 시)
- 운영상 필요한 최소 참조 데이터

비권장/금지:
- Supabase Auth 비밀번호 평문/재사용 가정
- 불필요한 auth 메타데이터 전체 복제

---

## 4. 레거시 유저 이관 절차

### 옵션 A. Admin UI 사용
1. super_admin으로 Worker 앱 로그인
2. `/admin` → `MIGRATE` 탭 진입
3. 레거시 유저 JSON 배열 입력
4. 이관 완료 후 자동 reset-password 메일 발송 확인

### 옵션 B. API 직접 호출
```bash
curl -X POST https://authon.yourdomain.com/api/admin/migrate \
  -H "Cookie: token=<JWT>" \
  -H "Content-Type: application/json" \
  -d '{"users": [{"email": "user@example.com", "name": "Example", "role": "dj", "guest_limit": 10}]}'
```

주의:
- 현재 `/api/admin/migrate`는 `requireRole(["super_admin"])`를 사용하므로
  JWT뿐 아니라 KV 세션/활성 사용자 상태까지 함께 검증한다.
- 이관 사용자는 reset-password 링크를 통해 새 인증 체계로 진입한다.

검증:
- [ ] 대상 user row가 D1 `users`에 생성됨
- [ ] `password_reset_tokens` row 생성됨
- [ ] SES 메일 발송 성공 또는 실패 상태가 추적됨
- [ ] 첫 reset 이후 로그인 가능

---

## 5. 애플리케이션 배포 순서

### 5-1. 배포 전 로컬 검증
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run build:worker`
- [ ] `npm run db:migrate:local`

### 5-2. Worker 배포
```bash
cd /Users/stann/dev/authon-worker
npm run deploy
```

### 5-3. 운영 시크릿/변수 확인
Cloudflare Dashboard 또는 Wrangler 기준으로 확인:
- [ ] `JWT_SECRET`
- [ ] `NEXT_PUBLIC_APP_URL`이 localhost가 아닌 운영 URL
- [ ] AWS SES 관련 4개 값
- [ ] 필요한 brand 변수

### 5-4. Custom Domain 연결
- [ ] Worker에 production domain 연결
- [ ] SSL 활성화 확인
- [ ] old Pages domain / route와 충돌 없는지 확인

---

## 6. 컷오버 당일 실행 순서

1. [ ] 구 시스템 변경 freeze 공지
2. [ ] 최종 Supabase 데이터 export
3. [ ] Worker 코드 최종 배포
4. [ ] remote D1 최종 마이그레이션 적용 확인
5. [ ] 레거시 유저 이관 실행
6. [ ] super_admin 부트스트랩/로그인 확인
7. [ ] smoke test 수행
8. [ ] domain/DNS를 Worker 기준으로 전환
9. [ ] external link / admin / door 주요 흐름 재확인
10. [ ] 운영 로그 관찰 및 초기 장애 대응 대기

---

## 7. 컷오버 후 smoke test

핵심 경로:
- [ ] `/auth/login` 진입
- [ ] super_admin 로그인
- [ ] `/admin` 접근
- [ ] `/guest`에서 guest 생성/삭제
- [ ] `/door`에서 check-in
- [ ] `/guest?token=...` 공개 링크 동작
- [ ] `/profile` 비밀번호 변경
- [ ] reset-password 이메일 수신/링크 동작
- [ ] `terminal-2` Service Binding 동기화

보안 확인:
- [ ] 로그인 rate limit 동작
- [ ] 비밀번호 변경 후 기존 세션 무효화 확인
- [ ] 외부 DJ 링크 만료 동작 확인
- [ ] venue-scoped 권한이 다른 venue 데이터에 접근하지 못함

---

## 8. 롤백 계획

롤백 조건 예시:
- 로그인/세션 체계 장애로 운영자 접근 불가
- D1 마이그레이션 불일치로 핵심 CRUD 실패
- SES/reset-password 실패로 사용자 전환 불가
- external link / door flow 장애로 현장 운영 불가

롤백 절차:
1. [ ] 도메인을 기존 Pages/Supabase 서비스로 복귀
2. [ ] Worker 쪽 새 데이터 쓰기 중지
3. [ ] 컷오버 시각 이후 발생한 데이터 차이 보존
4. [ ] 장애 원인 분류 (schema / auth / env / domain)
5. [ ] 복구 계획 수립 후 재컷오버 일정 잡기

중요:
- 컷오버 직전 final export를 남겨야 롤백 시점의 데이터 차이를 추적할 수 있다.
- v2에서 생성된 신규 데이터가 있으면 단순 DNS rollback만으로 끝나지 않으므로 delta 정리 계획이 필요하다.

---

## 9. 현재 기준 남은 운영 TODO

아직 확인/정리 필요한 항목:
- [ ] Wrangler 인증 복구 후 remote D1 실제 상태 확인
- [ ] remote D1에 `0006_session_version_and_security.sql` 적용 여부 확인
- [ ] Docker compose 기준 lint/build 드리프트 복구 및 재검증
- [ ] 운영용 `NEXT_PUBLIC_APP_URL` 실제 설정값 재확인
- [ ] Supabase export/import 포맷(실제 JSON shape) 별도 보존

---

## 10. 실행용 짧은 명령 묶음

```bash
cd /Users/stann/dev/authon-worker

# 1) 로컬 검증
npm run lint
npm run build
npm run build:worker
npm run db:migrate:local

# 2) Wrangler 인증 확인
npm exec wrangler whoami
npm exec wrangler d1 list
npm exec wrangler d1 migrations list authon-db --remote

# 3) 원격 마이그레이션
npm run db:migrate:remote

# 4) 원격 스키마 확인
npm exec wrangler d1 execute authon-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

이 문서는 “실행 순서” 기준 문서다. 구조 설명/근거는 `TECH_SPEC.md`, 상태 추적은 `MIGRATION_TODO.md`를 함께 본다.
