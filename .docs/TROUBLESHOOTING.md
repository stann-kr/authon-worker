---
title: TROUBLESHOOTING
date: 2026-04-24
tags:
  - docs
  - troubleshooting
  - logs
---

# 트러블슈팅 이력 (Troubleshooting)

프로젝트 개발 중 발생한 주요 기술 문제와 해결 과정 기록.
최신순 정렬. 구 [[Supabase]] 아키텍처 관련 이슈는 하단 아카이브 참고.

---

## 2026-06-25 — Docker compose 검증 환경 드리프트 및 Next 16 proxy 전환

### 증상

- `docker compose run --rm web npm run lint` 실행 시 `eslint-config-next/core-web-vitals` import 해석 실패
- 컨테이너 내부 빌드는 Next.js 15.3.2로 표시되는데, 호스트 기준 `package.json`/빌드는 Next.js 16.2.4 기준으로 동작
- `middleware.ts` 경고 제거를 위해 `proxy.ts` 전환이 필요했음

### 원인

- 컨테이너의 `node_modules` / 이미지 상태가 현재 호스트 lockfile 상태와 드리프트된 것으로 보임
- ESLint flat config import가 컨테이너 해석 환경과 불일치
- Next 16에서는 `middleware.ts` 파일 컨벤션이 deprecated

### 해결/현황

- 호스트 기준 `proxy.ts` 전환 후 `npm run build` 통과, deprecation 경고 제거 확인
- Docker 데몬 미기동 문제는 `open -a Docker` 후 `docker info` / `docker compose ps` 로 해소 가능 확인
- 컨테이너 기준 lint는 아직 후속 과제로 남음 (`.docs/MIGRATION_TODO.md` 참고)

---

## 2026-05-22 — Server Actions 권한 검증 부재 (보안 P0)

### 발생 원인

`"use server"` 지시어를 가진 `lib/api/*.ts` 함수들이 JWT/세션 검증 없이 호출 가능했음.
Next.js Server Actions는 클라이언트에서 직접 호출 가능한 HTTP 엔드포인트로 노출되므로, 무권한 사용자가 사용자 삭제·역할 변경·게스트 영구 삭제 등을 수행할 수 있었음.

### 해결

`lib/auth/server.ts` 신규 생성:
- `requireAuth()` — `next/headers` cookies()에서 token/sessionId 추출 → JWT 검증 → KV 세션 확인
- `requireRole(roles[])` — requireAuth() 후 role 체크
- 모든 `lib/api/*.ts` 함수 진입부에 `await requireAuth()` 또는 `await requireRole([...])` 호출

### 재발 방지

신규 Server Action 추가 시 반드시 첫 줄에 `await requireRole([...])` 삽입.
토큰 기반 공개 API (`validateExternalToken`, `createGuestViaExternalLink`)는 예외.

---

## 2026-05-22 — lib/api/email.ts Cold Start 시 빈 환경 변수 캡처

### 발생 원인

`AwsClient`를 모듈 최상위에서 `process.env.AWS_SES_ACCESS_KEY`로 초기화.
Cloudflare Workers에서 모듈 코드는 isolate 초기화 시 한 번만 실행되며, 이 시점에 `process.env`는 Workers 바인딩을 포함하지 않아 빈 문자열로 고정됨.

### 해결

`sendEmail()` 함수 내부에서 `getCloudflareContext().env`로 AWS 자격증명 읽고 `AwsClient` 생성.
`worker-configuration.d.ts`에 `AWS_SES_*` 키 타입 선언 추가.
`.dev.vars`에 `AWS_SES_ACCESS_KEY` 등 설정 필요 (실제 시크릿은 Cloudflare Dashboard에서 `wrangler secret put` 사용).

---

## 2026-05-22 — `worker-configuration.d.ts` CloudflareEnv 증강 미동작

### 발생 원인

`worker-configuration.d.ts`에 `declare global { interface CloudflareEnv { ... } }`를 선언했지만 TypeScript가 속성을 인식하지 못함.
스크립트 파일(import/export 없음)에서의 `declare global`은 모듈 파일의 global augmentation과 동작이 다름.

### 해결

파일 최상단에 `export {};` 추가하여 모듈 파일로 전환. `declare global { ... }`이 정상 증강됨.
tsc --noEmit 통과 확인.

---

## 2026-05-22 — usedGuests Race Condition (외부 DJ 링크 정원 초과 허용)

### 발생 원인

`createGuestViaExternalLink`에서 SELECT로 `usedGuests >= maxGuests` 체크 후 별도 UPDATE 실행.
동시 요청 시 두 요청 모두 체크를 통과하여 정원 초과 게스트 생성 가능.

### 해결

D1 raw SQL로 조건부 원자 UPDATE:
```sql
UPDATE external_dj_links
SET used_guests = used_guests + 1
WHERE id = ? AND used_guests < max_guests
RETURNING used_guests
```
`first()` 반환값이 null이면 정원 초과로 판단하여 에러 반환.

---

## [Workers] 코드베이스 감사 발견 이슈 (2026-04-23) — ✅ 전체 해결 완료 (2026-04-23)

### 이슈 1: `no such table: users` — [[D1]] 마이그레이션 미적용

**발생 상황:** `wrangler d1 execute authon-db --local` 명령으로 Super Admin INSERT 시 에러 발생.

**원인 분석:**
- `package.json`의 `db:migrate` 스크립트가 `--file=migrations/0001_init.sql` 단일 파일만 실행
- Wrangler [[D1]] Migrations(`migrations apply`) 방식이 아닌 수동 실행으로 `0002_password_reset.sql` 누락
- 로컬 `.wrangler/state/v3/d1`에 스키마가 전혀 적용되지 않은 상태였음

**해결 방안:**
```bash
# db:migrate 스크립트를 wrangler d1 migrations apply 방식으로 교체
docker compose run --rm web npm run db:migrate:local
```
- `package.json` 스크립트 `db:migrate:local` / `db:migrate:remote` 추가
- 이후 모든 마이그레이션 파일은 `migrations/` 디렉토리에 번호 순으로 관리

---

### 이슈 2: `createdByUserId` — DB 스키마 컬럼 누락

**발생 상황:** 게스트 등록/필터링 시 `createdByUserId`가 항상 `undefined` 반환.

**원인 분석:**
- `lib/api/guests.ts`의 `createGuest()` 함수가 `createdByUserId` 파라미터를 받지만 DB INSERT에 포함하지 않음
- `guests` 테이블 스키마에 `created_by_user_id` 컬럼 자체가 없었음
- Door/Admin 페이지의 DJ별 필터 기능이 이로 인해 전혀 작동하지 않는 상태

**해결 방안:**
- `migrations/0003_add_created_by_user.sql` 신규 마이그레이션 작성
- `lib/db/schema.ts`에 `createdByUserId` 필드 추가
- `createGuest()` INSERT 쿼리에 해당 컬럼 포함

---

### 이슈 3: `fetchAllGuests()` Drizzle `.where()` 체이닝 버그

**발생 상황:** `venueId` 파라미터를 전달해도 전체 게스트가 조회됨.

**원인 분석:**
```typescript
// 버그: query에 재할당 없이 .where() 결과 버림
let query = db.select().from(guests);
if (venueId) {
  query.where(eq(guests.venueId, venueId)); // 반환값 미사용!
}
```
Drizzle 쿼리 빌더는 불변(immutable) 체이닝 방식으로, 반환값을 재할당해야 조건이 적용됨.

**해결 방안:**
```typescript
let query = db.select().from(guests).where(ne(guests.status, 'deleted'));
if (venueId) {
  query = query.where(and(eq(guests.venueId, venueId), ne(guests.status, 'deleted'))) as typeof query;
}
```

---

### 이슈 4: 외부 DJ 토큰 링크 middleware 차단

**발생 상황:** `/guest?token=abc123` 접속 시 `/auth/login`으로 리다이렉트됨.

**원인 분석:**
- `middleware.ts`가 JWT 쿠키 부재 시 모든 `/guest` 경로를 로그인 페이지로 보냄
- 외부 DJ는 계정이 없으므로 JWT 쿠키가 존재하지 않음

**해결 방안:**
```typescript
// middleware.ts에 예외 처리 추가
const url = request.nextUrl;
if (url.pathname === '/guest' && url.searchParams.has('token')) {
  return NextResponse.next();
}
```

---

### 이슈 5: JWT_SECRET 소스 불일치 (process.env vs env 바인딩)

**발생 상황:** `middleware.ts`에서 JWT 검증 실패 가능성 (로컬에서 간헐적 인증 오류).

**원인 분석:**
- `middleware.ts`: `process.env.JWT_SECRET` 사용
- API 라우트들: `env.JWT_SECRET` ([[Cloudflare]] 바인딩) 사용
- Miniflare 개발 환경에서 두 소스의 값이 다를 수 있음

**해결 방안:**
- `middleware.ts`도 `@opennextjs/cloudflare`의 `getCloudflareContext()` 사용 (엣지 런타임 한계로 불가 시 `.dev.vars` 동기화로 해결)
- 폴백값 `"default_secret_for_local_dev"` 제거 → 시크릿 미설정 시 즉시 에러 throw

---

## [Workers] Miniflare SQLITE_BUSY 에러 (2026-04-23)

**발생 상황:** 로컬 개발 서버 재시작 또는 빌드 시 [[D1]] DB 락 에러.

**에러:** `SQLITE_BUSY: database is locked`

**원인 분석:** `.wrangler/` 캐시 디렉토리에 이전 프로세스의 SQLite 락 파일 잔류.

**해결 방안:** `package.json` 스크립트에 `rm -rf .wrangler &&` 사전 정리 명령 추가.

---

## [Workers] aws4fetch 피어 의존성 충돌 (2026-04-23)

**발생 상황:** `npm install aws4fetch` 실행 시 `ERESOLVE` 오류.

**에러:** `Conflicting peer dependency: next@16.x`

**원인 분석:** `@opennextjs/cloudflare` 관련 패키지가 [[Next.js]] 15 이외 버전을 요구.

**해결 방안:** `npm install aws4fetch --legacy-peer-deps` 사용.

---

## [Workers] drizzle-kit generate Config 누락 에러 (2026-04-23)

**발생 상황:** `npm run db:generate` 실행 시 설정 파일 없음 에러.

**원인 분석:** `drizzle.config.ts` 파일 부재.

**해결 방안:** 프로젝트 루트에 `drizzle.config.ts` 신규 생성 (schema, out, dialect 명시).

---

> [!archive] 레거시 아카이브 — 구 [[Supabase]]/Pages 아키텍처 이슈
> 아래는 구 `authon` ([[Supabase]] + [[Cloudflare]] Pages 정적 배포) 시절 이슈로,
> `authon-worker` 전환 후 해당 없음. 참고 목적으로 보존.

### [레거시] Chrome 날짜 선택기 렌더링 오류

- `input[type="date"]`에 `appearance: none` 적용으로 아이콘 소실
- `color-scheme: dark` 추가 및 Mirroring UI 기법으로 해결

### [레거시] 정적 빌드 JSON.parse 에러

- 빌드 시점에 `localStorage` 접근 시 `undefined` 반환 → `JSON.parse` 실패
- `getUser()`에 방어 로직 추가 및 SSR Mock Proxy로 해결

### [레거시] AuthGuard [[TypeScript]] 'never' 타입 에러

- [[Supabase]] `.select().single()` 반환 타입 추론 실패
- 명시적 타입 캐스팅으로 해결

### [레거시] 게스트 제한(Guest Limit) 변경 미반영

- `localStorage` 기반 유저 정보 캐시로 인해 실시간 반영 안 됨
- `AuthGuard` 마운트 시 DB에서 최신 프로필 재조회로 해결

### [레거시] used_guests 이중 증가 버그

- DB 트리거 + Edge Function 수동 increment 중복 실행
- Edge Function의 수동 increment 제거로 해결
