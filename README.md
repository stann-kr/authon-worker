# Authon Worker

클럽/바/라운지 등 베뉴의 게스트 리스트 관리 시스템.
DJ 게스트 등록 → Door 스태프 체크인 → Admin 전체 관리를 단일 플랫폼에서 처리.

**스택:** Next.js 15 (App Router) · Cloudflare Workers + D1 + KV · Drizzle ORM · JWT 자체 인증 · AWS SES

---

## 빠른 시작

```bash
# 1. 환경 변수 설정
cp .env.example .env           # Cloudflare API 토큰
cp .dev.vars.example .dev.vars # JWT_SECRET 및 기타 시크릿

# 2. Docker 컨테이너 기동
docker compose up

# 3. 최초 1회: DB 마이그레이션
docker compose run --rm web npm run db:migrate:local
```

접속: http://localhost:3000

---

## 주요 문서

| 문서 | 내용 |
|------|------|
| [기술 명세서](.docs/TECH_SPEC.md) | 아키텍처, 스키마, 환경변수, 개발 명령어 전체 |
| [배포 가이드](.docs/DEPLOYMENT.md) | Workers 배포 절차, D1 마이그레이션, 운영 환경 설정 |
| [트러블슈팅](.docs/TROUBLESHOOTING.md) | 이슈 해결 이력 |
| [변경 이력](.docs/CHANGE_LOG.md) | 릴리스 이력 |
