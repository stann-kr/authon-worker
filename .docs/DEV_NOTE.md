# 개발 노트 (Dev Notes)

현재 알려진 이슈 및 처리 예정 사항.

---

## 현재 진행 중인 작업

### 코드베이스 감사 후 수정 작업 (2026-04-23)

감사 결과 발견된 문제들을 아래 우선순위로 수정 중.

**Phase 1 — 긴급 (앱 실행 불가)**
- [x] D1 마이그레이션 스크립트 전면 교체 (`db:migrate:local` / `db:migrate:remote`)
- [ ] Super Admin 부트스트랩 SQL 재실행
- [ ] `.env.example` / `.dev.vars.example` 신규 생성

**Phase 2 — 스키마 정합성**
- [ ] `0003_add_created_by_user.sql` 마이그레이션 추가
- [ ] `lib/db/schema.ts` `createdByUserId` 필드 추가
- [ ] `createGuest()` INSERT에 `createdByUserId` 포함
- [ ] `fetchAllGuests()` Drizzle 체이닝 버그 수정
- [ ] `lib/database.types.ts` 레거시 파일 삭제

**Phase 3 — 보안 강화**
- [ ] `middleware.ts` 외부 DJ 토큰 예외 처리 추가
- [ ] `middleware.ts` JWT_SECRET 폴백값 제거
- [ ] `/api/internal/sync-guest` Shared Secret 인증 추가
- [ ] `/api/admin/migrate` super_admin 역할 검증 추가

**Phase 4 — 환경변수 / 이메일**
- [ ] `wrangler.toml` vars 섹션에 `TERMINAL_VENUE_ID`, `NEXT_PUBLIC_APP_URL` 추가
- [ ] `lib/api/email.ts` `process.env` → Cloudflare `env` 바인딩 전환
- [ ] `lib/auth.ts` `auth_user_id` 레거시 필드 제거
**Phase 5 — 코드 품질 (완료)**
- [x] API 도메인 모듈화
- [x] strict any 린트 규칙 적용
- [x] 전역 임포트 경로 현행화
- [x] unknown 캐스팅 에러 핸들링 도입
---

## 해결 완료 (Workers 전환 전 레거시)

1. External Link 에서 게스트가 활성화 되면 Active 로 바뀌지 않음 — ✅ 해결
2. 일반 유저들의 Guest 등록 페이지에도 입장 시간 노출 — ✅ 해결
3. Super Admin 페이지 상단 메뉴 가로 배치 — ✅ 해결
4. Guest 메뉴 진입 시 로딩 아이콘 카드 내부 배치 — ✅ 해결 (Spinner 컴포넌트 분리)
5. 유저 생성 시 비밀번호 미지정 문제 — ✅ 해결 (비밀번호 재설정 링크 이메일 발송 방식으로 전환)
- 6. 비대해진 API 모듈 분리 및 타입 안전성 강화 — ✅ 해결
- 7. catch(e) 내 any 타입 제거 및 안전한 에러 추출 — ✅ 해결
