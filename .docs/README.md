# Authon — Venue Guest Management System (Worker)

클럽/바/라운지 등 베뉴의 게스트 리스트를 관리하는 풀스택 웹 애플리케이션입니다.  
DJ가 게스트를 등록하고, Door 스태프가 체크인하며, Admin이 전체를 관리합니다.

본 프로젝트(`authon-worker`)는 기존 정적 배포된 `authon`을 대체하는 **Cloudflare Workers (OpenNext) 기반의 SSR 애플리케이션**입니다.

---

## 기술 스택

| 구분         | 기술                                           |
| ------------ | ---------------------------------------------- |
| 프레임워크   | Next.js 15 (App Router, SSR)                   |
| 배포 어댑터  | `@opennextjs/cloudflare`                       |
| 언어         | TypeScript                                     |
| 스타일링     | Tailwind CSS                                   |
| 데이터베이스 | Cloudflare D1 (SQLite) + Drizzle ORM           |
| 세션/캐시    | Cloudflare KV                                  |
| 인증 로직    | 자체 JWT (`jose`) + 비밀번호 해싱 (`bcryptjs`) |
| 개발 환경    | Docker Compose (Docker-Only, 로컬 런타임 없음) |

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────┐
│  Host (macOS)                                       │
│  ┌───────────┐  볼륨 매핑 (./ → /app)               │
│  │  VS Code  │──────────────────┐                   │
│  └───────────┘                  ▼                   │
│  ┌──────────────────────────────────────────┐       │
│  │  Docker: web (Node 20, port 3000)       │       │
│  │  ├─ Next.js SSR App                     │       │
│  │  ├─ Cloudflare Miniflare (로컬 바인딩)  │       │
│  │  └─ D1 / KV 에뮬레이터                  │       │
│  └──────────────────────────────────────────┘       │
│                         │                           │
│                         ▼                           │
│          ┌──────────────────────────┐               │
│          │  Cloudflare Network      │               │
│          │  ├─ Workers (OpenNext)   │               │
│          │  ├─ D1 Database          │               │
│          │  └─ KV Namespace         │               │
│          └──────────────────────────┘               │
└─────────────────────────────────────────────────────┘
```

---

## 역할 및 접근 권한

| 역할          | 접근 스코프               | 설명                            |
| ------------- | ------------------------- | ------------------------------- |
| `super_admin` | guest, door, admin, venue | 플랫폼 전체 관리자. 베뉴 독립적 |
| `venue_admin` | guest, door, admin        | 특정 베뉴 관리자                |
| `door_staff`  | guest, door               | 도어 스태프 (체크인 담당)       |
| `staff`       | guest                     | 스태프 (게스트 등록 가능)       |
| `dj`          | guest                     | DJ (게스트 등록 가능)           |

- 인증: 자체 JWT 토큰 (HTTP-Only 쿠키 보관)
- 접근 제어: `middleware.ts`에서 경로별 Role 검증 및 리다이렉트
- 데이터 격리: Drizzle ORM 조회 시 `venueId` 필터링 (super_admin 제외)

---

## 페이지 구조

### 공개 페이지

| 경로                   | 설명                                              |
| ---------------------- | ------------------------------------------------- |
| `/`                    | 랜딩 페이지                                       |
| `/auth/login`          | 로그인 (이메일/비밀번호)                          |
| `/guest?token=xxx`     | 외부 DJ 게스트 등록 (토큰 기반, 인증 불필요)      |

### 보호 페이지

| 경로       | 필요 스코프 | 설명                                                           |
| ---------- | ----------- | -------------------------------------------------------------- |
| `/guest`   | `guest`     | DJ 게스트 등록 — 날짜별 게스트 추가/삭제, 게스트 리밋 적용     |
| `/door`    | `door`      | 도어 체크인 — DJ별 필터, 게스트 체크인 (`pending` → `checked`) |
| `/admin`   | `admin`     | 관리자 대시보드 (게스트, 외부 링크, 유저, 베뉴 관리)           |
| `/profile` | 로그인 필요 | 프로필 편집 (이름)                                             |

### 주요 데이터 플로우 (Server Actions)

- 클라이언트에서 데이터 Fetching 또는 Mutation이 필요할 때, 직접 API Route를 호출하는 대신 **Server Actions (`lib/api/guests.ts` 등에 구현된 Drizzle ORM 로직)**를 호출합니다.
- 데이터베이스 접근, 암호화 처리 등은 보안을 위해 Server 단에서만 수행됩니다.
- `terminal-2` 앱 연동: `/api/internal/sync-guest` 라우트를 통해 터미널 신청 내역이 즉각 Service Binding으로 D1에 인서트됩니다.

---

## 데이터베이스 스키마

D1 (SQLite) 기반 구조입니다.

| 테이블              | 주요 컬럼                                                                     |
| ------------------- | ----------------------------------------------------------------------------- |
| `venues`            | id, name, type, address, active                                               |
| `users`             | id, email, password_hash, name, role, venue_id, guest_limit                   |
| `djs`               | id, venue_id, user_id, name, event                                            |
| `external_dj_links` | id, venue_id, token, dj_name, date, max_guests, used_guests                   |
| `guests`            | id, venue_id, name, status, date, dj_id, external_link_id, terminal_request_id|

---

## 개발 환경 설정

### 사전 요구 사항

- Docker Desktop (Apple Silicon 호환)
- VS Code (권장)

> **주의:** 로컬 환경에는 Node.js 런타임이 없으므로 모든 스크립트 실행은 Docker 내부에서 진행해야 합니다.

### 시작하기

```bash
# 1. 저장소 클론
git clone https://github.com/stann-kr/authon-worker.git
cd authon-worker

# 2. 로컬 환경 변수 설정 (.dev.vars)
echo "JWT_SECRET=your_local_secret_here" > .dev.vars

# 3. 개발 서버 실행 (Docker)
docker compose up

# 브라우저에서 http://localhost:3000 접속
```

### 필수 의존성 명령어

패키지 추가 또는 빌드 등은 반드시 컨테이너를 통해 진행합니다.

| 작업                 | 명령어                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| 서버 구동            | `docker compose up`                                                                              |
| 패키지 설치          | `docker compose run --rm web npm install <패키지>`                                               |
| DB 스키마 생성       | `docker compose run --rm web npm run db:generate`                                                |
| DB 로컬 마이그레이션 | `docker compose run --rm web npm run db:migrate`                                                 |
| 워커 빌드 테스트     | `docker compose run --rm web npm run build:worker`                                               |
| 린트 확인            | `docker compose run --rm web npm run lint`                                                       |

---

## 환경 변수 (Cloudflare Dashboard & .dev.vars)

| 변수                            | 설명                                             |
| ------------------------------- | ------------------------------------------------ |
| `JWT_SECRET`                    | JWT 서명 비밀키 (필수)                           |
| `TERMINAL_VENUE_ID`             | terminal-2 앱과 연동될 타겟 베뉴 ID (필수)       |
| `NEXT_PUBLIC_BRAND_NAME`        | 서비스 이름 (예: `Authon`, `Faust Guest System`) |
| `NEXT_PUBLIC_BRAND_FOOTER`      | 하단 푸터 문구                                   |
| `AWS_SES_ACCESS_KEY`            | AWS SES 발송을 위한 IAM 액세스 키                |
| `AWS_SES_SECRET_KEY`            | AWS SES 발송을 위한 IAM 시크릿 키                |
| `AWS_SES_REGION`                | AWS SES 리전 (예: `ap-northeast-2`)              |
| `AWS_SES_FROM_EMAIL`            | 발신자 이메일 주소 (SES에 인증된 주소)           |
| `NEXT_PUBLIC_APP_URL`           | 이메일 내 비밀번호 재설정 링크용 기본 URL        |

---

## 라이선스

Private — stann-kr/Authon
