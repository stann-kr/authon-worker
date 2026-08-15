# Authon Worker

클럽/바/라운지 등 베뉴의 게스트 리스트 관리 시스템.
DJ 게스트 등록 → Door 스태프 체크인 → Admin 전체 관리를 단일 플랫폼에서 처리.

**스택:** Next.js 16 (App Router) · Cloudflare Workers + D1 + KV · Drizzle ORM · JWT 자체 인증 · AWS SES

---

## 빠른 시작

```bash
# 1. Node 24와 로컬 Worker 시크릿 준비
cp .dev.vars.example .dev.vars

# 2. Docker 컨테이너 기동
docker compose up

# 3. 최초 1회: DB 마이그레이션
docker compose run --rm web npm run db:migrate:local
```

접속: http://localhost:3000

기본 `web` 컨테이너에는 Cloudflare account ID나 API token을 전달하지 않는다. 승인된 production 작업만 `.env`의 credential과 `AUTHON_PRODUCTION_INTENT=1`을 준비한 뒤 `ops` profile에서 명시적으로 실행한다.

```bash
docker compose --profile ops run --rm ops npm run deploy:prod
```

로컬 release-candidate 검증은 `npm run verify:release` 한 명령으로 실행한다.

원격 build는 하나의 `authon-worker`에서 branch별로 분리한다. `dev` push는 `npm run verify:release` 뒤 `dev` tag의 traffic 미배정 Worker version만 업로드하며 공개 preview URL이나 production traffic을 만들지 않는다. `main` merge는 별도 승인 후 같은 gate를 통과해 production deployment를 갱신한다. Worker version upload와 D1 migration·secret·data 변경은 서로 다른 운영 경계다.

적용 이력의 권위는 `migrations/`의 순차 manual D1 SQL이다. `npm run db:generate`는 `.docs/generated-migrations/`에 검토용 baseline만 만들며, `npm run check:migrations`가 임시 SQLite에서 manual 이력과 현재 Drizzle schema의 구조 호환성을 비교한다. 이미 적용된 migration을 generator 결과로 덮어쓰지 않는다.

---

## 주요 문서

| 문서 | 내용 |
|------|------|
| [문서 안내](docs/README.md) | 공개 문서 구성과 읽는 순서 |
| [기술 명세서](docs/TECH_SPEC.md) | 아키텍처, 스키마, 환경변수, 개발 명령어 전체 |
| [디자인 시스템](docs/DESIGN_SYSTEM.md) | UI 원칙, 타이포그래피, 색상과 공용 컴포넌트 규칙 |
| [트러블슈팅](docs/TROUBLESHOOTING.md) | 이슈 해결 이력 |
| [변경 이력](docs/CHANGE_LOG.md) | 릴리스 이력 |
