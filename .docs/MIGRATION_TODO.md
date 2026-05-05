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
- [x] `migrations/0001_init.sql` ~ `0004_drop_djs.sql` 순차 마이그레이션 관리
- [x] `migrations/0003_add_created_by_user.sql` — `guests.created_by_user_id` 컬럼 추가
- [x] DJ 도메인 제거: `djs` 테이블 드롭, `guests.dj_id` 컬럼 드롭 (`0004_drop_djs.sql`)
- [x] `lib/database.types.ts` 레거시 Supabase 타입 파일 삭제

### 인증
- [x] NextAuth 제거 → 자체 JWT (`jose`) + KV 세션 인증
- [x] `middleware.ts` — JWT 검증 및 경로별 RBAC (`/admin`, `/door`)
- [x] `middleware.ts` — `/guest?token=` 외부 DJ 토큰 예외 처리
- [x] `middleware.ts` — JWT_SECRET 폴백값 제거
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
- [x] 비밀번호 재설정 플로우 (`password_reset_tokens` 테이블 + API)
- [x] 유저 마이그레이션 UI (`LegacyUserMigration` 컴포넌트)
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

## 🔧 잔여 후순위 항목

### 수동 실행 필요 (1회성)
- [ ] **Super Admin 계정 로컬 D1 부트스트랩** — 최초 배포 후 wrangler d1 execute로 직접 INSERT

### 코드 개선 (후순위)
- [ ] `lib/api/email.ts` — `process.env.*` → Cloudflare `env` 바인딩 방식으로 전환
  - 현재: `process.env.AWS_SES_*`로 동작 중 (로컬에서 정상 동작)
  - 개선: `getCloudflareContext().env.AWS_SES_*` 방식으로 Workers 네이티브하게 변경

---

## 📋 검증 포인트

코드 수정 후 아래 흐름이 정상 동작하는지 확인:

- [ ] 로그인 → 대시보드 이동
- [ ] 게스트 등록 → 등록자 이름 표시 (createdByUserId 반영 확인)
- [ ] Door 페이지 체크인 동작
- [ ] 외부 DJ 링크 (`/guest?token=xxx`) 로그인 없이 접근 가능
- [ ] 로그아웃 → 쿠키 삭제 확인
- [ ] 비밀번호 변경 (`/profile` → CHANGE PASSWORD)
- [ ] 유저 마이그레이션 → 비밀번호 재설정 이메일 발송 확인
