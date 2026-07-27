---
title: MIGRATION STATUS - Cloudflare Workers 전환 완료 보고
date: 2026-05-04
tags:
  - docs
  - migration
  - status
---

# ✅ [[Cloudflare Workers]] 마이그레이션 완료 보고서

> [!success] 마이그레이션 종료
> **완료일:** 2026-05-04
> **상태:** Phase 1~5 + DJ 도메인 제거 + 타입 안전성 정비 완료
> **구 시스템:** Supabase + Cloudflare Pages (정적)
> **신 시스템:** Cloudflare Workers + D1 + KV (SSR, OpenNext)

---

## ✅ 완료된 전체 작업

### 인프라 전환
- [x] `wrangler.toml` [[D1]]/KV 바인딩 실제 ID 입력
- [x] [[D1]] / KV 리소스 [[Cloudflare]] 대시보드에 생성
- [x] `@opennextjs/cloudflare` OpenNext 어댑터 통합 (`next.config.ts`, `open-next.config.ts`)
- [x] `package.json` 배포 스크립트 (`build:worker`, `deploy`, `cf:preview`)

### 데이터베이스
- [x] Drizzle ORM + D1(SQLite) 전환 — Prisma/Supabase 잔존 흔적 0건
- [x] `migrations/0001_init.sql` ~ `0007_migration_metadata.sql` 순차 마이그레이션 관리
- [x] `migrations/0003_add_created_by_user.sql` — `guests.created_by_user_id` 컬럼 추가
- [x] DJ 도메인 제거: `djs` 테이블 드롭, `guests.dj_id` 컬럼 드롭 (`0004_drop_djs.sql`)
- [x] `migrations/0007_migration_metadata.sql` — Supabase Auth legacy id 및 reset-link 이관 상태 추적 컬럼 추가
- [x] `lib/database.types.ts` 레거시 Supabase 타입 파일 삭제

### 인증
- [x] NextAuth 제거 → 자체 JWT (`jose`) + KV 세션 인증
- [x] `middleware.ts` — JWT 검증 및 경로별 RBAC (`/admin`, `/door`)
- [x] `middleware.ts` — `/guest?token=` 외부 DJ 토큰 예외 처리
- [x] JWT + KV 세션 + D1 active/role 재검증 구조 도입 (`lib/auth/server.ts`, `middleware.ts`)
- [x] `.dev.vars`에 `JWT_SECRET` 설정

### API / 코드 품질
- [x] API 도메인 모듈화 (`lib/api/{guests,users,venues,external-links,email}.ts`) — Phase 5
- [x] `app/api/internal/sync-guest/route.ts` Shared Secret 헤더 검증 적용
- [x] `app/api/admin/migrate/route.ts` super_admin 역할 JWT 검증 적용
- [x] `eslint.config.mjs`에 `@typescript-eslint/no-explicit-any: "error"` 추가
- [x] `worker-configuration.d.ts` 생성 — `CloudflareEnv` 글로벌 인터페이스 augment
- [x] `lib/api/*.ts` 전체 `any` 캐스트 제거 (`getCloudflareContext()` 직접 사용)
- [x] `next.config.ts` `ignoreBuildErrors: true` 제거
- [x] DJ 도메인 데드코드 제거 (`lib/api/djs.ts`, `lib/api/types.ts` DJ 타입)

### 기능 구현
- [x] AWS SES v2 이메일 발송 (`lib/api/email.ts`)
- [x] 비밀번호 재설정 플로우 (`password_reset_tokens` 테이블 + API, token hash 저장)
- [x] 유저 마이그레이션 UI (`LegacyUserMigration` 컴포넌트)
- [x] Supabase snapshot export / 검증 / D1 import SQL 생성 스크립트 (`scripts/migration/*.mjs`)
- [x] Service Binding 수신 엔드포인트 (`/api/internal/sync-guest`)

### 환경 설정
- [x] `.env.example` 생성 (Cloudflare API 토큰용)
- [x] `.dev.vars.example` 생성 (Worker 시크릿 플레이스홀더)
- [x] `wrangler.toml [vars]` — `NEXT_PUBLIC_APP_URL` 추가

### 문서
- [x] `.docs/DEPLOYMENT.md` Cloudflare Workers 기준 현행화
- [x] `.docs/TECH_SPEC.md` 신규 작성 (구 README 대체 + 확장)
- [x] 루트 `README.md` 신규 작성

---

## 🔧 현재 후속 과제 / 감사 포인트

### 수동 실행 필요 (1회성)
- [ ] **Super Admin 계정 로컬 D1 부트스트랩** — 최초 배포 후 wrangler d1 execute로 직접 INSERT
- [ ] **운영 D1 마이그레이션 적용** — 2026-07-27 확인 기준 remote에는 `0003`~`0007` 미적용
- [ ] **실제 Supabase snapshot export/import dry-run** — `SUPABASE_D1_DATA_MIGRATION_PLAN.md` 절차 기준

### 보안/아키텍처 후속 과제
- [ ] 로그인 및 비밀번호 재설정 요청 rate limit 도입 (`app/api/auth/login/route.ts`, `app/api/auth/reset-password/route.ts`) [2026-06-25 완료]
- [ ] 비밀번호 변경/재설정 시 기존 KV 세션 일괄 무효화 [2026-06-25 완료 — `session_version` 기반]
- [x] reset token 소비를 단일 조건부 UPDATE로 원자화 [2026-06-25 완료]
- [x] `/api/admin/migrate`를 `requireRole(["super_admin"])` 경로로 통일 [2026-06-25 완료]
- [x] 외부 DJ 링크 생성 시 `expiresAt` 기본값 강제 [2026-06-25 완료 — event day + 1일, fallback 7일]

### 개발/운영 환경 후속 과제
- [ ] Docker 컨테이너 기준 `npm run lint` 복구 (`eslint.config.mjs` import 호환성 점검)
- [ ] 컨테이너 Next 버전/의존성 드리프트 제거 후 compose 기준 build/lint 재검증

---

## 📋 현재 검증 상태

2026-07-27 기준 확인됨:

- [x] 호스트 기준 `npm run build` 통과
- [x] 호스트 기준 `npm run lint` 통과
- [x] OpenNext Cloudflare Worker 빌드 검증 완료 — `proxy.ts`가 Next 16 Node runtime으로 처리되어, Cloudflare 배포 호환성을 위해 `middleware.ts` 유지
- [x] 로컬 D1 `0001`~`0007` 마이그레이션 적용 통과
- [x] sample Supabase snapshot → 검증 → D1 import SQL/reset link 생성 → local D1 import 확인
- [x] `git diff --check` 통과
- [ ] Docker compose 기준 `npm run lint` 통과
- [ ] Docker compose 기준 `npm run build`가 호스트와 동일한 Next 16/의존성 상태에서 재검증됨
