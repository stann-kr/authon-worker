# Authon Worker

클럽/바/라운지 등 베뉴의 게스트 리스트 관리 시스템.
DJ 게스트 등록 → Door 스태프 체크인 → Admin 전체 관리를 단일 플랫폼에서 처리.

운영 계정 없이 제품의 핵심 흐름을 살펴보려면 실행 후 `/demo`의 인터랙티브 포트폴리오 샌드박스를 사용할 수 있다. 가상 계정으로 로그인해 역할별 화면을 체험하며, 데모 변경은 브라우저에만 저장되고 운영 API와 데이터베이스에 연결되지 않는다.

**스택:** Next.js 16 (App Router) · Cloudflare Workers + D1 + KV · Drizzle ORM · JWT 자체 인증 · AWS SES

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

포트폴리오 데모: http://localhost:3000/demo

---

## 주요 문서

| 문서 | 내용 |
|------|------|
| [문서 안내](docs/README.md) | 공개 문서 구성과 읽는 순서 |
| [기술 명세서](docs/TECH_SPEC.md) | 아키텍처, 스키마, 환경변수, 개발 명령어 전체 |
| [디자인 시스템](docs/DESIGN_SYSTEM.md) | UI 원칙, 타이포그래피, 색상과 공용 컴포넌트 규칙 |
| [트러블슈팅](docs/TROUBLESHOOTING.md) | 이슈 해결 이력 |
| [변경 이력](docs/CHANGE_LOG.md) | 릴리스 이력 |
