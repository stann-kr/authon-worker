# 기술 명세

`authon-worker`는 베뉴 게스트 운영을 위한 Next.js / Cloudflare Workers 기반 SSR 애플리케이션이다. 이 문서는 외부 저장소에서 프로젝트 구조를 이해하는 데 필요한 수준만 다룬다. 공개 범위 기준은 [README](README.md)를 참고한다.

## 아키텍처 개요

```text
Client
  -> Next.js App Router / Server Actions
  -> Cloudflare Workers via OpenNext
  -> Cloudflare D1 + KV
  -> AWS SES for password reset email (후속 연동)
```

주요 경계:

- UI와 route는 Next.js App Router가 담당한다.
- 서버 변경 작업은 domain API layer와 Server Actions를 통해 수행한다.
- 인증은 JWT cookie와 KV session을 함께 확인한다.
- 권한은 role과 venue scope를 함께 확인한다.
- 공개 링크 기반 게스트 등록은 계정 로그인 흐름과 분리한다.

## 기술 스택

| 영역 | 기술 |
|---|---|
| Framework | Next.js App Router |
| Runtime | Cloudflare Workers / OpenNext |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | Cloudflare D1 / SQLite |
| ORM | Drizzle ORM |
| Session | Cloudflare KV |
| Auth | JWT + password hash verification |
| Email | AWS SES |

## 주요 도메인

| 도메인 | 역할 |
|---|---|
| Venue | 베뉴 단위 운영 경계 |
| User | 운영자, 스태프, DJ 계정과 role/scope |
| Guest | 날짜별 게스트 등록과 상태 관리 |
| External Link | 외부 DJ가 계정 없이 게스트를 등록하는 공개 링크 |
| Check-in | 도어 운영자의 입장 확인 기록 |
| Password Reset | 비밀번호 재설정 토큰과 메일 발송 흐름 |
| Account Claim | 이관 대기 계정의 1회성 직접 비밀번호 설정 |

## 역할과 접근 범위

| 역할 | 주요 접근 범위 |
|---|---|
| `super_admin` | 전체 운영 관리 |
| `venue_admin` | 특정 베뉴의 사용자·게스트·링크 관리 |
| `door_staff` | 도어 체크인과 게스트 확인 |
| `staff` | 게스트 등록과 조회 |
| `dj` | 본인/허용 범위의 게스트 등록 |

## 주요 화면과 API 경계

| 경로 | 공개 여부 | 역할 |
|---|---|---|
| `/auth/login` | 공개 | 로그인 |
| `/auth/reset-password` | 공개 | 비밀번호 재설정 |
| `/api/auth/claim-account` | 공개 API | 이관 대기 계정 1회성 활성화 |
| `/guest?token=...` | 공개 링크 | 외부 DJ 게스트 등록 |
| `/` | 인증 필요 | 대시보드 |
| `/guest` | 인증 필요 | 게스트 등록/관리 |
| `/door` | 인증 필요 | 도어 체크인 |
| `/admin` | 관리자 | 사용자·베뉴·링크·게스트 운영 |
| `/profile` | 인증 필요 | 프로필과 비밀번호 변경 |

## 인증과 세션 원칙

- 로그인 후 HTTP-only cookie 기반 JWT를 발급한다.
- KV session을 함께 확인해 로그아웃과 세션 무효화를 반영한다.
- 비밀번호 변경/재설정 이후 기존 세션을 무효화할 수 있도록 session version을 사용한다.
- 신규 비밀번호 hash는 WebCrypto PBKDF2 계열을 기준으로 관리하고, 기존 hash는 점진 전환한다.
- reset token 원문은 저장하지 않고 hash만 저장한다.
- 이관 대기 계정의 직접 설정은 `pending_reset`이면서 아직 비밀번호를 설정하지 않은 활성 계정에만 허용한다.
- 직접 설정 성공 시 migration 상태와 session version을 원자적으로 변경하고 기존 reset token을 모두 사용 처리한다.
- 직접 설정 요청은 IP와 이메일 조합으로 rate limit하며, 한 번 활성화된 계정은 같은 경로를 다시 사용할 수 없다.

## 데이터 모델 요약

| 테이블 | 설명 |
|---|---|
| `venues` | 베뉴 정보와 활성 상태 |
| `users` | 계정, role, venue scope, session/migration 상태 |
| `external_dj_links` | 외부 DJ 등록 링크와 정원/사용량 |
| `guests` | 게스트 등록 정보와 체크인 전 상태 |
| `check_ins` | 체크인 기록 |
| `password_reset_tokens` | 비밀번호 재설정 token hash와 만료/사용 상태 |

## 변경 시 함께 확인할 영역

| 변경 영역 | 함께 확인할 내용 |
|---|---|
| 인증/세션 | middleware, auth route, server auth helper, KV session invalidation |
| 권한/role | route guard, Server Action guard, venue scoping |
| 게스트 등록 | external link flow, guest limit, date/status 계산 |
| D1 schema | Drizzle schema, migration files, affected queries |
| 배포 runtime | OpenNext compatibility, Worker build result |
| 이메일 | reset-password route, SES sender configuration, public error message |
