# Authon — Venue Guest Management System

클럽/바/라운지 등 베뉴의 게스트 리스트를 관리하는 풀스택 웹 애플리케이션입니다.  
DJ가 게스트를 등록하고, Door 스태프가 체크인하며, Admin이 전체를 관리합니다.

---

## 기술 스택

| 구분         | 기술                                           |
| ------------ | ---------------------------------------------- |
| 프레임워크   | Next.js 15 (App Router, Static Export)         |
| 언어         | TypeScript                                     |
| 스타일링     | Tailwind CSS                                   |
| 아이콘       | Remix Icon                                     |
| 데이터베이스 | Supabase (PostgreSQL + Auth + Edge Functions)  |
| 백엔드       | Supabase Edge Functions (Deno)                 |
| 개발 환경    | Docker Compose (Docker-Only, 로컬 런타임 없음) |
| 빌드         | 정적 내보내기 (`output: "export"`)             |

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
│  │  └─ Next.js Dev Server                  │       │
│  ├──────────────────────────────────────────┤       │
│  │  Docker: supabase (CLI)                 │       │
│  │  └─ Edge Function 배포 전용              │       │
│  └──────────────────────────────────────────┘       │
│                         │                           │
│                         ▼                           │
│          ┌──────────────────────────┐               │
│          │  Supabase Cloud          │               │
│          │  ├─ PostgreSQL (RLS)     │               │
│          │  ├─ Auth (JWT)           │               │
│          │  └─ Edge Functions       │               │
│          └──────────────────────────┘               │
└─────────────────────────────────────────────────────┘
```

---

## 역할 및 접근 권한

| 역할          | 접근 스코프               | 설명                            |
| ------------- | ------------------------- | ------------------------------- |
| `super_admin` | guest, door, admin, venue | 플랫폼 전체 관리자. 베뉴 독립적 |
| `venue_admin` | guest, door, admin        | 특정 베뉴 관리자                |
| `door`        | guest, door               | 도어 스태프 (체크인 담당)       |
| `dj`          | guest                     | DJ (게스트 등록만 가능)         |

- 인증: Supabase Auth (이메일/비밀번호) + localStorage 호환 레이어
- 접근 제어: `AuthGuard` 컴포넌트에서 `hasAccess(role, requiredScopes)` 검증
- RLS: JWT `app_metadata`의 `app_role` / `app_venue_id` 기반 행 수준 보안

---

## 페이지 구조

### 공개 페이지

| 경로                   | 설명                                              |
| ---------------------- | ------------------------------------------------- |
| `/`                    | 랜딩 페이지                                       |
| `/auth/login`          | 로그인 (이메일/비밀번호, 비밀번호 찾기)           |
| `/auth/confirm`        | 회원가입 확인 (token_hash 기반, 향후 가입 기능용) |
| `/auth/reset-password` | 비밀번호 재설정 및 초대 수락 (token_hash 기반)    |
| `/guest?token=xxx`     | 외부 DJ 게스트 등록 (토큰 기반, 인증 불필요)      |

### 보호 페이지

| 경로       | 필요 스코프 | 설명                                                           |
| ---------- | ----------- | -------------------------------------------------------------- |
| `/guest`   | `guest`     | DJ 게스트 등록 — 날짜별 게스트 추가/삭제, 게스트 리밋 적용     |
| `/door`    | `door`      | 도어 체크인 — DJ별 필터, 게스트 체크인 (`pending` → `checked`) |
| `/admin`   | `admin`     | 관리자 대시보드 (아래 탭 참조)                                 |
| `/profile` | 로그인 필요 | 프로필 편집 (이름, 비밀번호)                                   |

### Admin 대시보드 탭

| 탭     | 컴포넌트          | 기능                                        | 접근 조건     |
| ------ | ----------------- | ------------------------------------------- | ------------- |
| GUEST  | `GuestList`       | 날짜별 게스트 목록, DJ별 필터, 체크인/삭제  | 모든 Admin    |
| LINKS  | `LinkManagement`  | 외부 DJ 링크 생성/관리, 링크 복사, 비활성화 | 모든 Admin    |
| USERS  | `UserManagement`  | 사용자 생성/수정/삭제, 역할 할당            | 모든 Admin    |
| VENUES | `VenueManagement` | 베뉴 CRUD, 타입 분류, 활성/비활성           | super_admin만 |

### UI 공통 레이아웃 규칙

- 페이지 골격은 공통 클래스(`page-shell`, `page-scroll`, `page-container`)를 우선 사용
- 모든 페이지는 메인 페이지와 동일하게 문서 전체 스크롤을 사용하며, 내부 고정 스크롤(`h-screen` + `overflow-y-auto`) 패턴은 사용하지 않음
- Footer 직전 상위 래퍼에는 `pb-*`를 두지 않아 Footer 위 인위적 여백이 생기지 않도록 유지
- 메인 리스트 카드(게스트 리스트 등)는 `main-content-panel`을 사용해 최소 높이 기준을 통일
- Footer는 페이지 하단 영역에 배치해 메뉴 간 위치 일관성 유지
- 메인/서브 페이지의 콘텐츠 최대 폭은 `max-w-6xl` 기준으로 통일

### 사용자 메시지 언어 규칙

- 서비스에서 사용자에게 노출되는 문구(알림/버튼/검증/오류 응답)는 **영문(English)만 사용**
- 프론트엔드 fallback 메시지와 Edge Function `message`/`error` payload도 동일 기준 적용

---

## 주요 기능

### 1. 게스트 등록 (DJ)

DJ가 자신의 게스트를 날짜별로 등록합니다.

- 날짜 선택 → 게스트 이름 입력 → 자동 대문자 변환 → 등록
- `guest_limit` 적용: 사용자별 날짜당 최대 게스트 수 제한
- 사이드바에 WAITING / CHECKED / REMAINING 카운터 표시
- 한도 도달 시 입력 영역이 "GUEST LIMIT REACHED" 메시지로 대체
- 게스트 목록 정렬 토글: 기본 순서 ↔ 가나다(ABC)

### 2. 외부 DJ 링크

인증 없이 토큰 기반으로 게스트를 등록할 수 있는 일회성 링크입니다.

**생성 (Admin):**

1. Admin → LINKS 탭 → DJ 이름, 이벤트명, 날짜, 최대 게스트 수 입력
2. 고유 토큰이 생성되어 URL 복사 가능: `/guest?token={uuid}`

**사용 (외부 DJ):**

1. 링크 접속 → 토큰 자동 검증 (활성 여부, 만료 여부, 한도 여부)
2. 게스트 이름 입력 → 등록 (인증 불필요)
3. 새로고침 시에도 기존 게스트 목록 유지 (validate 시 기존 게스트 반환)
4. 최대 게스트 수 도달 시 등록 차단

**제한 조건:**

- `max_guests`: 등록 가능 최대 수
- `expires_at`: 링크 만료 시각 (선택)
- `active`: Admin이 수동 비활성화 가능

### 3. 도어 체크인

Door 스태프가 게스트를 체크인합니다.

- 날짜별 게스트 목록 조회
- DJ/사용자별 필터링
- 게스트 상태 전환: `pending` → `checked`
- 외부 DJ 링크 게스트도 별도 섹션으로 표시
- 게스트 목록 정렬 토글: 기본 순서 ↔ 가나다(ABC)

### 4. 베뉴 관리 (super_admin)

- 베뉴 생성/수정: 이름, 타입 (Club / Bar / Lounge / Festival / Private), 주소, 설명
- 활성/비활성 토글
- 모든 데이터(users, guests, links)는 `venue_id`로 격리

### 5. 사용자 관리 (Admin)

- 사용자 생성: 이메일, 이름, 역할, 게스트 리밋 설정
- Edge Function `create-user`로 Supabase Auth 계정 + public 프로필 동시 생성
- EMAIL INVITE 모드: `inviteUserByEmail()`로 초대 메일 발송 후 `/auth/reset-password`에서 최초 비밀번호 설정
- 초대 링크 진입 시 기존 로컬 세션을 정리하고 토큰 세션을 우선 적용하여 계정 충돌 방지
- 사용자 수정/삭제, 활성/비활성 토글

### 6. 인증 이메일 템플릿

- 템플릿 경로: `.docs/email/confirm-signup.html`, `.docs/email/invite.html`, `.docs/email/reset-password.html`
- 모든 사용자 노출 문구는 영문 기준으로 유지
- 메일 클라이언트 호환성 강화를 위해 table 기반 레이아웃 + 인라인 스타일 사용
- `rgba`, `min-height: 100vh`, `div` 기반 정렬처럼 일부 클라이언트에서 깨질 수 있는 스타일은 지양
- Supabase Auth 이메일 템플릿에 반영 시 위 파일 내용을 그대로 복사하여 사용

---

## 데이터베이스 스키마

```
venues ──┐
         ├── users (role, guest_limit, venue_id)
         ├── djs (name, event, user_id → users)
         ├── external_dj_links (token, max_guests, used_guests)
         └── guests (name, status, date)
                ├── dj_id → djs (내부 DJ 등록)
                ├── external_link_id → external_dj_links (외부 DJ 등록)
                └── created_by_user_id → users (인증 사용자 등록)
```

### 테이블 요약

| 테이블              | 주요 컬럼                                                                     | 설명              |
| ------------------- | ----------------------------------------------------------------------------- | ----------------- |
| `venues`            | id, name, type, address, active                                               | 장소 정보         |
| `users`             | id, auth_user_id, venue_id, email, name, role, guest_limit                    | 스태프 사용자     |
| `djs`               | id, venue_id, user_id, name, event                                            | 베뉴 소속 DJ      |
| `external_dj_links` | id, venue_id, token, dj_name, date, max_guests, used_guests                   | 외부 DJ 토큰 링크 |
| `guests`            | id, venue_id, name, status, date, dj_id, external_link_id, created_by_user_id | 게스트 명단       |

### RLS 정책

- JWT `app_metadata`의 `app_role`과 `app_venue_id` 클레임 기반
- `super_admin`: 모든 venue 데이터 접근
- 기타 역할: 자신의 `venue_id` 데이터만 접근
- `external_dj_links`의 validate 액션은 `--no-verify-jwt`로 공개 접근

---

## Supabase Edge Functions

| 함수                 | 인증              | 설명                                                 |
| -------------------- | ----------------- | ---------------------------------------------------- |
| `auth-login`         | -                 | 로그인 (stub, 미구현)                                |
| `auth-login-new`     | 불필요            | bcrypt 기반 로그인 (레거시)                          |
| `auth-register`      | 불필요            | 회원가입, bcrypt 해싱, 이메일 중복 체크              |
| `create-user`        | `--no-verify-jwt` | Admin 전용 사용자 생성. Auth 계정 + 프로필 동시 생성 |
| `admin-users`        | JWT               | 사용자 목록 조회                                     |
| `admin-applications` | JWT               | 가입 신청 목록 조회/처리                             |
| `external-dj-links`  | `--no-verify-jwt` | 외부 DJ 링크 검증/게스트 등록/삭제                   |

---

## 개발 환경 설정

### 사전 요구 사항

- Docker Desktop (Apple Silicon 호환)
- VS Code (권장)

> **주의:** 로컬에 Node.js, npm 등 런타임이 필요하지 않습니다. 모든 실행은 Docker 컨테이너 내부에서 이루어집니다.

### 시작하기

```bash
# 1. 저장소 클론
git clone https://github.com/stann-kr/Authon.git
cd Authon

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 등 설정

# 3. 개발 서버 실행
docker compose up

# 브라우저에서 http://localhost:3000 접속
```

### 주요 명령어

| 작업                 | 명령어                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| 개발 서버 실행       | `docker compose up`                                                                              |
| 백그라운드 실행      | `docker compose up -d`                                                                           |
| 빌드 (정적 내보내기) | `docker compose run --rm web npm run build`                                                      |
| 린트                 | `docker compose run --rm web npm run lint`                                                       |
| 패키지 설치          | `docker compose run --rm web npm install <패키지>`                                               |
| Edge Function 배포   | `docker compose run --rm supabase functions deploy <함수명> --no-verify-jwt --project-ref <ref>` |
| 컨테이너 종료        | `docker compose down`                                                                            |

---

## 프로젝트 구조

```
Authon/
├── app/                          # Next.js App Router 페이지
│   ├── layout.tsx                # 루트 레이아웃
│   ├── page.tsx                  # 랜딩 페이지
│   ├── admin/                    # 관리자 대시보드
│   │   ├── page.tsx              # 탭 컨테이너
│   │   └── components/           # Admin 탭 컴포넌트
│   │       ├── GuestList.tsx     # 게스트 목록
│   │       ├── LinkManagement.tsx # 외부 DJ 링크 관리
│   │       ├── UserManagement.tsx # 사용자 관리
│   │       └── VenueManagement.tsx # 베뉴 관리
│   ├── auth/                     # 인증 페이지
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── invite/[id]/          # 초대 링크
│   ├── door/page.tsx             # 도어 체크인
│   ├── guest/page.tsx            # 게스트 등록 (인증 + 외부 DJ)
│   └── profile/page.tsx          # 프로필 편집
├── components/
│   ├── AuthGuard.tsx             # 역할 기반 라우트 보호
│   ├── GuestListCard.tsx         # 게스트 카드 공용 컴포넌트
│   ├── Footer.tsx                # 공통 푸터 (compact 모드 지원)
│   ├── StatGrid.tsx              # 통계 박스 그리드
│   ├── PanelHeader.tsx           # 섹션 헤더 (Sort/Refresh)
│   ├── VenueSelector.tsx         # 베뉴 셀렉터 UI + useVenueSelector 훅
│   ├── DatePicker.tsx            # 날짜 선택 패널
│   ├── Alert.tsx                 # 에러/성공 알림 메시지
│   ├── EmptyState.tsx            # 빈 데이터 플레이스홀더
│   └── Spinner.tsx               # 로딩 스피너 (fullscreen/inline/button)
├── lib/
│   ├── auth.ts                   # 인증/세션 로직
│   ├── database.types.ts         # Supabase DB 타입
│   ├── api/guests.ts             # Supabase API 함수 (CRUD)
│   └── supabase/                 # Supabase 클라이언트
│       ├── client.ts
│       └── server.ts
├── supabase/
│   ├── schema.sql                # 데이터베이스 스키마
│   ├── reset-and-apply.sql       # 스키마 리셋 스크립트
│   ├── migrations/               # 마이그레이션 파일
│   └── functions/                # Edge Functions (Deno)
│       ├── auth-login/
│       ├── auth-login-new/
│       ├── auth-register/
│       ├── create-user/
│       ├── admin-users/
│       ├── admin-applications/
│       └── external-dj-links/
├── docker-compose.yml            # Docker 서비스 정의
├── Dockerfile                    # web 서비스 (Node 20)
├── Dockerfile.supabase           # supabase CLI 서비스
├── next.config.ts                # Next.js 설정 (static export)
└── .docs/
    ├── README.md                 # 이 문서
    └── CHANGE_LOG.md             # 변경 이력
```

---

## 환경 변수

| 변수                            | 설명                                             |
| ------------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase 프로젝트 URL                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anonymous Key (클라이언트용)            |
| `NEXT_PUBLIC_BRAND_NAME`        | 서비스 이름 (예: `Authon`, `Faust Guest System`) |
| `NEXT_PUBLIC_BRAND_TAGLINE`     | 상단 보조 문구 (예: `Guest Management System`)   |
| `NEXT_PUBLIC_BRAND_DESCRIPTION` | 메타 설명(description)                           |
| `NEXT_PUBLIC_BRAND_FOOTER`      | 하단 푸터 문구                                   |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase Service Role Key (Edge Function용)      |

---

## 라이선스

Private — stann-kr/Authon
