---
title: README
date: 2026-06-25
tags:
  - docs
  - overview
  - authon-worker
---

# Authon Worker 문서 허브

이 디렉토리는 `authon-worker`의 구현/운영 문서를 모아둔 repo-local 문서 허브입니다.

## 핵심 문서

- [TECH_SPEC.md](TECH_SPEC.md) — 현재 아키텍처, Supabase → Worker 대체 구조, 데이터 모델, 인증 흐름
- [DEPLOYMENT.md](DEPLOYMENT.md) — Cloudflare Workers/D1/KV 배포 및 운영 절차
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — 실제 이슈와 해결 기록
- [CHANGE_LOG.md](CHANGE_LOG.md) — 코드/문서 변경 이력
- [MIGRATION_TODO.md](MIGRATION_TODO.md) — 전환 완료 범위와 남은 후속 과제/감사 포인트
- [SUPABASE_D1_DATA_MIGRATION_PLAN.md](SUPABASE_D1_DATA_MIGRATION_PLAN.md) — Supabase 운영 데이터 export/import, 기존 유저 reset-link 전환, D1 무손실 검증 계획
- [REMEDIATION_PLAN.md](REMEDIATION_PLAN.md) — Supabase 제거 이후 인증/세션 보안 보강 계획과 적용 상태
- [SUPABASE_TO_WORKER_CUTOVER_RUNBOOK.md](SUPABASE_TO_WORKER_CUTOVER_RUNBOOK.md) — 운영 중인 Supabase 서비스를 Worker/D1/KV 구조로 전환하는 실제 컷오버 순서

## 현재 상태 요약

- 런타임: Next.js 16 + OpenNext + Cloudflare Workers
- 데이터 저장: D1(SQLite) + Drizzle ORM
- 세션/인증: 자체 JWT + KV 세션 저장소
- 이메일: AWS SES
- 공개 토큰 플로우: 외부 DJ 링크(`/guest?token=...`)

## 이번 문서 정리 포인트 (2026-06-25)

- Next 16 `proxy.ts` 전환 시도 후 OpenNext Cloudflare 호환성 기준으로 `middleware.ts` 유지 결정 반영
- Supabase 기반 기능이 현재 Worker 구조에서 어떻게 대체되었는지 문서화
- stale migration status/운영 문구 정리
- 현재 감사 기준의 남은 보안/운영 리스크 정리
