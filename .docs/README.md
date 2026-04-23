# Authon — Venue Guest Management System (Worker)

클럽/바/라운지 등 베뉴의 게스트 리스트를 관리하는 풀스택 웹 애플리케이션.
DJ가 게스트를 등록하고, Door 스태프가 체크인하며, Admin이 전체를 관리함.

본 프로젝트(`authon-worker`)는 기존 정적 배포(Supabase 기반)를 대체하는
**Cloudflare Workers (OpenNext) 기반 SSR 애플리케이션**임.

---

## 기술 스택

| 구분         | 기술                                           |
| ------------ | ---------------------------------------------- |
| 프레임워크   | Next.js 15 (App Router, SSR)                   |
| 배포 어댑터  | `@opennextjs/cloudflare`                       |
| 언어         | TypeScript                                     |
| 스타일링     | Tailwind CSS v3                                |
| 데이터베이스 | Cloudflare D1 (SQLite) + Drizzle ORM           |
| 세션/캐시    | Cloudflare KV                                  |
| 인증         | 자체 JWT (`jose`) + 비밀번호 해싱 (`bcryptjs`) |
| 이메일       | AWS SES v2 (`aws4fetch`)                       |
| 개발 환경    | Docker Compose (로컬 런타임 없음)              |

---

## 아키텍처 개요

```
Host (macOS / Apple Silicon)
│
├── Docker: web (Node 20 / linux/arm64, port 3000)
│   ├── Next.js SSR Dev Server
│   ├── Miniflare (Cloudflare 로컬 에뮬레이터)
│   │   ├── D1 Local  (.wrangler/state/v3/d1)
│   │   └── KV Local  (.wrangler/state/v3/kv)
│   └── 환경변수: .dev.vars + .env (docker-compose 주입)
│
└── Cloudflare Network (운영)
    ├── Workers (OpenNext 번들)
    ├── D1 Database (authon-db)
    └── KV Namespace (SESSIONS)
```

### 데이터 흐름 (Server Actions)
- 클라이언트 → `lib/api/` (도메인별 분리된 API) → Drizzle ORM → D1
  - `guests.ts`, `users.ts`, `venues.ts`, `djs.ts`, `external-links.ts`
- 인증: `app/api/auth/login/route.ts` → JWT 발급 → HTTP-Only 쿠키
- 세션: KV에 `session:{sessionId}` 저장 (24h TTL)
- 미들웨어: `middleware.ts` → JWT 검증 → 경로별 RBAC
- Terminal 연동: `terminal-2` → Service Binding → `/api/internal/sync-guest`

---

## 역할 및 접근 권한

| 역할          | 접근 스코프               | 설명                              |
| ------------- | ------------------------- | --------------------------------- |
| `super_admin` | guest, door, admin, venue | 플랫폼 전체 관리자. 베뉴 독립적  |
| `venue_admin` | guest, door, admin        | 특정 베뉴 관리자                  |
| `door_staff`  | door, guest               | 도어 스태프 (체크인 담당)         |
| `staff`       | guest                     | 스태프 (게스트 등록 가능)         |
| `dj`          | guest                     | DJ (게스트 등록 가능)             |

---

## 페이지 구조

### 공개 페이지 (인증 불필요)

| 경로               | 설명                                          |
| ------------------ | --------------------------------------------- |
| `/auth/login`      | 로그인 (이메일/비밀번호)                      |
| `/guest?token=xxx` | 외부 DJ 게스트 등록 (토큰 기반)               |
| `/auth/reset-password?token=xxx` | 비밀번호 재설정              |

### 보호 페이지 (JWT 필수)

| 경로       | 필요 스코프 | 설명                                                          |
| ---------- | ----------- | ------------------------------------------------------------- |
| `/`        | 로그인      | 대시보드 (접근 가능 메뉴 표시)                                |
| `/guest`   | `guest`     | DJ 게스트 등록 — 날짜별 게스트 추가/삭제, 게스트 리밋 적용   |
| `/door`    | `door`      | 도어 체크인 — DJ별 필터, 게스트 체크인 (pending → checked)   |
| `/admin`   | `admin`     | 관리자 — 게스트/외부링크/유저/베뉴 관리                       |
| `/profile` | 로그인      | 프로필 편집 (이름, 비밀번호 변경)                             |

---

## 데이터베이스 스키마 (D1 / SQLite)

| 테이블                | 주요 컬럼                                                                    |
| --------------------- | ---------------------------------------------------------------------------- |
| `venues`              | id, name, type, address, active                                              |
| `users`               | id, email, password_hash, name, role, venue_id, guest_limit, active          |
| `djs`                 | id, venue_id, user_id, name, event, active                                   |
| `external_dj_links`   | id, venue_id, token, dj_name, date, max_guests, used_guests, active          |
| `guests`              | id, venue_id, name, status, date, dj_id, external_link_id, created_by_user_id, source, terminal_request_id |
| `check_ins`           | id, guest_id, checked_by, checked_at                                         |
| `password_reset_tokens` | id, user_id, token, expires_at, used                                       |

마이그레이션 파일: `migrations/` 디렉토리 (Wrangler D1 Migrations 관리)

---

## 개발 환경 설정

### 사전 요구 사항

- Docker Desktop (Apple Silicon 호환)

> **주의:** 로컬에 Node.js 런타임 없음. 모든 명령어는 Docker 컨테이너를 통해 실행.

### 시작하기

```bash
# 1. 환경 변수 설정
cp .env.example .env           # Cloudflare API 토큰 입력
cp .dev.vars.example .dev.vars # JWT_SECRET 및 기타 시크릿 입력

# 2. Docker 컨테이너 빌드 및 서버 실행
docker compose up

# 3. 최초 1회: DB 마이그레이션 적용
docker compose run --rm web npm run db:migrate:local

# 4. 최초 1회: Super Admin 부트스트랩 (private 문서 참고)
# http://localhost:3000 접속
```

### 개발 명령어

| 작업                     | 명령어                                                                      |
| ------------------------ | --------------------------------------------------------------------------- |
| 서버 구동                | `docker compose up`                                                         |
| 패키지 설치              | `docker compose run --rm web npm install <패키지>`                          |
| DB 스키마 생성(Drizzle)  | `docker compose run --rm web npm run db:generate`                           |
| DB 로컬 마이그레이션     | `docker compose run --rm web npm run db:migrate:local`                      |
| DB 운영 마이그레이션     | `docker compose run --rm web npm run db:migrate:remote`                     |
| DB 상태 조회             | `docker compose run --rm web npx wrangler d1 execute authon-db --local --command="SELECT name FROM sqlite_master WHERE type='table';"`|
| 워커 빌드 테스트         | `docker compose run --rm web npm run build:worker`                          |
| 린트 확인                | `docker compose run --rm web npm run lint`                                  |
| 쉘 접속                  | `docker compose run --rm web sh`                                            |

---

## 환경 변수

`.dev.vars` (로컬 Miniflare 바인딩용) 및 `.env` (Docker Compose 주입용)에 설정.
운영 환경은 Cloudflare Dashboard → Worker → Settings → Variables에 암호화 저장.

| 변수                       | 위치            | 설명                                      |
| -------------------------- | --------------- | ----------------------------------------- |
| `JWT_SECRET`               | `.dev.vars`     | JWT 서명 시크릿 (필수, 32자 이상 권장)    |
| `TERMINAL_VENUE_ID`        | `.dev.vars`     | terminal-2 연동 대상 베뉴 ID              |
| `NEXT_PUBLIC_APP_URL`      | `.dev.vars`     | 이메일 내 비밀번호 재설정 링크 기본 URL   |
| `AWS_SES_ACCESS_KEY`       | `.dev.vars`     | AWS SES IAM 액세스 키                     |
| `AWS_SES_SECRET_KEY`       | `.dev.vars`     | AWS SES IAM 시크릿 키                     |
| `AWS_SES_REGION`           | `.dev.vars`     | AWS SES 리전 (예: `ap-northeast-2`)       |
| `AWS_SES_FROM_EMAIL`       | `.dev.vars`     | SES 발신자 이메일 (SES 인증된 주소)       |
| `CLOUDFLARE_API_TOKEN`     | `.env`          | Wrangler CLI 인증용 API 토큰              |
| `CLOUDFLARE_ACCOUNT_ID`    | `.env`          | Cloudflare 계정 ID                        |
| `NEXT_PUBLIC_BRAND_NAME`   | `.dev.vars`     | 서비스 브랜드명 (예: `Authon`)            |
| `NEXT_PUBLIC_BRAND_TAGLINE`| `.dev.vars`     | 브랜드 서브타이틀                         |
| `NEXT_PUBLIC_BRAND_FOOTER` | `.dev.vars`     | 푸터 문구                                 |

자세한 내용은 `.env.example` 및 `.dev.vars.example` 참고.

---

## 라이선스

Private — stann-kr/authon-worker
