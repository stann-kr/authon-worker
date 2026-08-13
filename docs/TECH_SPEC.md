# 기술 명세

`authon-worker`는 베뉴 게스트 운영을 위한 Next.js / Cloudflare Workers 기반 SSR 애플리케이션이다. 이 문서는 외부 저장소에서 프로젝트 구조를 이해하는 데 필요한 수준만 다룬다. 공개 범위 기준은 [README](README.md)를 참고한다.

## 아키텍처 개요

```text
Client
  -> 요청 Host 기반 Venue Context
  -> Next.js App Router / Server Actions
  -> Cloudflare Workers via OpenNext
  -> Cloudflare D1 + KV
```

주요 경계:

- UI와 route는 Next.js App Router가 담당한다.
- 서버 변경 작업은 domain API layer와 Server Actions를 통해 수행한다.
- 인증은 JWT cookie와 KV session을 함께 확인한다.
- 권한은 role, 계정 유형별 capability와 venue scope를 함께 확인한다.
- 하나의 Worker가 여러 도메인을 받고, D1의 도메인 매핑으로 베뉴 브랜드와 대표 URL을 요청 단위로 결정한다.
- 요청 도메인은 표시 컨텍스트이며 권한 근거로 단독 사용하지 않고 계정·링크의 venue scope와 교차 검증한다.
- 공개 링크 기반 게스트 등록은 계정 로그인 흐름과 분리한다.

## 배포 환경

- `authon-worker` 하나가 custom domain, 운영 D1과 운영 KV를 사용한다. Wrangler 환경별 Worker나 별도 개발 데이터베이스는 두지 않는다.
- `main`은 `deploy` 명령으로 현재 production deployment를 갱신한다.
- 외부에서 접근하는 Worker 주소는 기본 `workers.dev` 주소와 production custom domain뿐이며 두 주소는 같은 활성 production version을 제공한다.
- preview URL과 non-main branch 자동 원격 build는 사용하지 않는다. `dev`는 production 배포 전 소스 검증용 branch이며 직접 서비스 주소를 갖지 않는다.
- 모든 원격 요청은 같은 운영 D1·KV·secret을 사용한다.

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
| Guest | 날짜별 단건·25명 단위 게스트 등록, 공용 계정 실제 입력자와 상태 관리 |
| Guest Limit Request | Staff·DJ의 날짜별 추가 게스트 한도 요청과 관리자 승인 기록 |
| External Link | 외부 DJ가 계정 없이 게스트를 등록하고 설정을 새 credential로 재사용하는 공개 링크 |
| Check-in | 도어 운영자의 입장 확인 기록 |
| Password Reset | 사용자 관리자 요청, 관리자 결정, 기존 재설정 token의 일회성 소비 |
| Account Setup | `pending_reset` 계정의 1회용 설정 코드 또는 요청 브라우저에 결속된 관리자 승인 기반 비밀번호 설정 |
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

일반 Guest 작업 공간은 현재 계정이 등록한 게스트만 조회한다. 베뉴 전체 명단과 기여자 정보는 Door 또는 Admin capability가 있는 운영 화면에서만 조회한다.

## 주요 화면과 API 경계

| 경로 | 공개 여부 | 역할 |
|---|---|---|
| `/auth/login` | 공개 | 로그인 |
| `/auth/reset-password` | 공개 | 관리자 재설정 요청, 승인 확인, 기존 token 기반 비밀번호 재설정 |
| `/auth/setup-password` | 공개 | 관리자에게 받은 1회용 설정 코드로 새 비밀번호 설정 |
| `/api/auth/password-reset-requests` | 공개 API | 계정 존재 여부를 노출하지 않는 관리자 재설정 요청 등록 |
| `/api/auth/password-reset-requests/status` | 공개 API | 서명된 브라우저 영수증에 결속된 승인 상태 확인 |
| `/api/auth/claim-account` | 공개 API | 검증된 1회용 설정 코드 또는 요청 브라우저의 유효한 관리자 승인으로 비밀번호 설정 |
| `/api/internal/sync-guest` | 내부 API | shared secret과 필수 `terminalRequestId`를 검증하는 terminal 게스트 동기화 |
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
- 자가 이메일 재설정 발송은 비활성화하고, 이미 발급된 유효한 reset token의 일회성 소비만 호환 경로로 유지한다.
- 공개 관리자 요청은 계정 존재 여부, tenant 불일치, 기존 열린 요청 여부에 같은 성공 응답과 동일한 DB 작업 형태를 사용하고 이메일과 IP를 결합한 단위로 rate limit한다.
- 공개 요청은 24시간짜리 HttpOnly 서명 영수증과 숫자 4자리 요청 확인번호를 발급한다. 관리자는 대면, 등록 전화 또는 기존에 확인된 메신저로 사용자를 먼저 확인한 뒤 사용자가 알려준 번호를 정확한 요청에 입력한다.
- browser 승인은 개인 `door_staff`, `staff`, `dj`의 self-service 요청에만 허용한다. 사용자가 같은 브라우저로 돌아와 승인 상태를 처음 확인하면 장기 영수증을 폐기하고 정확한 요청·만료 시각에 서명된 15분짜리 claim 권한으로 교체하며, 이를 한 번만 소비할 수 있다.
- 사용자 목록의 수동 재설정과 관리자·공용 계정은 15분짜리 설정 코드만 사용한다. 사용자는 전용 설정 화면에서 계정 이메일, 설정 코드와 새 비밀번호를 함께 입력한다.
- `pending_reset`이면서 비밀번호를 아직 설정하지 않은 계정은 현재 password hash와 일치하는 초기 설정 코드로만 설정을 시작한다. 관리자가 새로 발급한 코드는 미사용·미만료 승인 요청에도 결속하며, browser 승인은 별도의 요청 화면에서만 소비한다.
- 설정 성공 시 계정 상태와 session version, 정확한 요청 상태를 원자적으로 변경하고 기존 reset token과 다른 열린 요청을 모두 닫는다. 정상 로그인과 프로필 비밀번호 변경도 남은 관리자 재설정 grant를 취소한다.
- 관리자 결정과 최종 claim은 role, 계정 유형, venue scope, 자기 계정, 활성·삭제 상태, 관리자 session version과 현재 관리 권한을 각각 다시 검증한다. 감사 기록은 인증 허용 여부의 근거로 사용하지 않는다.
- 운영 화면의 사용자 디렉터리는 식별과 표시를 위한 최소 필드만 반환하고, 관리자 목록도 인증 내부 필드를 제외한 전용 DTO를 사용한다.
- Door·Admin 게스트 명단의 외부 링크 기여자 정보는 내부 ID와 표시 이름만 반환하며, token과 공개 URL 등 링크 credential은 관리자 링크 관리 기능에서만 조회한다.
- 베뉴 관리자는 사용자 디렉터리와 관리자 목록에서 `super_admin` 계정을 조회할 수 없으며, 계정 관리 감사 기록은 `super_admin`만 조회한다.
- 사용자 삭제는 참조 무결성과 운영 감사 기록을 보존하는 soft delete이며, 비활성 계정에서만 실행하고 개인정보·인증 정보를 제거한다.
- 자기 계정의 Role·상태·삭제·관리자 재설정과 베뉴 관리자의 권한 상승·베뉴 간 변경은 서버에서 거부한다.

## 게스트 등록 일관성

- 줄바꿈 기반 대량 등록은 요청당 최대 25명이며, 공백·대소문자·Unicode 호환 정규화 후 중복 후보와 잘못된 이름을 쓰기 전에 구분한다.
- 중복 후보는 자동 삭제하지 않고 사용자가 행별로 명시적으로 포함 여부를 확인한다. 서버는 미리보기 이후 명단이 바뀐 경우 해당 행을 다시 확인하도록 반환한다.
- 단건 등록도 같은 원자 중복 판정 경로를 사용하며, 이미 존재하는 이름을 다시 등록하려면 대량 입력 미리보기에서 명시적으로 확인해야 한다.
- 계정별 한도와 승인된 추가 인원, 외부 링크 정원 예약은 D1 transaction batch 안의 조건부 쓰기로 최종 판정한다.
- 외부 공개 등록의 KV rate limit은 반복 요청을 줄이는 보조 방어이며, 정원·중복·link 상태의 권위 있는 판정에는 사용하지 않는다.
- 외부 링크 게스트 삭제와 사용 인원 차감은 같은 transaction batch에서 처리하며, 반복 삭제는 한 번만 차감한다.
- 외부 token 삭제는 같은 batch 안에서 현재 token·베뉴·활성·보관·만료·운영일과 게스트의 입장 대기 상태를 다시 확인한다.
- 삭제·상태 변경의 쓰기 조건은 사전 조회 결과의 베뉴와 소유권을 다시 확인하고, 삭제된 게스트는 `pending` 또는 `checked` 상태로 되돌릴 수 없다.
- 공개 등록·삭제 뒤 최신 명단 재조회가 실패하면 입력은 유지하고 추가 쓰기를 잠근 뒤 명시적 재시도로만 해제한다.
- 기존 링크를 템플릿으로 사용할 때는 DJ·이벤트·정원·언어만 복사하며, ID·token·URL·사용량·생성자·수명주기는 새로 만든다.
- terminal 동기화는 베뉴 단위 `terminalRequestId`를 필수 idempotency key로 사용한다. 같은 key와 정규화된 payload의 retry는 최초 guest ID를 반환하고, 다른 payload 재사용은 `409`로 거부한다.

## 클라이언트 비동기 상태 원칙

- 베뉴·날짜에 결속된 mutation은 시작 시 scope와 operation ID를 함께 캡처한다. 완료 시 현재 scope와 operation 소유권이 모두 일치할 때만 credential, feedback과 busy 상태를 갱신한다.
- setup code와 외부 링크 token 같은 일회성 결과는 저장된 scope가 현재 화면과 다르면 render 단계에서 숨기며, 전환 effect에만 삭제를 의존하지 않는다.
- Guest roster polling은 한 번에 하나만 실행하고 숨김 탭·offline·mutation 중에는 중단한다. 체크인·취소 성공 뒤에는 기존 poll을 무효화하고 권위 있는 roster를 다시 조회한다.
- route 전환, scope 변경, reject와 abort는 진행 중 작업의 소유권을 폐기하고 현재 작업이 소유한 busy 상태만 해제한다.

## 데이터 모델 요약

| 테이블 | 설명 |
|---|---|
| `venues` | 베뉴 정보, 활성 상태, IANA 시간대와 오픈·클로징 시각 |
| `venue_domains` | host, platform/venue scope, 베뉴별 대표 도메인과 기본 언어 |
| `users` | 계정, role, 개인·공용 유형, Door capability, guest limit, venue scope, session/setup 상태, 최근 로그인, 삭제 처리와 선호 언어 |
| `user_audit_events` | 사용자 계정 관리 작업의 actor, 대상, 작업 종류와 시각 |
| `external_dj_links` | 외부 DJ 등록 링크, 정원/사용량, 생성 시각과 언어 모드 |
| `guests` | 게스트 등록 정보, 공용 계정 실제 입력자와 체크인 전 상태 |
| `terminal_guest_sync_requests` | terminal 요청의 베뉴별 idempotency key, payload hash와 최초 guest 결과 |
| `guest_limit_requests` | 사용자·날짜별 추가 한도 요청, 선택 사유, 승인 수량과 결정 기록 |
| `check_ins` | 체크인 기록 |
| `password_reset_tokens` | 비밀번호 재설정 token hash와 만료/사용 상태 |
| `password_reset_requests` | 사용자 관리자 요청, 처리 상태·방식·결정자와 코드 없는 승인 만료 시각 |

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
| 비밀번호 재설정 | 공개 요청 응답 균일성, Admin 결정 권한, 승인 만료·일회성 소비, 기존 token 호환 |
| 국제화 | locale resolver, 메시지 키 대응, 계정·도메인·External Link 우선순위 |

외부 링크의 최근 목록은 `created_at` 내림차순으로 조회한다. Supabase snapshot을 D1으로 이전할 때도 원본 `created_at`을 보존하므로 컷오버 전에 생성된 링크가 최근 목록에서 누락되지 않는다.
