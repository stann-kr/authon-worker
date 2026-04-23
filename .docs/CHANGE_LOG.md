# Change Log

모든 변경 사항은 최신순으로 기록됩니다.

---

## 2026-04-23 (3차)

### API 리팩토링 및 타입 안전성 강화 (Phase 5) 완료

1. **API 도메인 모듈화 완료**
   - `lib/api/guests.ts`에 집중되었던 로직을 도메인별로 분리:
     - `lib/api/users.ts`: 사용자 관리 (초대, 프로필 수정, 삭제 등)
     - `lib/api/venues.ts`: 베뉴 관리 (조회, 생성, 수정 등)
     - `lib/api/djs.ts`: DJ 관리 (조회, 생성 등)
     - `lib/api/external-links.ts`: 외부 DJ 링크 관리 (생성, 조회, 활성화/비활성화 등)
     - `lib/api/types.ts`: 공통 인터페이스 및 타입 정의 통합 관리

2. **전방위적 타입 안전성 확보 및 any 타입 제거**
   - ESLint 규칙 `@typescript-eslint/no-explicit-any: "error"` 활성화로 향후 any 사용 원천 차단
   - `AuthenticatedGuestView`, `UserManagement`, `VenueManagement`, `LinkManagement` 등 주요 컴포넌트의 `any` 타입을 명시적 인터페이스로 대체
   - `user` 프롭에 `AuthUser` 타입을 적용하고, `venue_id` 및 `guest_limit`의 nullability 대응 완료
   - `Venue` 인터페이스에 `description` 필드 추가 및 `guestLimit` 타입 불일치(`number | null`) 해결

3. **견고한 에러 핸들링 도입**
   - 모든 API 호출 catch 블록에서 `unknown` 캐스팅 및 `instanceof Error` 검사를 통한 안전한 에러 메시지 추출 적용
   - 사용자에게 불투명한 에러 대신 구체적인 메시지를 제공하도록 UI 전반의 에러 처리 로직 개선

4. **컴포넌트 임포트 구조 최적화**
   - 새로운 API 모듈 구조에 맞춰 Admin 및 Guest 뷰의 모든 임포트 경로 업데이트 완료
   - 미사용 레거시 타입 파일(`lib/database.types.ts`) 제거 확인

---


### 코드베이스 감사 및 문서 전면 현행화

**감사 결과 발견 이슈 및 수정 계획 수립**

1. **코드베이스 전체 감사 완료**
   - Cloudflare Workers 마이그레이션 이후 첫 전체 코드 리뷰 수행
   - 긴급/스키마/보안/환경변수/코드품질 5개 카테고리 이슈 도출

2. **주요 발견 이슈 (수정 예정)**
   - D1 마이그레이션 미적용 → `users` 테이블 부재 (Super Admin 삽입 실패 원인)
   - `guests.created_by_user_id` DB 컬럼 누락 → DJ별 필터 동작 불가
   - 외부 DJ 토큰 링크(`/guest?token=xxx`) middleware에서 차단
   - JWT_SECRET 폴백값 `"default_secret_for_local_dev"` 4곳에 잔존
   - `/api/internal/sync-guest` 엔드포인트 인증 없이 공개 노출
   - `fetchAllGuests()` Drizzle `.where()` 체이닝 버그

3. **문서 전면 현행화 (Supabase → Workers)**
   - `.docs/README.md` 재작성 (Supabase 아키텍처 내용 제거)
   - `.docs/DEPLOYMENT.md` 재작성 (Workers/D1 배포 절차)
   - `.docs/TROUBLESHOOTING.md` 현행화 (신규 이슈 추가, 구 이슈 아카이브)
   - `.docs/DEV_NOTE.md` 현행화 (수정 대기 항목 정리)
   - `.docs/MIGRATION_TODO.md` 현행화 (완료/미완료 재분류)
   - `.docs/private/ARCHIVE_DEPLOYMENT_SUPABASE.md` 구 배포 가이드 아카이브

4. **환경변수 예제 파일 신규 생성**
   - `.env.example` — Cloudflare API 토큰 플레이스홀더
   - `.dev.vars.example` — 시크릿 및 바인딩 변수 플레이스홀더

---

## 2026-04-23

### UI/UX 및 아키텍처 고도화 (Phase 8)

1. **시맨틱 컬러 시스템 (Design Tokens) 도입**
   - `tailwind.config.js`에 `surface`, `border`, `brand`, `text` 등 의미 기반 컬러 토큰 정의
   - 하드코딩된 색상 값을 시맨틱 클래스로 대체하여 일관성 및 유지보수성 향상

2. **통합 `Button` 컴포넌트 구축 및 적용**
   - `components/Button.tsx` 신규 생성으로 파편화된 버튼 스타일 통합
   - **Touch Feedback:** 모바일 탭 시 스케일 변화(`active:scale-[0.98]`) 및 투명도 조절 내장
   - 로그인, 게스트 등록, 리스트 액션 등 주요 화면 버튼 일괄 교체

3. **컴포넌트 코드 스플리팅 및 최적화**
   - 비대했던 `app/guest/page.tsx`를 `AuthenticatedGuestView`와 `ExternalDJGuestView`로 분리하여 모듈화
   - **커스텀 훅 도입:** `lib/hooks.ts`에 `useGuestPolling` 훅을 추가하여 데이터 갱신 로직 추상화 및 중복 제거

4. **UX 및 접근성 (A11y) 개선**
   - **명도 대비 최적화:** 어두운 배경에서 시인성이 낮은 텍스트 밝기 조정 (WCAG AA 기준 준수)
   - **스크린 리더 지원:** 아이콘 버튼 `aria-label` 추가 및 장식용 아이콘 `aria-hidden="true"` 부여

### Authon 포스트 마이그레이션 과제 및 AWS SES 통합 완료 (Phase 7)
...
1. **Miniflare 빌드 에러(SQLITE_BUSY) 해결**
   - `package.json`의 개발 및 빌드 스크립트에 `rm -rf .wrangler &&`를 추가하여 캐시 충돌로 인한 데이터베이스 락(Lock) 이슈 수정

2. **메일링 시스템 구축 (AWS SES 직접 연동)**
   - `aws4fetch` 패키지 설치 (`--legacy-peer-deps` 활용하여 Next.js 피어 의존성 충돌 해결)
   - Edge 런타임 호환되는 `lib/api/email.ts` 유틸리티 구현 및 AWS SES v2 API 호출 통합

3. **자체 비밀번호 재설정 흐름 구축**
   - `lib/db/schema.ts`에 `password_reset_tokens` 테이블 추가 및 Drizzle 마이그레이션 적용 (`migrations/0002_password_reset.sql`)
   - `app/api/auth/reset-password/route.ts` API 신설 (요청 및 실행)
   - `app/auth/reset-password/page.tsx` UI를 요청/초기화 모드로 구현

4. **D1 데이터베이스 타입 안정성 점검**
   - `schema.ts` 내 모든 `active` 및 `used` 컬럼을 `integer({ mode: 'boolean' })`으로 변경
   - `lib/api/guests.ts`의 모든 쿼리에서 `active: 1`을 `active: true`로, `active: 0`을 `active: false`로 사용하는 방식으로 타입 안정성 전수 개선

5. **유저 마이그레이션 전략 확립 (Admin UI 방식)**
   - 관리자 페이지(`app/admin`)에 `MIGRATE` 탭 추가
   - `LegacyUserMigration` 컴포넌트 신설 및 `public/local-users.json` 데이터 기반 API 연동
   - 데이터 이관 시 강제 비밀번호 변경을 위한 재설정 메일 발송 로직 워크플로우 통합

---

## 2026-04-22

### Cloudflare Workers 기반 신규 아키텍처로 마이그레이션 (`authon-worker`)

기존 정적 배포(Static Export) + Supabase 기반 구조에서 OpenNext + Cloudflare Workers 기반 구조로 전면 개편했습니다.

1. **프로젝트 환경 설정 및 기반 마련 (Phase 1)**
   - `@opennextjs/cloudflare`를 사용한 SSR 빌드 체계 도입
   - `wrangler.toml`에 D1 Database, KV Namespace 바인딩 구성
   - 정적 내보내기 설정(`output: "export"`) 제거 및 SSR 활성화
   - 기존 `authon` 프로젝트의 UI 에셋(app, components 등) 일괄 이관

2. **D1 데이터베이스 스키마 구성 (Phase 2)**
   - Supabase PostgreSQL 스키마를 Cloudflare D1(SQLite) 형식으로 마이그레이션
   - `drizzle-orm`을 활용한 서버사이드 데이터 조작 스키마(`lib/db/schema.ts`) 작성

3. **자체 JWT / KV 인증 시스템 구축 (Phase 3)**
   - Supabase Auth를 대체하는 자체 로그인 엔드포인트(`app/api/auth/login/route.ts`) 구현
   - `bcryptjs` 비밀번호 해싱 및 `jose` 라이브러리를 통한 JWT 발급
   - Cloudflare KV를 통한 세션 관리
   - Next.js 미들웨어(`middleware.ts`)에서 JWT 검증 및 경로 기반 접근 제어(RBAC) 통합

4. **데이터 페칭 로직 Server Actions 전환 (Phase 4)**
   - 기존 Supabase SDK를 직접 호출하던 `lib/api/guests.ts`의 로직 전면 폐기
   - `"use server"` 지시어 및 `@opennextjs/cloudflare`의 `getRequestContext()`를 활용해 `drizzle-orm`으로 D1에 직접 접근하도록 재구현

5. **Service Binding 수신 라우트 추가 (Phase 5)**
   - `terminal-2` 앱과 백그라운드에서 직접 통신하기 위한 `/api/internal/sync-guest` 라우트 구축
   - 터미널 게스트 등록 요청 시 D1에 즉각 레코드 삽입(`INSERT`) 되도록 구현

---

## 2026-03-17

### 게스트 이름 검색 기능 추가

1. **GuestSearchInput 공용 컴포넌트 신규 생성** — `components/GuestSearchInput.tsx`
   - 검색 아이콘(`ri-search-line`) + 텍스트 입력 + 초기화 버튼(`ri-close-line`) 구성
   - 프로젝트 디자인 시스템 준수: `font-mono`, `tracking-wider`, `uppercase`, `border-gray-700` 등
   - Props: `value`, `onChange`, `placeholder?`, `className?`

2. **게스트 목록 4곳에 검색 기능 적용**
   - `app/guest/page.tsx` — AuthenticatedGuestPage (인증 DJ 게스트 등록)
   - `app/guest/page.tsx` — ExternalDJGuestPage (외부 링크 게스트 등록)
   - `app/door/page.tsx` — DoorPageContent (Door 체크인)
   - `app/admin/components/GuestList.tsx` — Admin 게스트 관리
   - 각 페이지에 `searchQuery` 상태 추가, `PanelHeader` 직후 배치
   - 게스트 이름 기준 대소문자 무시 부분 일치 필터링

---

## 2026-03-06

### Chrome 달력 렌더링 이슈 수정 및 UI/UX 개선 (Mirroring UI)

1. **날짜 인풋 내부 요일 표시 (Mirroring UI)** — `components/DatePicker.tsx`, `app/admin/page.tsx`, `LinkManagement.tsx`
   - 실제 인풋을 투명하게 숨기고 그 위에 요일이 포함된 커스텀 레이어를 보여주는 기법 적용
   - `2026.03.07 (SAT)`와 같이 인풋 박스 내부에서 직접 요일을 확인할 수 있도록 시인성 극대화
   - `showPicker()` API를 통해 박스 어느 곳을 클릭해도 브라우저 달력이 열리도록 동작 사양 개선

2. **정적 빌드(Static Export) 안정화** — `lib/auth.ts`, `lib/supabase/client.ts`
   - 빌드 시점(SSR)에서 `localStorage` 및 `JSON.parse` 관련 런타임 에러 방지용 가드 추가
   - SSR 환경용 Supabase Mock Proxy를 구현하여 빌드 중 발생하는 부작용 차단 및 안정적 빌드 완료 기반 마련

3. **사용자 게스트 제한(Guest Limit) 실시간 동기화** — `components/AuthGuard.tsx`
   - 페이지 로딩/전환 시 백그라운드 데이터 동기화 로직 추가로 재로그인 없는 권한 반영 구현

---

## 2026-02-20

### 유저 삭제 실패 오류 수정

1. **에러 메시지 구체화** — `app/admin/components/UserManagement.tsx`
   - 삭제 실패 시 서버에서 반환하는 실제 에러 메시지를 alert에 표시하도록 변경
   - 기존: 항상 "Failed to delete user." → 변경: 서버 에러 메시지 우선 표시

2. **Edge Function 삭제 로직 안정화** — `supabase/functions/create-user/index.ts`
   - `userId` 필수값 검증 추가
   - `auth.admin.deleteUser()` 실패 시 "not found" 케이스는 무시하고 프로필 정리 계속 진행
   - `public.users` 행 삭제 실패도 graceful 처리 (auth user가 이미 삭제된 경우)
   - 각 단계별 상세 에러 로깅 추가

---

## 2026-02-21

### 모바일 UI 개선: 상하 여백 제거 및 날짜 선택 오버플로우 수정

1. **모바일 상하 흰색 여백 제거** — `app/layout.tsx`, `app/globals.css`
   - iOS 오버스크롤 시 `body` 배경색이 흰색으로 노출되던 문제 수정
   - `html`, `body`에 `bg-black` 적용하여 전체 테마 일치

2. **날짜 선택 input 우측 삐져나감 수정** — `components/DatePicker.tsx`, `app/admin/page.tsx`
   - `sm:w-auto sm:min-w-[250px]` 제거 → `w-full max-w-full box-border`로 변경
   - iOS Safari 전용: `appearance: none`, `min-width: 0` 적용으로 네이티브 date input overflow 근본 해결

3. **Footer 하단 불필요한 공간 제거** — `components/Footer.tsx`
   - border-t div의 `mt-4` 제거로 Footer 위 인위적 여백 해소

4. **iOS Safari 텍스트 입력 시 자동 줌 방지** — `app/globals.css`
   - `input`, `select`, `textarea`에 `font-size: 16px !important` 글로벌 적용
   - iOS Safari는 16px 미만 input에 focus 시 자동 확대하는데, `:root` font-size가 14px이어서 발생

5. **iOS Safari 하단 여백 근본 수정** — `app/layout.tsx`, `app/globals.css`
   - `min-h-screen (100vh)` → `100dvh` 글로벌 오버라이드 (동적 뷰포트 높이)
   - iOS Safari에서 `100vh`는 주소창을 포함한 고정 높이를 사용하여 여백이 발생했음
   - `viewport` export 추가: `maximum-scale=1` (줌 방지), `viewport-fit=cover` (노치/하단 안전 영역 대응)
   - `html`, `body`에 `overflow-x: hidden` 적용으로 가로 스크롤 원천 차단

6. **Link Management 리스트 모바일 스크롤 제거** — `app/admin/components/LinkManagement.tsx`
   - 모바일 화면에서 링크 리스트의 내부 스크롤(`max-h-[500px]`) 제거
   - 게스트 리스트와 동일하게 페이지 전체 스크롤을 사용하도록 개선하여 사용성 향상

7. **Spinner Loading UI 및 레이아웃 안정성 개선** — `components/Spinner.tsx`, `components/PanelHeader.tsx`, `app/admin/...`
   - Admin/Door 페이지 등 리스트 영역 데이터 갱신 시 컴포넌트 언마운트 대신 리스트 투명화(`opacity-50`) + `pointer-events-none` 방식으로 전환
   - 이로 인해 모바일 기기 등에서 데이터 로딩 시 컨테이너 높이가 줄어들며 화면이 덜컹거리는 Layout Shift 현상 원천 차단
   - `PanelHeader`에 `isLoading` 연동하여 리스트 갱신 중 `REFRESH` 아이콘에 부드러운 회전 애니메이션 적용
   - `<Spinner mode="inline" />`에 `min-h-[200px]` 최소 높이를 부여하여 최초 데이터 로딩 시 로딩 아이콘 좌측 상단 쏠림 현상 해결 (정중앙 예쁘게 위치 보정)
   - `useRef` 기반 표시 데이터 동결(display cache) 패턴 적용: 날짜 변경 등 데이터 갱신 중 이전 데이터를 화면에 그대로 유지하여 사이드바 숫자(`...` → 실제값), StatGrid(0 리셋 방지), 리스트(빈 화면 전환 방지) 모두 안정적으로 표시

## 2026-02-20

### 이메일 인증 흐름 강화 및 크로스 브라우저 호환성 개선

1. **비밀번호 재설정 페이지 안정화 및 에러 핸들링** — `app/auth/reset-password/page.tsx`
   - URL 쿼리 파라미터(`?error_description=...`) 감지 및 UI 표시 로직 추가
   - 토큰 검증 로직을 비밀번호 제출 시점(`handleSubmit`)으로 이동하여 **이용자 이탈 시 링크 무효화 방지**
   - `useRef` 가드를 사용하여 `useEffect` 내 중복 실행으로 인한 토큰 만료 원천 차단

2. **회원가입 확인 전용 페이지 신규 생성** — `app/auth/confirm/page.tsx`
   - `token_hash`를 이용한 회원가입 확인(`type=signup`) 처리 로직 구현
   - 향후 직접 가입 기능 활성화에 대비한 예비 페이지로 유지

3. **이메일 템플릿 최적화 (token_hash 방식 전환)** — `.docs/email/*`
   - `confirm-signup.html`, `invite.html`, `reset-password.html` 내 링크를 PKCE(`ConfirmationURL`) 방식에서 `token_hash` 방식으로 변경 권장 가이드 업데이트
   - 스타일(`Courier New`, 간격 등)은 유지하면서 기술적 호환성 확보

### UI 폭/StatGrid 배치 추가 조정

1. **메인 유저 Role 표기 가독성 정리** — `app/page.tsx`
   - 유저 정보 영역의 role 표기를 코드값(`venue_admin`) 그대로 노출하지 않도록 수정
   - `_`를 공백으로 치환하고 대문자로 표시 (`VENUE ADMIN`)

2. **비밀번호 재설정 세션 검증 안정화** — `app/auth/reset-password/page.tsx`
   - `checkSession` 전체를 `try-catch-finally`로 감싸 예외 상황에서도 `isValidating`이 항상 해제되도록 수정
   - 검증 중 오류 발생 시 사용자에게 링크 검증 실패 메시지를 표시하도록 개선
   - (추가 업데이트) URL 쿼리 파라미터 에러 감지 및 중복 실행 방지 로직 적용

3. **RoleLabel 공통 컴포넌트 추출/적용**
   - 신규: `components/RoleLabel.tsx`
   - 적용: `app/page.tsx`, `app/profile/page.tsx`, `app/admin/components/UserManagement.tsx`
   - role 표기를 화면별 개별 로직 대신 단일 포맷(`_` → 공백, 대문자)으로 통일

4. **페이지 최대 폭 확장**
   - 메인과 서브 페이지 공통 컨테이너 폭을 `max-w-4xl` → `max-w-6xl`로 확장
   - 적용 파일: `app/page.tsx`, `app/admin/page.tsx`, `app/door/page.tsx`, `app/guest/page.tsx`, `app/profile/page.tsx`, `app/admin/components/AdminHeader.tsx`

5. **StatGrid 3개 항목 배치 규칙 개선** — `components/StatGrid.tsx`
   - 기본 2열 유지
   - 항목 수가 홀수(예: 3개)일 때 마지막 항목은 하단에서 `col-span-2`로 전체 폭 사용
   - 4개 항목은 2x2 배치 유지

6. **Edge Function 오류 메시지 사용자화** — `lib/api/guests.ts`
   - `Edge Function returned a non-2xx status code` 같은 기술 문구를 사용자 친화 fallback 메시지로 변환
   - 대상: 외부 링크 검증/게스트 등록/게스트 삭제/유저 초대 생성/유저 삭제
   - 링크 비활성/만료/유효하지 않음 등 서버에서 내려주는 도메인 메시지는 그대로 노출

7. **게스트 체크인 확인 메시지 추가** — `components/GuestListCard.tsx`
   - Door/Admin 화면의 `CHECK` 버튼 클릭 시 확인 대화상자 표시
   - 확인한 경우에만 체크인 상태 변경 실행

8. **인증 이메일 템플릿 영문화 + 호환성 강화** — `.docs/email/*`
   - `confirm-signup.html`, `invite.html`, `reset-password.html` 문구를 영문으로 통일
   - 이메일 클라이언트 호환성을 위해 table 기반 구조/인라인 스타일로 정리
   - 깨짐 원인이 될 수 있는 `rgba`, `min-height: 100vh`, `div` 중심 정렬 스타일 제거

9. **PKCE 플로우 지원 추가 + signOut 순서 수정** — `app/auth/reset-password/page.tsx`
   - `@supabase/ssr`의 기본 PKCE 인증 플로우에 대응하여 `?code=` 쿼리 파라미터 교환 로직 추가
   - `signOut({ scope: 'local' })`이 PKCE code-verifier 쿠키까지 삭제하여 code exchange 실패하는 버그 수정
   - `signOut`을 PKCE code exchange 이후로 이동 (non-PKCE fallback 전 단계로 변경)
   - Supabase 에러 리다이렉트(`#error=`, `#error_description=`) 처리 추가
   - 기존 implicit flow(hash fragment)와 magic-link(token_hash) 는 그대로 유지 (하위 호환)

10. **배포 가이드 Supabase Auth URL 설정 업데이트** — `.docs/DEPLOYMENT.md`
    - SITE_URL 및 Redirect URLs에 실제 운영 도메인(`guest.faustseoul.kr`) 반영
    - PKCE 플로우 필수 설정 안내 추가
    - Supabase 무료 티어 이메일 발송 한도(시간당 3건) 안내 추가

### MVP 마무리 UI/권한 정리

1. **StatGrid 2열 최대 표시 규칙 적용** — `components/StatGrid.tsx`
   - 통계 카드를 최대 2개까지 가로로 배치
   - 3개 이상 항목은 자동으로 다음 줄로 내려가도록 변경

2. **Door 화면 게스트 삭제 비활성화** — `app/door/page.tsx`
   - Door 목록 카드에서 삭제 액션 제거
   - Door 권한은 체크인 동작만 수행하도록 제한

3. **페이지 가로 폭 메인 기준 통일 (`max-w-6xl`)**
   - `app/admin/page.tsx`
   - `app/door/page.tsx`
   - `app/guest/page.tsx` (헤더/본문 컨테이너)
   - `app/profile/page.tsx` (헤더/본문 컨테이너)
   - `app/admin/components/AdminHeader.tsx`

## 2026-02-21

### 서비스 사용자 메시지 영어화 (Korean → English)

1. **UI 사용자 노출 문구 전환**
   - `app/guest/page.tsx`, `app/auth/*`, `app/profile/page.tsx`
   - `app/admin/components/InviteUser.tsx`, `UserManagement.tsx`, `VenueManagement.tsx`, `LinkManagement.tsx`
   - 에러/성공 알림, 확인 대화상자, 버튼 라벨, 안내 문구를 영어로 통일

2. **클라이언트 fallback 메시지 전환**
   - `lib/auth.ts`, `lib/api/guests.ts`
   - 로그인/권한/생성 실패 fallback 메시지를 영어로 통일

3. **Edge Function 응답 메시지 전환**
   - `supabase/functions/create-user/index.ts`
   - `supabase/functions/external-dj-links/index.ts`
   - `supabase/functions/admin-applications/index.ts`
   - `supabase/functions/auth-login/index.ts`
   - `supabase/functions/auth-register/index.ts`
   - `supabase/functions/auth-login-new/index.ts`
   - `supabase/functions/admin-users/index.ts`
   - 프론트엔드로 전달되는 `message`/`error` payload를 영어로 통일

4. **검증**
   - 문자열 리터럴 기준 Hangul 재스캔 결과(`app/**/*.tsx`, `lib/**/*.ts`, `supabase/functions/**/*.ts`) 사용자 노출 한글 0건 확인

## 2026-02-20

### 캘린더 날짜가 2월 18일로 고정되던 이슈 수정

1. **근본 원인** — `lib/date.ts`
   - `getBusinessDate()`에서 로컬 영업일 계산 후 `toISOString()`(UTC)로 날짜를 추출하면서 날짜가 추가로 하루 밀리는 문제 발생
   - 새벽 시간대(06시 이전)에는 전날 보정 + UTC 변환이 겹쳐 최대 2일 전 날짜가 표시될 수 있었음

2. **수정 내용**
   - `getBusinessDate()`를 로컬 기준 `YYYY-MM-DD` 포맷 함수로 변경 (UTC 변환 제거)
   - `formatDateDisplay()`는 `YYYY-MM-DD` 문자열을 직접 파싱하여 로컬 타임존 오프셋 영향을 받지 않도록 개선

### 상태 카드 메시지 컬러 체계 정리

### 모바일 Guest List 높이/오버플로 수정

1. **모바일 Guest List 패널 고정 높이 해제** — `app/globals.css`
   - `main-content-panel`의 기본 `min-h`를 `min-h-0`으로 변경
   - 큰 화면(`lg`)에서는 기존처럼 `min-h-[520px]` 유지

2. **게스트 입력행 overflow 수정** — `app/guest/page.tsx`
   - `Enter guest full name` 입력행 컨테이너에 `min-w-0` 적용
   - 입력창에 `min-w-0` 적용
   - 저장 버튼에 `shrink-0` 및 모바일 패딩 축소(`px-3`) 적용
   - 결과: 좁은 모바일 폭에서도 입력행이 박스를 벗어나지 않도록 개선

### Link Management 활성/비활성 UX 개선

1. **비활성화 확인 절차 추가** — `app/admin/components/LinkManagement.tsx`
   - `DEACTIVATE` 클릭 시 확인 대화상자 표시

2. **재활성화 기능 추가**
   - 비활성 링크에 `ACTIVATE` 버튼 노출
   - 다시 활성 상태로 전환 가능

3. **작업 피드백 메시지 추가**
   - 비활성화/활성화/삭제 성공 시 성공 알림 표시
   - 실패 시 에러 알림 표시

4. **API 추가** — `lib/api/guests.ts`
   - `activateExternalLink(linkId)` 함수 추가

#### 상태 라벨 오버플로 및 색상 충돌 보정

1. **상태 라벨 박스 이탈 방지** — `components/StatGrid.tsx`
   - 셀에 `min-w-0` 적용
   - 라벨에 `leading-tight`, `whitespace-normal`, `break-words`, `px-1` 적용
   - 기본 라벨 폰트 크기를 `text-[10px] sm:text-xs`로 조정

2. **REMAINING/ CHECKED 색상 구분** — `app/guest/page.tsx`
   - `REMAINING` 색상을 기본 green에서 cyan으로 변경
   - 한도 도달 시에는 기존처럼 red 유지

3. **의미색 매핑 적용**
   - `WAITING` → yellow
   - `CHECKED` / `ACTIVE` → green
   - `REMAINING` → green(정상), red(한도 도달)
   - `EXPIRED` / `INACTIVE` → red
   - `TOTAL *` / `REGISTERED` → cyan
   - `MAX` → blue

4. **공통 컴포넌트 개선** — `components/StatGrid.tsx`
   - 값 색상(`color`)을 라벨에도 반영하도록 라벨 컬러 매핑 추가

5. **적용 파일**
   - `app/admin/components/GuestList.tsx`
   - `app/admin/components/LinkManagement.tsx`
   - `app/admin/components/UserManagement.tsx`
   - `app/admin/components/VenueManagement.tsx`
   - `app/door/page.tsx`
   - `app/guest/page.tsx`

### Footer 위치 동작 메인 페이지와 통일

#### UserManagement 상태 표시 단일화

1. **중복 상태 UI 제거** — `app/admin/components/UserManagement.tsx`
   - 카드 상단의 `비활성` 배지 제거
   - 상태는 `Status` 항목의 `ACTIVE/INACTIVE` 텍스트에서만 표시하도록 통일

#### Footer 상단 여백 원인 제거 (`pb-6`)

1. **원인 분석 결과**
   - Footer 자체 높이 차이가 아니라, Footer 상위 컨테이너의 `pb-6`로 인해 Footer 위에 인위적 여백이 생성됨

2. **전체 정리 적용 파일**
   - `app/admin/page.tsx`
   - `app/door/page.tsx`
   - `app/guest/page.tsx` (외부 DJ / 인증 DJ 두 플로우)
   - `app/profile/page.tsx`
   - `app/page.tsx`
   - `app/globals.css` (`.page-scroll`)

3. **조치 내용**
   - Footer 직전 래퍼에서 `pb-6` 제거
   - 결과: 모든 페이지의 Footer 상단 간격을 메인 페이지 기준으로 통일

#### Footer 높이 픽셀 기준 통일

1. **Footer compact/default 높이 동일화** — `components/Footer.tsx`
   - compact 모드의 `pt-6` 제거
   - compact/default 모두 `border-t + py-4`로 통일
   - 결과: 메인 페이지 Footer와 auth/외부 링크 등 compact Footer의 높이 차이 제거

2. **Footer 상단 간격 미세 조정** — `components/Footer.tsx`
   - Footer 내부 구분선 컨테이너에 `mt-2` 적용
   - 결과: 메인 콘텐츠와 Footer가 너무 붙어 보이지 않도록 여백 확보

3. **PageLayout 스크롤 구조 변경** — `app/globals.css`
   - `page-shell`: `h-screen` → `min-h-screen`
   - `page-scroll`: 내부 고정 스크롤(`overflow-y-auto`) 제거
   - 결과: 서브 페이지도 메인 페이지처럼 문서 전체 스크롤 기반으로 동작하여, 작은 화면 높이에서 Footer가 본문을 가리는 현상 해소

4. **외부 DJ 게스트 페이지 오버라이드 정리** — `app/guest/page.tsx`
   - `scrollClassName`에서 내부 스크롤 관련 클래스 제거
   - 공통 레이아웃 동작과 일치하도록 조정

5. **회원가입 안내 페이지 Footer 위치 통일** — `app/auth/register/page.tsx`
   - 카드 내부 Footer를 페이지 하단 Footer로 이동
   - 메인 페이지와 동일한 페이지 레벨 Footer 배치로 정렬

6. **PageLayout 완전 제거 + 메인 방식으로 통일**
   - 적용 파일: `app/admin/page.tsx`, `app/door/page.tsx`, `app/guest/page.tsx`, `app/profile/page.tsx`
   - 기존 `PageLayout` 래퍼를 제거하고, 모든 페이지를 메인과 동일한 구조(`min-h-screen` + 직접 Header/Content/Footer 배치)로 치환
   - `components/PageLayout.tsx` 파일 제거

7. **검증 완료**
   - Docker 환경에서 프로덕션 빌드 성공 확인

---

## 2026-02-21

### UI 공유 컴포넌트 대규모 리팩토링

전체 코드베이스에서 반복되는 UI 패턴을 분석하여 7개의 공유 컴포넌트를 생성하고 10개 파일에 적용.

1. **새로 생성된 공유 컴포넌트** — `components/`
   - `StatGrid` — 통계 박스 그리드 (기존 7곳의 중복 코드 통합)
   - `PanelHeader` — 섹션 헤더 + Sort/Refresh 버튼 (기존 8곳 통합)
   - `VenueSelector` + `useVenueSelector` 훅 — super_admin 베뉴 선택 UI+로직 (기존 5곳 통합)
   - `DatePicker` — 날짜 선택 패널 (기존 3곳 통합)
   - `Alert` — 에러/성공 알림 메시지 (기존 13곳 통합)
   - `EmptyState` — 빈 데이터 플레이스홀더 (기존 7곳 통합)
   - `Spinner` — 로딩 스피너 3종 모드: fullscreen/inline/button (기존 15+곳 표준화)

2. **적용된 페이지/컴포넌트**
   - `app/admin/components/GuestList.tsx` — StatGrid, PanelHeader, VenueSelector, Spinner, EmptyState
   - `app/admin/components/LinkManagement.tsx` — StatGrid, PanelHeader, VenueSelector, Spinner, EmptyState, Alert
   - `app/admin/components/UserManagement.tsx` — StatGrid, PanelHeader, VenueSelector, Spinner
   - `app/admin/components/VenueManagement.tsx` — StatGrid, PanelHeader, Spinner, Alert
   - `app/door/page.tsx` — VenueSelector, DatePicker, StatGrid, PanelHeader, Spinner, EmptyState
   - `app/guest/page.tsx` — StatGrid, PanelHeader, Spinner, EmptyState, Alert, VenueSelector, DatePicker
   - `app/profile/page.tsx` — Spinner, Alert
   - `app/page.tsx` — Spinner
   - `app/auth/login/page.tsx` — Alert
   - `app/auth/reset-password/page.tsx` — Spinner, Alert

3. **기술적 수정 사항**
   - StatGrid: Tailwind JIT 동적 클래스(`grid-cols-${N}`) 문제 해결 → 명시적 조건 매핑
   - VenueSelector: `placeholder` prop 추가 (UserManagement 'ALL VENUES' 케이스 지원)
   - StatGrid: `labelClassName` prop으로 라벨 텍스트 크기 커스터마이즈 지원

4. **검증 완료**
   - Docker 환경에서 프로덕션 빌드 성공 확인 (정적 내보내기 11페이지)

---

## 2026-02-20

### Invite 플로우 복원 + 세션 충돌 수정

1. **기존 Invite 방식 복원** — `supabase/functions/create-user/index.ts`
   - EMAIL INVITE 모드를 `inviteUserByEmail()` 기반으로 복원
   - 초대 성공 메시지를 기존 흐름에 맞게 정리 (`초대 이메일이 전송되었습니다.`)

2. **초대 링크 비밀번호 설정 세션 충돌 수정** — `app/auth/reset-password/page.tsx`
   - 페이지 진입 시 로컬 기존 세션(관리자 로그인 등)을 먼저 정리
   - URL hash/query에서 `type`, `access_token`, `refresh_token`, `token_hash`를 우선 파싱
   - `setSession()` 또는 `verifyOtp()`로 invite/recovery 토큰 세션을 우선 확정
   - 이로 인해 비밀번호 변경 시 잘못된 사용자 세션으로 처리되던 문제 해결

3. **오류 메시지 정리** — `app/auth/reset-password/page.tsx`
   - invite 충돌 시 우회 문구 대신 Supabase 원본 오류를 그대로 표시하여 진단 가능성 향상

4. **검증 완료**
   - Docker 환경에서 프로덕션 빌드 성공 확인
   - `create-user` Edge Function 재배포 완료

### UI 통일성 개선 + Footer/콘텐츠 높이 정리

1. **공통 페이지 레이아웃 클래스 도입** — `app/globals.css`
   - `page-shell`, `page-scroll`, `page-container`, `main-content-panel` 컴포넌트 클래스 추가
   - 페이지별 반복 하드코딩 클래스 축소 및 구조 일관성 강화

2. **Footer 위치 통일** — `app/page.tsx`, `app/profile/page.tsx`, `components/Footer.tsx`
   - 메인/프로필 페이지 Footer를 카드 하단 부착 방식에서 브라우저 하단 영역 방식으로 변경
   - Footer 내부 여백 규칙 통일 (`py-4`)

3. **메인 콘텐츠 최소 높이 상향** — `app/door/page.tsx`, `app/guest/page.tsx`, `app/admin/page.tsx`, `app/admin/components/GuestList.tsx`
   - 게스트 리스트 등 핵심 카드에 `main-content-panel` 적용
   - `min-h-[460px]` / `lg:min-h-[520px]` 기준으로 콘텐츠 잘림 방지

### Footer/PageLayout 컴포넌트 리팩토링

1. **`Footer` 컴포넌트 리팩토링** — `components/Footer.tsx`
   - `compact` prop 추가: 앱 페이지용 (border-t + mt-auto) / 인증 카드 내부용 (compact) 두 가지 변형
   - `<div>` → `<footer>` 시맨틱 태그 변경
   - border-t 구분선, mt-auto 하단 고정을 Footer 자체에 포함시켜 외부 래퍼 불필요

2. **`PageLayout` 공통 레이아웃 컴포넌트 신규 생성** — `components/PageLayout.tsx`
   - `page-shell` → `header` → `page-scroll`(`page-container` + `Footer`) 구조를 단일 컴포넌트로 통일
   - `header` prop으로 AdminHeader, 커스텀 헤더 등 교체 가능
   - `scrollClassName` prop으로 스크롤 영역 클래스 오버라이드 가능 (외부 DJ 게스트 페이지 등)

3. **전체 앱 페이지 PageLayout 적용** — `admin`, `door`, `guest`, `profile`
   - 기존 page-shell/page-scroll/page-container/Footer 보일러플레이트 코드 제거
   - `<PageLayout header={...}>` 단일 래퍼로 교체

4. **홈 페이지 Footer 통일** — `app/page.tsx`
   - 기존 `border-t` + `max-w-4xl` 래퍼 제거, Footer 자체의 border-t 사용

5. **인증 페이지 Footer 통일** — `app/auth/login/page.tsx`, `app/auth/reset-password/page.tsx`
   - `<Footer compact />` 적용 (카드 내부용, border-t 없음)

## 2026-02-19 (2차)

### 프로젝트 전체 코드 리뷰 및 버그 수정

#### CRITICAL 수정

1. **used_guests 이중 증가 수정** — `external-dj-links` Edge Function
   - DB 트리거(`on_guest_created_increment_link`)와 Edge Function의 수동 increment가 동시 실행되어 used_guests가 2씩 증가하던 버그 수정
   - Edge Function의 수동 increment 코드 제거 (DB 트리거에 위임)

2. **RLS UPDATE 정책 수정** — `schema.sql`, 마이그레이션 추가
   - staff/dj의 게스트 soft-delete(UPDATE) 시 RLS 에러 발생하던 문제 수정
   - UPDATE 정책에 `staff`, `dj` 역할 추가

3. **database.types.ts 타입 정합성 수정**
   - `guests` 테이블에 `created_by_user_id` 필드 누락 → 추가
   - `users` 테이블 `venue_id`를 `string | null`로 변경 (super_admin은 NULL 허용)

4. **middleware.ts 및 server.ts 제거**
   - `output: "export"` (static export) 환경에서 Next.js 미들웨어는 실행되지 않음
   - 서버 전용 Supabase 클라이언트(`lib/supabase/server.ts`)도 사용처 없으므로 삭제
   - 인증은 클라이언트 측 `AuthGuard`에서 전적으로 처리

#### HIGH 수정

5. **깨진 초대 페이지 제거** — `app/auth/invite/[id]`
   - localStorage 기반 초대 흐름이 Supabase Auth 전환 이후 완전히 작동 불가
   - Supabase `inviteUserByEmail()`은 `/auth/reset-password`로 리다이렉트하므로 별도 초대 페이지 불필요
   - `app/auth/invite` 디렉토리 전체 삭제

6. **프로필 이름 변경 DB 저장 추가** — `app/profile/page.tsx`
   - 이름 변경 시 localStorage만 업데이트하고 Supabase DB에 반영하지 않던 문제
   - `updateUserProfile()` API 호출 추가

7. **door_staff 권한 정리** — `lib/auth.ts`
   - `hasAccess`에서 `door_staff`가 `guest` 스코프를 가지고 있었으나 RLS INSERT 정책과 불일치
   - `door_staff`는 출입 관리만 수행하므로 `guest` 접근 제거 → `['door']`만 유지

#### MEDIUM/LOW 수정

8. **door 페이지 fetchVenues 동적 import → 정적 import 통일** — `app/door/page.tsx`
9. **brand.ts 연도 하드코딩 → `new Date().getFullYear()` 동적 생성** — `lib/brand.ts`
10. **tailwind.config.js content 경로 오타 수정** — `libs` → `lib`
11. **onKeyPress deprecated → onKeyDown 교체** — `app/guest/page.tsx`
12. **html lang 속성 `en` → `ko` 변경** — `app/layout.tsx`
13. **404 페이지 앱 다크 테마 적용** — `app/not-found.tsx`
14. **미사용 Pacifico 폰트 제거** — `app/layout.tsx`
15. **Dockerfile에 package-lock.json 포함** — 결정적 빌드 지원

---

## 2026-02-19

### 멀티 브랜드 배포 지원 (환경변수 기반)

#### 1. 브랜드 공통 설정 추가 — `lib/brand.ts`

- `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_TAGLINE`, `NEXT_PUBLIC_BRAND_DESCRIPTION`, `NEXT_PUBLIC_BRAND_FOOTER` 지원
- 미설정 시 기본값은 기존 브랜드(`Authon`)로 유지

#### 2. UI 하드코딩 브랜드 제거

- `app/layout.tsx` 메타데이터 title/description을 브랜드 설정 기반으로 변경
- 홈/로그인/리셋/초대/게스트/어드민 헤더/푸터 텍스트를 공통 브랜드 상수로 통일
- `register` 페이지 하단 문구를 공통 `Footer` 컴포넌트로 정리

#### 3. 배포 전략 반영

- 단일 코드베이스로 다중 브랜드 배포 가능 (Cloudflare Pages 프로젝트별 환경변수 분리)

---

## 2025-02-20

### 임시 비밀번호 모드 추가 & 영업일 날짜 롤오버 해결

#### 1. 사용자 생성 듀얼 모드 — `InviteUser.tsx`, `create-user Edge Function`

- 기존 이메일 초대(inviteUserByEmail) 방식 유지 + 임시 비밀번호(createUser) 방식 추가
- UI에서 EMAIL INVITE / TEMP PASSWORD 모드 토글
- 임시 비밀번호 모드: admin이 비밀번호 지정 → 즉시 계정 생성 → 사용자에게 전달 후 변경 안내
- Edge Function: `password` 필드 유무로 분기 처리, `tempPassword` 응답 포함

#### 2. 영업일 날짜 롤오버 — `lib/date.ts`

- 클럽 이벤트 특성 반영: 오전 6시 이전은 전날 영업일로 처리
- `getBusinessDate()`: 현재 시각 기준 영업일 YYYY-MM-DD 반환
- `formatDateDisplay()`: YYYY.MM.DD 표시 형식 통일
- door, guest, admin 페이지에 적용, 모든 중복 로컬 함수 제거

#### 3. formatDateDisplay 공통화

- 5개 파일(door, guest×2, admin, LinkManagement)의 중복 `formatDateDisplay` 제거
- GuestList.tsx의 `formatDate` → `formatDateDisplay`로 통일
- `lib/date.ts`에서 단일 import로 관리

---

## 2025-02-19

### 비밀번호 관리 기능 개선 & 초대 기반 사용자 생성 전환

#### 1. 프로필 비밀번호 변경 수정 — `app/profile/page.tsx`

- 기존: localStorage에만 저장 (Supabase Auth 미연동)
- 변경: `signInWithPassword()`로 현재 비밀번호 검증 + `updateUser({ password })`로 실제 비밀번호 변경

#### 2. 비밀번호 찾기 기능 추가 — `app/auth/login/page.tsx`

- 로그인 화면에 "FORGOT PASSWORD?" 토글 추가
- `resetPasswordForEmail()`로 재설정 링크 이메일 발송
- 성공/에러 메시지 표시

#### 3. 비밀번호 재설정 페이지 신규 — `app/auth/reset-password/page.tsx`

- 이메일 링크 클릭 시 새 비밀번호 설정 페이지
- Supabase URL hash fragment(`#access_token=...`) 자동 처리
- `PASSWORD_RECOVERY` 이벤트 감지 → 새 비밀번호 입력 → `updateUser()` 호출
- 유효하지 않은 링크 / 성공 / 로딩 상태별 UI 분기

#### 4. 초대 기반 사용자 생성 전환

- **Edge Function** (`supabase/functions/create-user/index.ts`)
  - `admin.createUser()` → `admin.inviteUserByEmail()` 변경
  - admin이 비밀번호를 지정하지 않고, 사용자가 이메일 초대 링크를 통해 직접 설정
  - `app_metadata` 별도 `updateUserById()` 호출 추가
  - 필수 필드에서 password 제거
- **InviteUser UI** (`app/admin/components/InviteUser.tsx`)
  - 화면 제목: "CREATE NEW USER" → "INVITE USER"
  - 비밀번호 입력 필드 제거
  - 성공 메시지: "계정이 생성되었습니다" → "초대 이메일이 전송되었습니다"
  - 버튼: "CREATE USER" → "SEND INVITATION"
- **API 레이어** (`lib/api/guests.ts`)
  - `createUserViaEdge` 파라미터에서 `password` 필드 제거

---

## 2026-02-19

### Role 체계 세분화 — Door → Door Staff / Staff 분리

기존 `door` 역할을 `door_staff`와 `staff`로 분리하여 5단계 역할 체계로 확장.

| 역할          | 메뉴 접근                 | 주요 권한                                         |
| ------------- | ------------------------- | ------------------------------------------------- |
| `super_admin` | Guest, Door, Admin, Venue | 전체 플랫폼 관리, 모든 베뉴 접근                  |
| `venue_admin` | Guest, Door, Admin        | 소속 베뉴 관리, 사용자 생성·삭제                  |
| `door_staff`  | Guest, Door               | 게스트 조회 + 체크인(UPDATE), 등록·삭제 불가      |
| `staff`       | Guest                     | 게스트 등록·삭제(INSERT/DELETE), guest_limit 적용 |
| `dj`          | Guest                     | 게스트 등록·삭제(INSERT/DELETE), guest_limit 적용 |

**변경 파일:**

- `lib/auth.ts` — `hasAccess` 맵에 `door_staff`, `staff` 추가
- `lib/database.types.ts` — Row/Insert/Update 타입 확장
- `lib/api/guests.ts` — User 인터페이스, `createUserViaEdge` 파라미터 타입 확장
- `app/admin/components/UserManagement.tsx` — `getRoleLabel`, `getRoleColor`, `editableRoles`, 통계 카운트 4열 확장
- `app/admin/components/InviteUser.tsx` — roleOptions에 `STAFF` 추가, guest_limit을 `dj`/`staff` 모두 표시, 그리드 정적 분기
- `supabase/schema.sql` — CHECK 제약, RLS 정책 전면 업데이트
- `supabase/functions/admin-applications/index.ts` — `'DJ'` 대문자 비교 버그 수정 + `staff` guest_limit 분기
- `supabase/migrations/20250219_role_split_door_to_door_staff_and_staff.sql` — 마이그레이션 SQL 신규 생성

---

## 2026-02-13

### Bug Fixes & UI Improvements

1. **External Link 게스트 상태 표시 수정** — `app/guest/page.tsx`
   - 체크인된 게스트(`checked`)가 "ACTIVE"로 표시되도록 변경 (기존: 항상 "REGISTERED")
   - 미체크인 게스트는 회색 "REGISTERED" 뱃지로 구분
   - 체크인 시각(`IN: HH:MM`) 표시 추가

2. **Guest 등록 페이지 입장 시간 표시** — `app/guest/page.tsx`
   - AuthenticatedGuestPage에 등록 시각(회색) 및 입장 시각(녹색 `IN:`) 표시 추가

3. **Admin 탭 메뉴 가로 레이아웃 수정** — `app/admin/page.tsx`
   - `grid-cols-${tabs.length}` 동적 클래스를 정적 분기로 변경 (Tailwind 퍼지 대응)
   - super_admin 4탭 시 가로 정렬이 정상 동작

4. **게스트 목록 가나다(ABC) 정렬 토글 추가** — `app/guest/page.tsx`, `app/door/page.tsx`, `app/admin/components/GuestList.tsx`
   - 기본 정렬과 이름 기준 정렬을 버튼으로 전환
   - 외부 DJ/인증 DJ/도어/관리자 모든 목록에 적용

5. **신규 게스트가 1번으로 들어가는 문제 수정** — `app/guest/page.tsx`, `app/door/page.tsx`, `app/admin/components/GuestList.tsx`
   - 기본 정렬을 등록순(생성 시각 오름차순)으로 고정
   - 기존 게스트 뒤로 신규 게스트가 추가되어 번호가 유지됨

6. **브라우저 스크롤 제거** — `app/layout.tsx`, `app/guest/page.tsx`, `app/door/page.tsx`, `app/admin/page.tsx`
   - 전체 페이지 스크롤을 막고 게스트 리스트만 내부 스크롤로 유지

7. **전체 UI 크기 2pt 축소** — `app/globals.css`
   - `:root` 폰트 크기를 16px → 14px로 조정하여 전체 레이아웃 축소

8. **카드 하단 패딩 정렬** — `app/admin/components/InviteUser.tsx`, `app/admin/components/VenueManagement.tsx`
   - 일부 카드의 하단 패딩을 공통 비율(p-4 sm:p-5)로 통일

9. **전체 페이지 레이아웃 비율 재조정** — `app/guest/page.tsx`, `app/door/page.tsx`, `app/admin/page.tsx`, `app/admin/components/GuestList.tsx`
   - 고정 `max-height:calc(100vh-320px)` 방식을 **Flexbox 기반 자동 높이 할당**으로 전환
   - 각 페이지 루트(`h-screen`)부터 스크롤 리스트까지 `flex flex-col → flex-1 min-h-0` 체인 적용
   - 게스트 리스트가 남은 뷰포트 공간을 자동으로 채워 페이지마다 하단 여백이 일관되게 유지
   - 모바일에서는 콘텐츠 전체가 `overflow-y-auto`로 스크롤, 데스크톱에서는 리스트만 내부 스크롤
   - Admin 페이지 `pb-6` → `pb-4`로 통일
   - 사이드바 열에 `lg:overflow-y-auto` 추가 (콘텐츠 초과 시 스크롤 대응)
   - 게스트가 적거나 없을 때 카드가 뷰포트 끝까지 강제 확장되지 않도록 `flex-1` 제거 → `lg:max-h-full` 방식 전환
   - 빈 게스트 리스트 안내 메시지를 별도 카드에서 **게스트 리스트 카드 내부**로 통합
   - 커스텀 드롭다운 화살표 우측 여백 확보 (텍스트/아이콘 간격 및 패딩 보정)
   - 정보 카드 텍스트 줄바꿈 처리로 박스 밖으로 넘침 방지
   - 모든 `select` 드롭다운에 커스텀 화살표와 우측 패딩 적용 (PC 기준 화살표 여백 개선)
   - GUEST REGISTRATION 통계 라벨(WAITING/CHECKED/REMAINING) 줄바꿈 및 자간 조정
   - PC 기준 컨테이너 너비를 1200px로 고정하고 좌우 40px 여백 적용 (총 1280px 레이아웃)
   - 모바일 그리드 간격 통일: 모든 페이지/컴포넌트의 카드 간격을 `gap-4 lg:gap-6`으로 정규화
   - 모바일 필터 영역 마진 축소: `mb-6` → `mb-4 lg:mb-6`으로 변경하여 화면 효율 향상
   - 스크롤 하단 여백 추가: `pb-4` → `pb-6`으로 확대하여 마지막 카드 하단에 충분한 여백 확보
   - **모바일 카드 간 빈 공간 제거**: `flex-1 min-h-0`를 `lg:flex-1 lg:min-h-0`으로 변경하여 모바일에서 그리드가 뷰포트 전체로 늘어나는 문제 해결 (데스크톱에서만 고정 높이 레이아웃 유지)
   - 적용 대상: Guest(External/Auth), Door, Admin, GuestList, UserManagement, LinkManagement, VenueManagement

---

## 2026-02-12

### Bug Fixes

1. **Guest Limit 적용** — `app/guest/page.tsx`
   - `AuthenticatedGuestPage`에서 `user.guest_limit`에 따라 날짜별 게스트 등록 수 제한
   - 사이드바에 REMAINING 카운터 추가 (3열 그리드: WAITING / CHECKED / REMAINING)
   - 리밋 도달 시 입력 영역 대신 "GUEST LIMIT REACHED" 메시지 표시

2. **External Link 새로고침 시 게스트 복원** — Edge Function + API + 프론트엔드
   - `external-dj-links` Edge Function `validate` 액션에서 `external_link_id`로 기존 게스트 조회 후 함께 반환
   - `lib/api/guests.ts` — `validateExternalToken` 반환 타입에 `guests: Guest[]` 추가 및 `transformGuest` 적용
   - `app/guest/page.tsx` — `ExternalDJGuestPage`에서 validate 응답의 guests로 상태 초기화

3. **게스트 번호 순서 수정** — `app/guest/page.tsx`
   - 새 게스트 등록 시 prepend(`[data, ...prev]`) → append(`[...prev, data]`)로 변경
   - 인증 DJ, 외부 DJ 모두 적용
   - 다음 번호가 기존 목록 다음 순번으로 정확히 표시됨

---

## 이전 작업 이력 (feat/supabase 브랜치)

### Phase 5 — 버그 수정 2차 (5157b62)

- External Link 게스트가 Door/Admin 게스트 목록에 중복 노출되던 문제 수정
- Admin에서 게스트 삭제 시 슬롯이 회복되지 않던 문제 수정

### Phase 4 — 버그 수정 1차 (5157b62)

- Door 페이지 DJ 필터 라벨 "DJ" → "User"로 변경
- External Link에서 게스트 수 NaN 표시 수정
- External Link 게스트 삭제 기능 추가
- 게스트 목록 폴링(자동 새로고침) 구현
- 날짜 선택 기본값을 오늘 날짜로 설정

### Phase 3 — VenueManagement & Edge Functions (5157b62)

- `VenueManagement` 컴포넌트 신규 구현 (super_admin 전용)
- `create-user` Edge Function 구현 — Supabase Auth 계정 + public 프로필 동시 생성, `app_metadata` 동기화
- `external-dj-links` Edge Function 구현 — validate / create-guest / delete-guest 액션
- Docker 기반 Supabase CLI 서비스 추가 (`Dockerfile.supabase`)

### Phase 2 — Supabase 연동 고도화 (29b62df)

- localStorage 기반 UI를 Supabase 실시간 연동으로 전환 (guests, users, external_dj_links)
- `lib/api/guests.ts` 신규 — Supabase Client 기반 CRUD 함수 계층
- super_admin의 venue 독립성 확보 (venue_id NULL 허용)
- RLS 정책을 JWT `app_metadata` 기반으로 전면 재작성 — 재귀 쿼리 제거
- `GuestListCard` 공용 컴포넌트 — 등록 시각, BY 라벨 표시

### Phase 1 — 역할 체계 & 스키마 정비 (f1210e9)

- 역할 체계 재설계: `super_admin` / `venue_admin` / `door` / `dj` 4단계
- `auth_user_id` 기반 로그인 흐름으로 전환
- 스키마 RLS 정책/트리거와 TypeScript 타입 정의 정합성 정리
- `handle_new_user()` 트리거 — 회원가입 시 프로필 자동 생성

### Phase 0 — Supabase 초기 설정 (1ec5af5 ~ 0904d60)

- Supabase 프로젝트 초기화 및 SSR 클라이언트 설정
- Docker 기반 개발 환경 구축 (web + supabase 서비스)
- 스키마 설계 (venues, users, djs, external_dj_links, guests)
- Middleware 세션 리프레시 설정

### Foundation — 프로젝트 초기 구축 (6d2a56c ~ 21cd885)

- Next.js 15 App Router 프로젝트 초기화
- Readdy AI 기반 UI/UX 디자인 적용
- 인증 페이지 (login, register, invite) 구현
- Admin 대시보드 탭 구조 (guests, links, users)
- Door 체크인 페이지 구현
- Guest 등록 페이지 구현
- `AuthGuard` 컴포넌트 — 역할 기반 라우트 보호
- `GuestListCard` 컴포넌트 분리 및 리팩토링
