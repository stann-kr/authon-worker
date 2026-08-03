# 기술 명세

`authon-worker`는 베뉴 게스트 운영을 위한 Next.js / Cloudflare Workers 기반 SSR 애플리케이션이다. 이 문서는 외부 저장소에서 프로젝트 구조를 이해하는 데 필요한 수준만 다룬다. 공개 범위 기준은 [README](README.md)를 참고한다.

## 아키텍처 개요

```text
Client
  -> 요청 Host 기반 Venue Context
  -> Next.js App Router / Server Actions
  -> Cloudflare Workers via OpenNext
  -> Cloudflare D1 + KV
  -> AWS SES for password reset email (후속 연동)
```

주요 경계:

- UI와 route는 Next.js App Router가 담당한다.
- 서버 변경 작업은 domain API layer와 Server Actions를 통해 수행한다.
- 인증은 JWT cookie와 KV session을 함께 확인한다.
- 권한은 role, 계정 유형별 capability와 venue scope를 함께 확인한다.
- 하나의 Worker가 여러 도메인을 받고, D1의 도메인 매핑으로 베뉴 브랜드와 대표 URL을 요청 단위로 결정한다.
- 요청 도메인은 표시 컨텍스트이며 권한 근거로 단독 사용하지 않고 계정·링크의 venue scope와 교차 검증한다.
- 공개 링크 기반 게스트 등록은 계정 로그인 흐름과 분리한다.

## 언어 결정

- 지원 언어는 영어(`en`)와 한국어(`ko`)이며 전역 fallback은 영어다.
- 명시적 `lang`, 계정 설정, locale cookie, 브라우저 언어를 allowlist 검증해 적용한다.
- 브라우저가 지원하지 않는 언어만 제공하면 영어를 사용한다. 언어 헤더가 없거나 해석할 수 없을 때만 도메인 기본 언어를 사용한다.
- 로그인 사용자는 계정에 저장한 언어가 우선하며, External Link는 방문자 자동 감지 또는 링크별 고정 언어를 사용한다.
- 언어는 인증, 권한, 베뉴 scope, 시간대와 분리한다.

## 기술 스택

| 영역 | 기술 |
|---|---|
| Framework | Next.js App Router |
| Runtime | Cloudflare Workers / OpenNext |
| Language | TypeScript |
| Styling | Carbon theme/icons + Tailwind CSS semantic tokens |
| Localization | next-intl (`en`, `ko`) |
| Database | Cloudflare D1 / SQLite |
| ORM | Drizzle ORM |
| Session | Cloudflare KV |
| Auth | JWT + password hash verification |
| Email | AWS SES |

## 주요 도메인

| 도메인 | 역할 |
|---|---|
| Venue | 베뉴 단위 운영 경계와 현지 시간대·운영시간·영업일 기준 |
| Venue Domain | 요청 host와 베뉴 브랜드·대표 URL의 연결 |
| User | 운영자, 스태프, DJ 계정과 role, 개인·공용 계정 유형, scope |
| Guest | 날짜별 게스트 등록, 공용 계정 실제 입력자와 상태 관리 |
| Guest Limit Request | Staff·DJ의 날짜별 추가 게스트 한도 요청과 관리자 승인 기록 |
| External Link | 외부 DJ가 계정 없이 게스트를 등록하는 공개 링크 |
| Check-in | 도어 운영자의 입장 확인 기록 |
| Password Reset | 비밀번호 재설정 토큰과 메일 발송 흐름 |
| Account Setup | 관리자 또는 이관 절차가 발급한 1회용 설정 코드 기반 비밀번호 설정 |
| User Audit | 계정 생성, Role·상태·비밀번호 설정과 삭제 작업 기록 |

## 역할과 접근 범위

| 역할 | 주요 접근 범위 |
|---|---|
| `super_admin` | 전체 운영 관리 |
| `venue_admin` | 특정 베뉴의 하위 사용자·게스트·링크 관리 |
| `door_staff` | 도어 체크인과 게스트 확인 |
| `staff` | 게스트 등록과 조회 |
| `dj` | 본인/허용 범위의 게스트 등록 |

공용 계정은 별도 role이 아니라 `staff` role에 적용하는 계정 유형이다. 게스트 등록 시 실제 입력자 이름을 필수로 남기며, 베뉴 관리자가 계정별로 Door 접근 capability를 켤 수 있다. 일반 `staff`와 `dj` 개인 계정은 날짜별 추가 한도를 요청할 수 있고, 같은 날짜의 승인 수량은 기본 한도에 누적된다. 요청 사유는 선택 사항이며 승인 전에는 한도에 반영되지 않는다.

## 주요 화면과 API 경계

| 경로 | 공개 여부 | 역할 |
|---|---|---|
| `/auth/login` | 공개 | 로그인 |
| `/auth/reset-password` | 공개 | 비밀번호 재설정 |
| `/demo` | 공개 | 운영 API와 분리된 브라우저 로컬 포트폴리오 데모 |
| `/api/auth/claim-account` | 공개 API | 검증된 1회용 설정 코드로 비밀번호 설정 |
| `/guest?token=...` | 공개 링크 | 외부 DJ 게스트 등록 |
| `/` | 인증 필요 | 역할별 대시보드와 Venue Admin의 미처리 추가 게스트 요청 알림 |
| `/guest` | 인증 필요 | 게스트 등록/관리 |
| `/door` | 인증 필요 | 도어 체크인 |
| `/admin` | 관리자 | 게스트 목록·추가 한도 요청을 포함한 게스트 운영과 링크·사용자·베뉴 관리 |
| `/profile` | 인증 필요 | 프로필과 비밀번호 변경 |

## 인증과 세션 원칙

- 로그인 후 HTTP-only cookie 기반 JWT를 발급한다.
- KV session을 함께 확인해 로그아웃과 세션 무효화를 반영한다.
- 비밀번호 변경/재설정 이후 기존 세션을 무효화할 수 있도록 session version을 사용한다.
- Role, 계정 유형, 공용 계정 Door capability 변경과 비활성화·재활성화, 삭제 처리도 session version을 변경해 기존 세션의 재사용을 차단한다.
- 신규 비밀번호 hash는 WebCrypto PBKDF2 계열을 기준으로 관리하고, 기존 hash는 점진 전환한다.
- reset token 원문은 저장하지 않고 hash만 저장한다.
- 최초 설정은 `pending_reset`이면서 아직 비밀번호를 설정하지 않은 활성 계정에만 허용하고, 관리자가 별도로 전달한 1회용 설정 코드 hash까지 확인한다.
- 설정 성공 시 계정 상태와 session version을 원자적으로 변경하고 기존 reset token을 모두 사용 처리한다.
- 설정 요청은 IP와 이메일 조합으로 rate limit하며, 완료된 설정 코드와 경로는 재사용할 수 없다.
- 운영 화면의 사용자 디렉터리는 식별과 표시를 위한 최소 필드만 반환하고, 관리자 목록도 인증 내부 필드를 제외한 전용 DTO를 사용한다.
- 베뉴 관리자는 사용자 디렉터리와 관리자 목록에서 `super_admin` 계정을 조회할 수 없으며, 계정 관리 감사 기록은 `super_admin`만 조회한다.
- 사용자 삭제는 참조 무결성과 운영 감사 기록을 보존하는 soft delete이며, 비활성 계정에서만 실행하고 개인정보·인증 정보를 제거한다.
- 자기 계정의 Role·상태·삭제·관리자 재설정과 베뉴 관리자의 권한 상승·베뉴 간 변경은 서버에서 거부한다.

## 데이터 모델 요약

| 테이블 | 설명 |
|---|---|
| `venues` | 베뉴 정보, 활성 상태, IANA 시간대와 오픈·클로징 시각 |
| `venue_domains` | host, platform/venue scope, 베뉴별 대표 도메인과 기본 언어 |
| `users` | 계정, role, 개인·공용 유형, Door capability, guest limit, venue scope, session/setup 상태, 최근 로그인, 삭제 처리와 선호 언어 |
| `user_audit_events` | 사용자 계정 관리 작업의 actor, 대상, 작업 종류와 시각 |
| `external_dj_links` | 외부 DJ 등록 링크, 정원/사용량, 생성 시각과 언어 모드 |
| `guests` | 게스트 등록 정보, 공용 계정 실제 입력자와 체크인 전 상태 |
| `guest_limit_requests` | 사용자·날짜별 추가 한도 요청, 선택 사유, 승인 수량과 결정 기록 |
| `check_ins` | 체크인 기록 |
| `password_reset_tokens` | 비밀번호 재설정 token hash와 만료/사용 상태 |

## 변경 시 함께 확인할 영역

| 변경 영역 | 함께 확인할 내용 |
|---|---|
| 인증/세션 | middleware, auth route, server auth helper, KV session invalidation |
| 권한/role | route guard, Server Action guard, 계정 유형 capability, venue scoping, session 무효화, 자기 계정·권한 상승 방지 |
| 도메인/브랜드 | host resolver, venue domain mapping, metadata, email/link canonical URL |
| 게스트 등록 | external link flow, 공용 계정 입력자, 기본·승인 추가 한도의 원자적 적용, date/status 계산 |
| 베뉴 시간 기준 | IANA timezone 검증, 자정 통과 운영시간, Guest·Door·Admin 기본 영업일 계산 |
| D1 schema | Drizzle schema, migration files, affected queries |
| 배포 runtime | OpenNext compatibility, Worker build result |
| 이메일 | reset-password route, SES sender configuration, public error message |
| 국제화 | locale resolver, 메시지 키 대응, 계정·도메인·External Link 우선순위 |

## 포트폴리오 데모 경계

- `/demo`는 로그인 없이 게스트 등록, 도어 체크인, 추가 한도 승인, 외부 게스트 링크 생성 흐름을 체험하는 샌드박스다.
- 샘플 상태와 사용자의 변경은 브라우저 `localStorage`에만 저장하며 인증 cookie, API route, D1, KV를 사용하지 않는다.
- 초기화는 현재 브라우저의 데모 상태만 기본 fixture로 되돌리고 운영 계정이나 데이터에는 영향을 주지 않는다.
- 데모 상태 전이는 순수 함수로 분리해 등록값 정규화, 체크인 되돌리기, 요청 단일 결정, 링크 정원 제한을 테스트한다.

외부 링크의 최근 목록은 `created_at` 내림차순으로 조회한다. Supabase snapshot을 D1으로 이전할 때도 원본 `created_at`을 보존하므로 컷오버 전에 생성된 링크가 최근 목록에서 누락되지 않는다.
