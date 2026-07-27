---
title: Supabase to D1 Data Migration Plan
date: 2026-07-27
tags:
  - docs
  - migration
  - supabase
  - d1
  - auth
---

# Supabase → D1 데이터 이전 계획

이 문서는 구 `authon`의 Supabase Auth/Postgres 데이터를 `authon-worker`의 Cloudflare D1/KV/JWT 구조로 옮길 때의 실제 데이터/인증 이전 방침을 기록한다.

## 현재 결론

- 앱/인증/D1 기반 개발은 대부분 완료되어 있다.
- 하지만 실제 운영 데이터 이전은 아직 완료되지 않았다.
- 운영 remote D1은 2026-07-27 확인 기준 일부 마이그레이션이 미적용 상태였고, 업무 데이터 row count는 0이었다.
- 기존 사용자 비밀번호는 Supabase Auth에서 직접 재사용/평문 이전하지 않는다.
- 기존 사용자는 reset-password/onboarding 링크로 새 Worker 인증 체계에 진입한다.

## 확인된 근거

### v1 `authon` 현황

- `/Users/stann/Dev/authon/lib/auth.ts`는 `supabase.auth.signInWithPassword()`로 로그인한다.
- `/Users/stann/Dev/authon/supabase/schema.sql`의 `public.users.auth_user_id`는 `auth.users(id)`를 참조한다.
- `public.users`에는 자체 `password_hash`가 없다.
- 핵심 업무 테이블은 `venues`, `users`, `guests`, `external_dj_links`이며, v1에는 `djs`도 존재한다.
- Supabase RLS는 JWT `app_metadata.app_role`, `app_metadata.app_venue_id`에 의존한다.

### v2 `authon-worker` 현황

- D1/KV binding: `wrangler.toml`의 `DB`, `SESSIONS`.
- 자체 인증: `app/api/auth/login/route.ts`, `lib/auth/server.ts`, `middleware.ts`.
- 비밀번호 재설정: `app/api/auth/reset-password/route.ts`, `password_reset_tokens`, AWS SES.
- 레거시 유저 이관 경로: `app/api/admin/migrate/route.ts`, `LegacyUserMigration`.
- 권한/RLS 대체: `requireAuth()` / `requireRole()` + `lib/api/*`의 venue scoping.

## 권장 인증 이전 방침

### 선택한 기본 방침: 강제 비밀번호 재설정

1. Supabase Auth의 기존 비밀번호/세션은 이전하지 않는다.
2. D1 `users`에는 기존 앱 user id를 최대한 보존한다.
3. Supabase Auth user id는 `legacy_auth_user_id`로 보관한다.
4. 이관 유저는 `migration_status = 'pending_reset'` 상태로 생성한다.
5. 사용자는 이메일 reset 링크에서 새 비밀번호를 설정한다.
6. reset 완료 시:
   - `password_hash` 갱신
   - `session_version` 증가
   - `migration_status`를 `active`로 전환
   - `password_set_at` 기록
   - reset token은 사용 처리

이 방침의 이유:

- Supabase Auth 내부 비밀번호 hash 포맷/접근성에 의존하지 않는다.
- 평문 비밀번호 이전을 가정하지 않는다.
- 운영/감사 관점에서 설명 가능성이 높다.
- D1/KV/JWT 자체 인증으로 완전히 전환하기 쉽다.

## D1 스키마 보강

`migrations/0007_migration_metadata.sql`에서 다음 필드를 추가한다.

| 필드 | 목적 |
| --- | --- |
| `legacy_auth_user_id` | Supabase Auth user id 감사/추적 |
| `migration_status` | `native`, `pending_reset`, `active` 등 이관 상태 |
| `migrated_at` | D1 이관 시각 |
| `password_set_at` | Worker 체계에서 비밀번호를 설정한 시각 |

`password_reset_tokens.token`에는 reset token 원문이 아니라 SHA-256 hash를 저장한다. URL에는 원문 token을 넣고, 서버에서 hash 후 조회한다.

## 데이터 이전 대상

필수:

- `venues`
- `users`
- `guests`
- `external_dj_links`

정책 결정 필요:

- `djs`: v2에서 DJ 도메인을 제거하고 `guests.dj_id`도 drop했으므로, historical 보존이 필요하면 별도 archive/export로만 보관한다.
- `user_applications`: 운영상 이력 보존 필요가 있으면 archive 대상. v2 runtime 필수 데이터는 아니다.

## 무손실 이전 원칙

- `id`를 새로 만들지 않고 기존 id를 보존한다.
- `users.auth_user_id`는 `legacy_auth_user_id`로 보존한다.
- `venue_id`, `created_by_user_id`, `external_link_id` 관계를 유지한다.
- `external_dj_links.token`은 그대로 보존한다. 기존 공개 링크 호환성 때문이다.
- `created_at`, `updated_at`, `status`, `check_in_time`, `date`, `active`, `guest_limit`을 보존한다.
- boolean은 D1에서 `0/1`로 변환한다.
- timestamp/date는 ISO string 또는 `YYYY-MM-DD` text로 보존한다.
- import 후 FK orphan, row count, `used_guests` drift를 검증한다.

## 구현된 다음 단계

2026-07-27에 다음 파일이 추가/수정되었다.

- `migrations/0007_migration_metadata.sql`
- `lib/db/schema.ts`
- `lib/auth/token.ts`
- `app/api/auth/reset-password/route.ts`
- `app/api/admin/migrate/route.ts`
- `scripts/migration/export-supabase-snapshot.mjs`
- `scripts/migration/verify-supabase-snapshot.mjs`
- `scripts/migration/generate-d1-import-sql.mjs`
- `package.json` migration scripts

### 스크립트 흐름

```bash
# 1. Supabase REST snapshot export
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run migration:export:supabase -- migration/supabase-snapshot.json

# 2. export된 snapshot의 FK/drift 사전 검증
npm run migration:verify:snapshot -- migration/supabase-snapshot.json

# 3. D1 import SQL + reset links 생성
NEXT_PUBLIC_APP_URL=https://authon.example.com \
  npm run migration:generate:d1-import -- \
  migration/supabase-snapshot.json \
  migration/d1-import.sql \
  migration/reset-links.json

# 4. local dry-run
npm run db:migrate:local
npm exec -- wrangler d1 execute authon-db --local --file=migration/d1-import.sql

# 5. 운영 적용은 별도 승인 후
npm run db:migrate:remote
npm exec -- wrangler d1 execute authon-db --remote --file=migration/d1-import.sql
```

## 현재 검증 결과

2026-07-27 호스트 기준:

- `npm run lint` 통과
- `npm run build` 통과
- `npm run build:worker` 통과
- `npm run db:migrate:local`로 `0001`~`0007` 적용 통과
- sample snapshot으로:
  - `migration:verify:snapshot` 통과
  - `migration:generate:d1-import` SQL/reset-link 생성 확인
  - local D1 import 확인: `users=1`, `migration_status='pending_reset'`, `legacy_auth_user_id` 보존, reset token hash 저장 확인

## 운영 전 남은 작업

1. 실제 Supabase project에 대해 snapshot export 실행.
2. `migration:verify:snapshot` 결과 확인 및 orphan/drift 있으면 먼저 정리.
3. D1 import SQL dry-run을 별도 local DB에서 수행.
4. remote D1 마이그레이션 `0003`~`0007` 적용.
5. 운영 D1 import는 사용자 승인 후 실행.
6. `reset-links.json`은 PII/credential성 파일로 취급하고 repo에 커밋하지 않는다.
7. SES 발송 또는 운영 공지 방식 결정.
8. smoke test:
   - super_admin 로그인
   - reset 링크로 migrated user 로그인
   - venue_admin scope
   - guest 생성/삭제
   - door check-in
   - external link flow
   - reset 후 기존 세션 무효화

## 리스크와 주의점

- remote D1은 2026-07-27 확인 기준 아직 최신 마이그레이션이 다 적용되지 않았다.
- `npm run build` / `build:worker`는 `.wrangler`를 삭제하므로 local D1 상태 확인 직전에는 다시 `npm run db:migrate:local`이 필요할 수 있다.
- `reset-links.json`에는 실제 reset URL이 들어가므로 절대 커밋하지 않는다.
- 운영 D1 import 전에는 반드시 Supabase write freeze 또는 최종 delta export 전략이 필요하다.
- `djs` 데이터는 v2 runtime schema에서 제거된 도메인이므로, 보존/삭제/아카이브 정책을 컷오버 전에 확정해야 한다.
