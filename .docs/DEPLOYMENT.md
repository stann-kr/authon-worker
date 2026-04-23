# 배포 가이드 — Cloudflare Workers (OpenNext)

> **이전 문서 안내:** 구 Supabase + Cloudflare Pages 기반 배포 가이드는 `.docs/private/` 하위에 아카이브됨.
> 본 문서는 `authon-worker` (OpenNext + D1 + KV) 기준 최신 배포 절차임.

---

## 사전 준비 체크리스트

- [ ] Cloudflare 계정 및 API 토큰 준비 (`Edit: Workers, D1, KV` 권한)
- [ ] D1 데이터베이스 생성 완료 (`authon-db`)
- [ ] KV 네임스페이스 생성 완료 (`SESSIONS`)
- [ ] `wrangler.toml`에 D1 `database_id` 및 KV `id` / `preview_id` 입력 완료
- [ ] AWS SES 발신자 이메일 인증 완료 (이메일 발송 기능 사용 시)

---

## 1. 로컬 Cloudflare 리소스 생성 (최초 1회)

모든 명령은 Docker 컨테이너 내부에서 실행.

### D1 데이터베이스 생성

```bash
docker compose run --rm web npx wrangler d1 create authon-db
```

출력된 `database_id`를 `wrangler.toml` → `[[d1_databases]]` → `database_id`에 기입.

### KV 네임스페이스 생성

```bash
docker compose run --rm web npx wrangler kv namespace create SESSIONS
docker compose run --rm web npx wrangler kv namespace create SESSIONS --preview
```

출력된 `id` 값을 `wrangler.toml` → `[[kv_namespaces]]` → `id` / `preview_id`에 기입.

---

## 2. D1 마이그레이션 적용

### 로컬 D1 (개발 테스트용)

```bash
docker compose run --rm web npm run db:migrate:local
```

### 운영 D1 (Cloudflare 실제 DB)

```bash
docker compose run --rm web npm run db:migrate:remote
```

마이그레이션 파일은 `migrations/` 디렉토리에서 번호 순으로 자동 적용됨.
현재 마이그레이션 목록:

| 파일                          | 내용                           |
| ----------------------------- | ------------------------------ |
| `0001_init.sql`               | 기본 스키마 (venues, users, djs, external_dj_links, guests, check_ins) |
| `0002_password_reset.sql`     | password_reset_tokens 테이블   |
| `0003_add_created_by_user.sql`| guests.created_by_user_id 컬럼 추가 |

---

## 3. Super Admin 부트스트랩 (최초 1회)

DB가 비어있으므로 최초 `super_admin` 계정을 직접 생성해야 함.
자세한 SQL 및 bcrypt 해시 값은 `.docs/private/` 문서 참고.

```bash
# 로컬 D1에 관리자 생성
docker compose run --rm web npx wrangler d1 execute authon-db --local \
  --command="INSERT INTO users (id, email, password_hash, name, role, guest_limit, active, created_at) \
  VALUES ('<uuid>', '<email>', '<bcrypt_hash>', '<name>', 'super_admin', 999, 1, datetime('now'));"

# 운영 D1에 관리자 생성 (--remote 플래그)
docker compose run --rm web npx wrangler d1 execute authon-db --remote \
  --command="INSERT INTO users ..."
```

---

## 4. 환경 변수 설정

### 로컬 개발 (`.dev.vars`)

```env
JWT_SECRET="your-strong-random-secret-here"
TERMINAL_VENUE_ID="venue-uuid-here"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
AWS_SES_ACCESS_KEY="AKIA..."
AWS_SES_SECRET_KEY="..."
AWS_SES_REGION="ap-northeast-2"
AWS_SES_FROM_EMAIL="noreply@yourdomain.com"
NEXT_PUBLIC_BRAND_NAME="Authon"
NEXT_PUBLIC_BRAND_TAGLINE="Guest Management System"
```

### 운영 환경 (Cloudflare Dashboard)

Cloudflare Dashboard → Workers → `authon-worker` → Settings → Variables

| 변수                     | 타입      | 비고                             |
| ------------------------ | --------- | -------------------------------- |
| `JWT_SECRET`             | Secret    | 암호화 저장 필수                 |
| `TERMINAL_VENUE_ID`      | Plain     | terminal-2 연동 베뉴 ID          |
| `NEXT_PUBLIC_APP_URL`    | Plain     | 운영 도메인 (예: `https://authon.yourdomain.com`) |
| `AWS_SES_ACCESS_KEY`     | Secret    | 암호화 저장                      |
| `AWS_SES_SECRET_KEY`     | Secret    | 암호화 저장                      |
| `AWS_SES_REGION`         | Plain     | `ap-northeast-2`                 |
| `AWS_SES_FROM_EMAIL`     | Plain     | SES 인증된 이메일 주소           |
| `NEXT_PUBLIC_BRAND_NAME` | Plain     | 브랜드명                         |

---

## 5. 워커 빌드 및 배포

### 빌드 테스트

```bash
docker compose run --rm web npm run build:worker
```

### 배포

```bash
docker compose run --rm web npm run deploy
```

### 로컬 Preview (Cloudflare 환경 에뮬레이션)

```bash
docker compose run --rm web npm run cf:preview
```

---

## 6. 도메인 연결

Cloudflare Dashboard → Workers → `authon-worker` → Triggers → Custom Domains

1. `+ Add Custom Domain` 클릭
2. 도메인 입력 (예: `authon.yourdomain.com`)
3. Cloudflare DNS CNAME 자동 설정
4. SSL 자동 적용 확인

---

## 7. 유저 마이그레이션 (구 시스템 이관)

구 Supabase 기반 사용자를 Worker 기반으로 이관하는 두 가지 방법:

### 방법 A: Admin UI MIGRATE 탭

1. Super Admin으로 로그인 → `/admin` → `MIGRATE` 탭
2. `LegacyUserMigration` 컴포넌트를 통해 JSON 배열로 유저 일괄 이관
3. 이관 시 자동으로 비밀번호 재설정 링크 이메일 발송 (AWS SES)

### 방법 B: `/api/admin/migrate` API 직접 호출 (super_admin 전용)

```bash
curl -X POST https://authon.yourdomain.com/api/admin/migrate \
  -H "Cookie: token=<JWT>" \
  -H "Content-Type: application/json" \
  -d '{"users": [{"email": "...", "name": "...", "role": "dj", "guest_limit": 10}]}'
```

---

## 8. 배포 후 검증 체크리스트

- [ ] 로그인 페이지 정상 진입 (`/auth/login`)
- [ ] 로그인 성공 및 대시보드 이동 (`/`)
- [ ] 역할별 메뉴 접근 제어 확인
- [ ] 게스트 등록/체크인 E2E 흐름 확인
- [ ] 외부 DJ 토큰 링크 접근 (`/guest?token=xxx`)
- [ ] 비밀번호 변경 (`/profile`)
- [ ] 비밀번호 재설정 이메일 수신 및 링크 정상 작동
- [ ] 로그아웃 후 쿠키 삭제 확인 (브라우저 DevTools → Application → Cookies)
- [ ] `terminal-2` Service Binding 게스트 동기화 확인

---

## 멀티 브랜드 배포

단일 코드베이스로 다중 브랜드 배포 가능 (Worker 이름 및 환경변수 분리).

```
GitHub (stann-kr/authon-worker)
├── Worker A: authon-worker          BRAND_NAME=Authon         → authon.yourdomain.com
└── Worker B: faust-guest-worker     BRAND_NAME=Faust Guest    → guest.faustclub.com
```

`NEXT_PUBLIC_*` 변수는 빌드 시점에 번들에 삽입되므로, 브랜드별로 별도 배포 필요.
