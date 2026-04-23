# 트러블슈팅 이력 (Troubleshooting Log)

이 문서는 프로젝트 개발 중 발생한 주요 기술적 문제와 해결 과정을 기록합니다.

---

## 6. Miniflare 빌드 에러 (SQLITE_BUSY) 및 캐시 충돌 해결

### 발생 상황 및 에러 로그
- **상황**: 로컬 개발 서버(`npm run dev`) 또는 워커 빌드 시 D1 데이터베이스 락 에러 발생.
- **에러 로그**: `SQLITE_BUSY: database is locked`

### 원인 분석
- 로컬 `.wrangler/` 캐시 폴더에 여러 프로세스가 동시에 접근하거나 Docker 볼륨 동기화 문제로 인해 SQLite DB 파일에 락이 해제되지 않은 상태로 남음.

### 해결 방안
- `package.json`의 스크립트(`dev`, `build:worker`, `cf:preview`) 실행 전 `rm -rf .wrangler &&`를 추가하여 빌드/실행 시마다 락이 걸린 캐시를 초기화하도록 개선함.

---

## 7. aws4fetch 설치 중 피어 의존성 (ERESOLVE) 충돌

### 발생 상황 및 에러 로그
- **상황**: AWS SES 연동을 위한 `aws4fetch` 라이브러리 설치 시 충돌 발생 (`docker compose run --rm web npm install aws4fetch`).
- **에러 로그**: `ERESOLVE could not resolve`, `Conflicting peer dependency: next@16.2.4`

### 원인 분석
- `@opennextjs/cloudflare` 및 관련 AWS 패키지들이 Next.js 특정 버전(15.5.15 이상 또는 16)을 요구하지만, 프로젝트는 Next.js `15.3.2`를 사용 중임.

### 해결 방안
- `npm install aws4fetch --legacy-peer-deps` 명령어를 실행하여 강제로 기존 피어 의존성 규칙을 무시하고 패키지를 성공적으로 설치함.

---

## 8. drizzle-kit generate 실행 에러 (Config 누락)

### 발생 상황 및 에러 로그
- **상황**: 새 테이블(`password_reset_tokens`) 마이그레이션 파일 생성 시 에러 발생 (`npm run db:generate`).
- **에러 로그**: `No config path provided, using default 'drizzle.config.json'` 및 `file does not exist`

### 원인 분석
- 프로젝트에 `drizzle.config.ts` 파일이 누락되어 있어 `drizzle-kit`이 스키마 파일 위치를 찾지 못함.

### 해결 방안
- 프로젝트 루트에 `drizzle.config.ts`를 신규 생성하고 `schema`, `out`, `dialect` 속성을 명시적으로 지정하여 정상적으로 D1용 마이그레이션 파일 생성에 성공함.

---

## 1. Chrome 브라우저 날짜 선택기(input[type="date"]) 렌더링 오류

### 발생 상황 및 에러 로그

- **상황**: 다크 모드 배경에서 날짜 인풋의 기본 달력 아이콘이 보이지 않거나, 클릭해도 반응이 없는 것처럼 느껴짐.
- **에러 로그**: 별도 에러 로그는 없으나 시각적으로 아이콘 부재 확인.

### 원인 분석

- `globals.css`에서 `appearance: none`이 적용되어 브라우저 기본 UI 스타일이 제거됨.
- 다크 배경에서 기본 아이콘 색상이 검은색으로 유지되어 식별이 불가능함.

### 해결 방안

- `app/globals.css`에서 `input[type="date"]`의 `appearance: none` 제거.
- `color-scheme: dark` 속성을 추가하여 브라우저 기본 아이콘이 흰색으로 렌더링되도록 유도.

---

## 2. 날짜 인풋 요일 표시 및 클릭 편의성 개선 (Mirroring UI)

### 발생 상황 및 에러 로그

- **상황**: 인풋 박스 내부에 요일(`YYYY.MM.DD (FRI)`)을 표시하고자 했으나, 브라우저 표준 인풋 포맷(`YYYY-MM-DD`) 제약으로 인해 직접 수정이 불가능함.
- **시행착오**: 초기 오버레이 방식 사용 시 인풋 포커스 방해 및 디자인 깨짐(Black Box) 발생.

### 원인 분석

- 브라우저의 `input[type="date"]`는 내부 텍스트 렌더링을 쉐도우 DOM으로 관리하여 외부에서 요일을 강제로 삽입하기 어려움.

### 해결 방안

- **Mirroring UI 기법 적용**:
  - 실제 인풋(`input`)은 `absolute inset-0 opacity-0`으로 설정하여 기능(클릭 시 달력 팝업)만 유지.
  - 그 뒤에 커스텀 레이어(`div`)를 배치하여 `formatDateDisplay` 함수로 요일이 포함된 텍스트를 렌더링.
  - `showPicker()` API를 호출하여 인풋 영역 어디를 클릭해도 즉시 달력이 열리도록 구현.

---

## 3. 정적 빌드(Next.js Export) 시 JSON.parse 에러

### 발생 상황 및 에러 로그

- **상황**: `docker compose run --rm web npm run build` 실행 시 특정 페이지(`/_not-found`, `/guest` 등)에서 빌드 실패.
- **에러 로그**: `Unexpected token 'u', "undefined" is not valid JSON at JSON.parse (<anonymous>)`

### 원인 분석

- `lib/auth.ts`의 `getUser()` 함수가 빌드 시점(SSR)에서 `localStorage`를 참조할 때, `localStorage.getItem("user")`가 `undefined`를 반환하거나 문자열 `"undefined"`가 저장된 상태로 파싱을 시도함.
- Supabase 클라이언트가 빌드 시 세션을 확인하는 과정에서 브라우저 환경 전용 객체에 접근하려 함.

### 해결 방안

- **방어 로직 추가**: `getUser()` 내에 `userStr === "undefined"` 체크 및 `try-catch` 블록 강화.
- **SSR Mocking**: `lib/supabase/client.ts`에서 `typeof window === "undefined"`일 경우 Proxy를 이용한 Mock Supabase 객체를 반환하여 빌드 시점의 부작용 차단.

---

## 4. AuthGuard TypeScript 'never' 타입 에러

### 발생 상황 및 에러 로그

- **상황**: 빌드 중 `AuthGuard.tsx`에서 에러 발생.
- **에러 로그**: `Property 'active' does not exist on type 'never'.`

### 원인 분석

- Supabase `.select().single()`의 반환 타입이 복잡할 때, TypeScript가 이를 제대로 추론하지 못해 `userData`를 `never` 타입으로 간주함.

### 해결 방안

- **명시적 타입 캐스팅**: `userData as { active: boolean; ... }` 또는 `as any`를 사용하여 타입 안정성 확보 및 빌드 에러 해결. (최종적으로는 인터페이스 정의를 통한 캐스팅 적용)

---

## 5. 게스트 제한(Guest Limit) 변경 미반영 문제

### 발생 상황 및 에러 로그

- **상황**: 관리자가 사용자의 게스트 제한 숫자를 수정해도 해당 유저가 재로그인 전까지 변경 사항이 UI에 반영되지 않음.

### 원인 분석

- 실시간 게스트 제한 체크 로직이 `localStorage`에 저장된 초기 로그인 시점의 유저 정보에 의존함.

### 해결 방안

- `components/AuthGuard.tsx`의 `useEffect` 내에서 페이지 로드 시 Supabase DB로부터 최신 유저 프로필(`guest_limit`, `active`, `role`)을 가져와 `localStorage`와 상태를 동기화하도록 로직 추가.
