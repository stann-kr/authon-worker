# 배포 가이드 — Cloudflare Pages

## 브랜딩 작동 원리

`NEXT_PUBLIC_*` 변수는 **빌드 시점**에 JS 번들에 직접 삽입됩니다.  
런타임에 읽는 것이 아니므로, Cloudflare Pages 프로젝트마다 환경변수를 다르게 설정하면 각자 다른 브랜드로 빌드됩니다.

```
GitHub (stann-kr/Authon) ──push──► main 브랜치
        │
        ├──► [CF Pages A: authon-web]   BRAND_NAME=Authon         → authon.yourdomain.com
        └──► [CF Pages B: faust-web]    BRAND_NAME=Faust Guest System → guest.faustclub.com
```

---

## 사전 확인

- [ ] `main` 브랜치에 운영 코드 머지 완료
- [ ] `docker compose run --rm -e NODE_ENV=production web sh -c "rm -rf .next && npx next build"` 빌드 통과 확인
- [ ] Supabase Dashboard → Auth → URL Configuration 설정 완료 (아래 참조)

---

## Cloudflare Pages 프로젝트 생성

### 공통 빌드 설정 (두 프로젝트 동일)

| 항목                   | 값                           |
| ---------------------- | ---------------------------- |
| Framework preset       | None (또는 Next.js / Static) |
| Build command          | `npm run build`              |
| Build output directory | `out`                        |
| Root directory         | `/`                          |
| Node.js version        | `20`                         |

---

## 프로젝트 A — Authon (퍼블릭 서비스)

### Cloudflare Pages 설정

| 항목          | 값                |
| ------------- | ----------------- |
| 프로젝트 이름 | `authon-web`      |
| 연결 저장소   | `stann-kr/Authon` |
| 운영 브랜치   | `main`            |
| 프리뷰 브랜치 | `dev`             |

### 환경 변수 (Settings → Environment Variables)

| 변수                            | 값                                                        |
| ------------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://vcssypfihgpmkpsgderv.supabase.co`                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 대시보드 → Settings → API → anon key             |
| `NEXT_PUBLIC_BRAND_NAME`        | `Authon`                                                  |
| `NEXT_PUBLIC_BRAND_TAGLINE`     | `Guest Management System`                                 |
| `NEXT_PUBLIC_BRAND_DESCRIPTION` | `Authon Guest Management System`                          |
| `NEXT_PUBLIC_BRAND_FOOTER`      | (선택) 미설정 시 `© {현재연도} Authon By Stann` 자동 생성 |

### 도메인 연결 (Settings → Custom Domains)

1. `+ Add custom domain` 클릭
2. 도메인 입력 (예: `app.yourdomain.com`)
3. Cloudflare DNS에서 자동 CNAME 추가 (같은 Cloudflare 계정이면 1클릭)
4. SSL 자동 적용 확인

---

## 프로젝트 B — Faust Guest System (클럽 내부)

### Cloudflare Pages 설정

| 항목          | 값                |
| ------------- | ----------------- |
| 프로젝트 이름 | `faust-web`       |
| 연결 저장소   | `stann-kr/Authon` |
| 운영 브랜치   | `main`            |
| 프리뷰 브랜치 | `dev`             |

### 환경 변수

| 변수                            | 값                                                                    |
| ------------------------------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://vcssypfihgpmkpsgderv.supabase.co`                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 대시보드 → Settings → API → anon key                         |
| `NEXT_PUBLIC_BRAND_NAME`        | `Faust Guest System`                                                  |
| `NEXT_PUBLIC_BRAND_TAGLINE`     | `Guest Management System`                                             |
| `NEXT_PUBLIC_BRAND_DESCRIPTION` | `Faust Guest System`                                                  |
| `NEXT_PUBLIC_BRAND_FOOTER`      | (선택) 미설정 시 `© {현재연도} Faust Guest System By Stann` 자동 생성 |

### 도메인 연결

1. `+ Add custom domain` 클릭
2. 도메인 입력 (예: `guest.faustclub.com`)
3. Cloudflare DNS CNAME 연결

---

## Supabase Auth URL 설정 (⚠️ 필수)

> **이 설정이 빠지면 비밀번호 재설정/초대 링크가 작동하지 않습니다.**  
> `@supabase/ssr`는 기본적으로 **PKCE 인증 플로우**를 사용합니다.  
> 이메일 링크 클릭 시 Supabase가 앱으로 `?code=…`를 리다이렉트하며,  
> 앱은 이 코드를 세션으로 교환합니다. 이 리다이렉트가 허용되지 않으면 링크가 만료/무효 처리됩니다.

Supabase Dashboard → **Authentication → URL Configuration**

### Site URL

운영 메인 도메인을 설정:

```
https://guest.faustseoul.kr
```

### Redirect URLs (모든 도메인을 허용 목록에 추가)

```
https://guest.faustseoul.kr/**
http://localhost:3000/**
```

> `/**` 와일드카드를 사용하면 `/auth/reset-password`, `/` 등 모든 경로 허용됨  
> 향후 추가 브랜드 도메인이 있다면 각각 `https://도메인/**` 형태로 추가

### 이메일 발송 한도 확인

Supabase 무료 티어는 **시간당 이메일 3건** 제한이 있습니다.  
초대/재설정 이메일이 전송되지 않는다면:

1. Supabase Dashboard → **Authentication → Rate Limits** 확인
2. Custom SMTP 설정 권장: **Project Settings → Authentication → SMTP Settings**
3. 발송 로그: **Authentication → Logs** 에서 이메일 전송 상태를 확인할 수 있습니다

---

## Supabase Edge Function 배포

배포 시마다 아래 명령어 실행 (로컬 Docker 환경에서):

```bash
docker compose run --rm supabase functions deploy create-user \
  --project-ref vcssypfihgpmkpsgderv \
  --no-verify-jwt
```

> `--no-verify-jwt` 필수 — Edge Runtime 내장 JWT 검증 비활성화 (함수 내부에서 수동 검증)

---

## 이메일 템플릿 적용

Supabase Dashboard → **Authentication → Email Templates**

| 템플릿         | 파일                                            |
| -------------- | ----------------------------------------------- |
| Invite User    | `.docs/email/invite.html` 내용 붙여넣기         |
| Reset Password | `.docs/email/reset-password.html` 내용 붙여넣기 |
| Confirm Signup | `.docs/email/confirm-signup.html` 내용 붙여넣기 |

> 두 브랜드가 같은 Supabase 프로젝트를 사용한다면 이메일 템플릿은 공용입니다.  
> 브랜드별 이메일이 필요하다면 Supabase 프로젝트를 분리해야 합니다.

---

## 배포 후 검증 체크리스트

- [ ] 로그인 페이지 정상 진입
- [ ] 로그인 성공 및 역할별 리다이렉트
- [ ] 비밀번호 재설정 이메일 수신 및 링크 정상 작동
- [ ] 사용자 초대 (EMAIL INVITE 모드) 이메일 수신
- [ ] 사용자 생성 (TEMP PASSWORD 모드) 정상 작동
- [ ] 게스트 등록/체크인 흐름
- [ ] 외부 DJ 토큰 링크 접근

---

## 향후 고려 사항

- 두 브랜드가 **완전히 독립된 데이터**가 필요하다면 → Supabase 프로젝트 분리
- 같은 데이터(같은 베뉴) 공유라면 → 현재 구조(단일 Supabase, venue_id 기반 분리)로 충분
- 관리자 접근 통제: Faust 전용 `venue_id` 생성 후 해당 유저만 접근 허용

Authon 프로젝트용

NEXT_PUBLIC_SUPABASE_URL = https://vcssypfihgpmkpsgderv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = 여기에\_anon_key
NEXT_PUBLIC_BRAND_NAME = Authon
NEXT_PUBLIC_BRAND_TAGLINE = Guest Management System
NEXT_PUBLIC_BRAND_DESCRIPTION = Authon Guest Management System

# NEXT_PUBLIC_BRAND_FOOTER = (선택) 미설정 시 자동으로 현재 연도 포함됨

Faust 프로젝트용

NEXT_PUBLIC_SUPABASE_URL = https://vcssypfihgpmkpsgderv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = 여기에\_anon_key
NEXT_PUBLIC_BRAND_NAME = Faust Guest System
NEXT_PUBLIC_BRAND_TAGLINE = Guest Management System
NEXT_PUBLIC_BRAND_DESCRIPTION = Faust Guest System

# NEXT_PUBLIC_BRAND_FOOTER = (선택) 미설정 시 자동으로 현재 연도 포함됨

---

## 💻 로컬 개발 환경 셋업 가이드 (Local Supabase)

실제 서비스 데이터(Production) 손상을 방지하기 위해, 개발 시에는 **로컬 전용 Supabase**를 사용하는 것을 강력히 권장합니다.

### 1단계: 로컬 DB 실행

프로젝트 루트에서 다음 명령어를 실행하면, 로컬에 필요한 완벽한 분리된 Supabase 도커 컨테이너 세트가 백그라운드에서 구동됩니다.

```bash
docker compose run --rm supabase start
```

> 최초 실행 시 도커 이미지를 다운로드 하느라 시간이 다소 걸릴 수 있으며, 완료 후 터미널에 **아래와 같은 Studio URL 및 API 키 화면**이 출력됩니다.
> `Studio URL: http://127.0.0.1:54323` (이 주소에서 로컬 데이터베이스를 관리할 수 있습니다.)

### 2단계: 환경 변수 세팅

기존의 `.env` 파일은 실제 서비스 연결용이므로 `.env.production` 으로 리네임해 보관하고, 아래와 같이 템플릿을 복사해 로컬 환경 변수 파일을 만듭니다.

```bash
cp .env.example .env.local
```

### 3단계: Next.js 서버 구동

로컬 DB가 떠 있는 상태에서, 터미널(또는 `docker-compose`)로 프론트엔드 서버를 띄웁니다.

```bash
npm run dev
# 또는
docker compose up
```

이제 코드를 고치거나 게스트 테이블에 데이터를 넣을 때 **운영 서버가 아닌 내 PC의 로컬 DB (localhost:54321)** 에 데이터가 쌓이게 됩니다.

### 개발 환경 종료하기

도커 리소스 절약을 위해 개발이 끝나면 반드시 컨테이너들을 종료해주세요.

```bash
docker compose run --rm supabase stop
```

### DB 초기화가 필요하다면 (DB Reset)

스키마(`schema.sql`)를 고치거나 테이블 상태를 맨 처음 백지상태로 돌리려면 다음 명령어를 사용하세요.

```bash
docker compose run --rm supabase db reset
```
