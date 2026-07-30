# 트러블슈팅

재발 가능성이 있는 이슈의 증상-원인-해결-검증 레시피를 정리한다. 항목 제목의 날짜는 최초 확인 시점이며, 최신순으로 정렬한다.

## 2026-07-27

### Next.js proxy 전환 후 Cloudflare Worker 빌드 실패

#### 증상
- Next.js가 `middleware.ts` 대신 `proxy.ts` 사용을 권장한다.
- `proxy.ts`만 남겼을 때 일반 Next.js build는 통과해도 OpenNext Cloudflare Worker build가 실패할 수 있다.
- 대표 메시지: `Node.js middleware is not currently supported`.

#### 원인
- Next.js 16의 proxy runtime 처리와 현재 OpenNext Cloudflare Worker 번들링 조건이 완전히 일치하지 않을 수 있다.
- Cloudflare Worker 배포 가능성을 우선하면 `middleware.ts` 유지가 더 안전한 조합일 수 있다.

#### 해결
- Worker build를 기준으로 `middleware.ts`와 `proxy.ts` 중 하나만 유지한다.
- 인증, 세션, RBAC 검증 로직이 선택한 단일 엔트리에 모두 들어 있는지 확인한다.

#### 검증
```bash
npm run build
npm run build:worker
```

## 2026-06-25

### Docker daemon 미기동으로 로컬 검증 실패

#### 증상
- `docker compose` 명령이 Docker socket 연결 오류로 실패한다.

#### 원인
- Docker Desktop이 실행 중이지 않거나 daemon 준비가 끝나지 않았다.

#### 해결
```bash
open -a Docker
docker info
docker compose ps
```

Docker daemon 준비 후 다시 실행한다.

### Docker / host 의존성 드리프트로 lint 또는 build 결과가 다름

#### 증상
- host에서는 lint/build가 통과하지만 Docker 컨테이너에서는 dependency import 또는 framework version 문제가 발생한다.
- ESLint flat config, Next.js version, package lock 상태가 서로 다르게 보일 수 있다.

#### 원인
- 컨테이너의 `node_modules`, image cache, lockfile 기준이 host와 달라졌다.
- framework major version 전환 시 lint config export 방식이 바뀔 수 있다.

#### 해결
- container image와 dependency install 상태를 현재 lockfile 기준으로 재생성한다.
- lint script가 현재 ESLint/Next.js 조합에서 유효한지 확인한다.

#### 검증
```bash
npm run lint
npm run build
```

## 2026-05-22

### Server Actions 권한 검증 누락

#### 증상
- 클라이언트에서 호출 가능한 server action이 권한 확인 없이 데이터 변경을 수행할 수 있다.

#### 원인
- `"use server"` 함수도 HTTP endpoint처럼 호출될 수 있으므로 함수 진입부에서 인증/권한 검증이 필요하다.

#### 해결
- 변경 작업 함수의 첫 단계에서 공통 인증 helper와 role 검증을 호출한다.
- public token flow처럼 예외가 필요한 함수는 별도 경계와 입력 검증을 둔다.

#### 검증
- 비로그인/권한 부족 사용자가 사용자 삭제, role 변경, guest 삭제 같은 작업을 수행하지 못하는지 확인한다.

### 외부 링크 정원 초과 race condition

#### 증상
- 동시에 여러 요청이 들어오면 external link의 guest limit을 초과해 등록될 수 있다.

#### 원인
- `SELECT`로 현재 사용량을 확인한 뒤 별도 `UPDATE`를 실행하면 두 요청이 동시에 통과할 수 있다.

#### 해결
- 정원 조건을 포함한 원자적 update를 사용한다.
- update 결과가 없으면 정원 초과로 처리한다.

#### 검증
- 동시 요청 시 한도 초과 guest가 생성되지 않는지 확인한다.

### Email client가 Worker binding 값을 비어 있는 값으로 캡처함

#### 증상
- 이메일 발송 시 runtime에는 secret이 있는데도 인증 정보가 비어 있는 것처럼 실패한다.

#### 원인
- Worker isolate 초기화 시점에 module top-level에서 env 값을 읽으면 request scope binding이 반영되지 않을 수 있다.

#### 해결
- email client는 요청 처리 함수 내부에서 runtime env를 읽어 생성한다.
- secret 값은 source code나 public docs에 남기지 않는다.

#### 검증
- 로컬/preview/운영 각각에서 reset-password 이메일 요청이 정상적으로 provider 호출까지 도달하는지 확인한다.

### TypeScript global augmentation이 적용되지 않음

#### 증상
- global interface에 Worker env 타입을 선언했는데 TypeScript가 속성을 인식하지 못한다.

#### 원인
- `declare global`은 모듈 파일에서 동작해야 한다. import/export가 없는 script file에서는 의도대로 augmentation이 되지 않을 수 있다.

#### 해결
- 타입 선언 파일 상단 또는 하단에 `export {};`를 추가해 모듈 파일로 만든다.

#### 검증
```bash
npx tsc --noEmit
```

## 2026-04-23

### D1 마이그레이션 누락으로 테이블 조회 실패

#### 증상
- 로컬 또는 preview 환경에서 `no such table` 계열 오류가 발생한다.

#### 원인
- D1 database에는 migration 파일이 자동 반영되지 않는다.
- 새 환경을 만들었거나 로컬 D1 상태가 초기화되면 migration을 다시 적용해야 한다.

#### 해결
```bash
npm run db:migrate:local
```

운영 환경은 배포 권한과 대상 DB를 확인한 뒤 remote migration 절차를 별도로 수행한다.

### Drizzle query builder 조건 누락

#### 증상
- 특정 venue나 status로 필터링해야 하는 목록에서 전체 데이터가 조회된다.

#### 원인
- Drizzle query builder의 `.where()` 결과를 재할당하지 않아 조건이 query에 반영되지 않았다.

#### 해결
- 조건 분기마다 query builder 반환값을 변수에 다시 할당한다.
- 복수 조건은 `and(...)`로 묶어 한 번에 구성한다.

#### 검증
- venue가 다른 샘플 데이터를 두고 목록 API가 현재 scope의 데이터만 반환하는지 확인한다.

### 외부 DJ token 링크가 로그인으로 리다이렉트됨

#### 증상
- `/guest?token=...` 공개 링크 접속 시 로그인 페이지로 이동한다.

#### 원인
- middleware가 `/guest` 전체를 인증 필요 경로로 처리하면 token 기반 공개 등록 흐름도 차단된다.

#### 해결
- `/guest` 경로에 token query가 있는 경우 공개 token flow로 통과시키는 예외를 둔다.
- token 검증과 정원/만료 검사는 API layer에서 별도로 수행한다.

#### 검증
- token이 있는 외부 링크는 등록 화면으로 진입한다.
- token이 없거나 유효하지 않은 경우에는 안전한 오류 화면을 보여준다.

### Miniflare / local D1 SQLITE_BUSY

#### 증상
- 개발 서버 재시작 또는 build 중 local D1이 `SQLITE_BUSY`로 실패한다.

#### 원인
- 이전 프로세스의 local emulator state 또는 SQLite lock이 남아 있을 수 있다.

#### 해결
- local emulator state를 정리한 뒤 dev/build를 다시 실행한다.
- 재발이 잦으면 dev/build script에서 local state cleanup이 필요한지 검토한다.

#### 검증
```bash
npm run build
```

### npm peer dependency 충돌

#### 증상
- Worker/OpenNext 관련 package나 email helper package 설치 시 peer dependency 충돌로 install이 실패한다.

#### 원인
- framework adapter가 특정 Next.js major range를 기대하는데 프로젝트의 Next.js version과 맞지 않을 수 있다.

#### 해결
- 우선 현재 package lock과 adapter compatibility를 확인한다.
- 임시로 legacy peer deps 설치가 필요할 수 있지만, 이후 build/lint로 실제 호환성을 반드시 검증한다.

#### 검증
```bash
npm run build
npm run build:worker
```

## 시기 미상

### 모바일 날짜 input / viewport / layout shift 문제

초기 UI 정비 시기에 반복적으로 확인된 이슈로, 정확한 최초 발생일은 확인되지 않았다.

#### 증상
- iOS/Chrome에서 date input 아이콘이 사라지거나, input이 박스를 벗어나거나, 화면 하단 여백/자동 확대/layout shift가 발생한다.

#### 원인
- browser native date input 스타일, iOS viewport 기준, 16px 미만 input focus zoom, 고정 높이 레이아웃이 겹칠 수 있다.

#### 해결
- date display는 필요 시 custom mirroring UI로 보정한다.
- input은 `min-width: 0`, 충분한 font size, overflow 방지 스타일을 적용한다.
- `100dvh`, safe area, 전체 page scroll 기준을 검토한다.
- loading 중에는 이전 데이터를 유지하거나 최소 높이를 둬 layout shift를 줄인다.

#### 검증
- iOS Safari, Chrome mobile width, desktop에서 날짜 선택/guest list/footer 위치를 확인한다.
