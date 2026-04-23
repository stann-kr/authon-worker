# 🚀 Cloudflare Workers 마이그레이션 후 TODO (업데이트됨)

> **최종 업데이트:** 2026-04-23
> **상태:** 코드베이스 감사 완료 → Phase 1~4 수정 작업 진행 중

---

## ✅ 완료된 항목

- [x] `wrangler.toml` D1/KV 바인딩 실제 ID 입력
- [x] `.dev.vars`에 `JWT_SECRET` 설정
- [x] D1 / KV 리소스 Cloudflare에 생성
- [x] AWS SES 연동 (`lib/api/email.ts`) 구현
- [x] 비밀번호 재설정 플로우 구현 (`password_reset_tokens` 테이블 + API)
- [x] 유저 마이그레이션 UI (`LegacyUserMigration` 컴포넌트)
- [x] 코드베이스 전체 감사 (2026-04-23)
- [x] API 도메인 모듈화 (Phase 5)
- [x] 전역 any 타입 제거 및 strict lint 설정
- [x] 컴포넌트 임포트 경로 전면 수정

---

## 🔧 수정 필요 항목

### Phase 1: 긴급 (앱 실행 불가 해결)
- [ ] `package.json` `db:migrate` 스크립트 교체 → `db:migrate:local` / `db:migrate:remote`
- [ ] 로컬 D1에 마이그레이션 실제 적용 (`db:migrate:local` 실행)
- [ ] Super Admin 계정 로컬 D1 부트스트랩
- [ ] `.env.example` 신규 생성 (플레이스홀더)
- [ ] `.dev.vars.example` 신규 생성 (플레이스홀더)

### Phase 2: 스키마 정합성
- [ ] `migrations/0003_add_created_by_user.sql` — `guests.created_by_user_id` 컬럼 추가
- [ ] `lib/db/schema.ts` — `createdByUserId` 필드 추가
- [ ] `lib/api/guests.ts` — `createGuest()` INSERT에 `createdByUserId` 포함
- [ ] `lib/api/guests.ts` — `fetchAllGuests()` `.where()` 체이닝 버그 수정
- [ ] `lib/database.types.ts` — 레거시 Supabase 타입 파일 삭제

### Phase 3: 보안 강화
- [ ] `middleware.ts` — `/guest?token=` 외부 DJ 예외 처리 추가
- [ ] `middleware.ts` — JWT_SECRET 폴백값(`"default_secret_for_local_dev"`) 제거
- [ ] `app/api/internal/sync-guest/route.ts` — Shared Secret 헤더 검증 추가
- [ ] `app/api/admin/migrate/route.ts` — super_admin 역할 JWT 검증 추가

### Phase 4: 환경변수 / 이메일 연동
- [ ] `wrangler.toml` — `[vars]` 섹션에 `TERMINAL_VENUE_ID`, `NEXT_PUBLIC_APP_URL` 추가
- [ ] `lib/api/email.ts` — `process.env.*` → Cloudflare `env` 바인딩 방식으로 전환
- [ ] `lib/auth.ts` — `auth_user_id` 레거시 필드 제거, `User` 인터페이스 현행화
### Phase 5: 코드 품질 개선 (완료)
- [x] `lib/api/guests.ts` 도메인별 분리 (`users`, `venues`, `djs`, `external-links`)
- [x] any 타입 제거 및 명시적 타입 정의 적용
- [x] `eslint.config.mjs`에 `@typescript-eslint/no-explicit-any: "error"` 규칙 추가
- [x] unknown 에러 핸들링 패턴 적용
---

## 📋 검증 포인트

코드 수정 후 아래 흐름이 정상 동작하는지 확인:

- [ ] 로그인 → 대시보드 이동
- [ ] 게스트 등록 → 등록자 이름 표시 (createdByUserId 반영 확인)
- [ ] Door 페이지 DJ별 필터 동작
- [ ] 외부 DJ 링크 (`/guest?token=xxx`) 로그인 없이 접근 가능
- [ ] 로그아웃 → 쿠키 삭제 확인
- [ ] 비밀번호 변경 (`/profile` → CHANGE PASSWORD)
- [ ] 유저 마이그레이션 → 비밀번호 재설정 이메일 발송 확인
