# Authon Worker 문서

`authon-worker`는 베뉴 게스트 운영을 위한 Next.js / Cloudflare Workers 기반 웹 애플리케이션이다. DJ와 스태프는 게스트를 등록하고, 도어 스태프는 입장 상태를 확인하며, 관리자는 베뉴·사용자·외부 링크 흐름을 운영한다.

이 `docs/` 디렉토리는 공개 저장소에 포함해도 무방한 프로젝트 이해용 문서만 담는다. 공개 범위 기준은 아래 「공개 문서 기준」 섹션을 따른다.

## 현재 상태

- 런타임: Next.js + OpenNext + Cloudflare Workers
- 데이터: Cloudflare D1 + Drizzle ORM
- 세션: JWT + Cloudflare KV session storage
- 메일: AWS SES 기반 비밀번호 재설정 메일
- 주요 흐름: 관리자 운영, 게스트 등록, 도어 체크인, 외부 DJ 링크 기반 공개 등록

## 주요 기능

- 역할 기반 접근 제어: `super_admin`, `venue_admin`, `door_staff`, `staff`, `dj`
- 베뉴별 게스트 등록/조회/체크인
- 외부 DJ 링크를 통한 계정 없는 게스트 등록
- 가상 계정 로그인과 샘플 데이터로 역할별 운영 흐름을 체험하는 브라우저 로컬 포트폴리오 데모
- 비밀번호 재설정과 세션 무효화
- terminal 계열 서비스와의 내부 게스트 동기화 경계
- 브랜드 환경변수 기반 다중 배포 가능성

## 문서 목록

- [기술 명세](TECH_SPEC.md) — 아키텍처, 데이터 모델, 인증/권한 경계, 주요 런타임 구조
- [디자인 시스템](DESIGN_SYSTEM.md) — UI token, component, 상태, 모션, 접근성 규칙
- [변경 이력](CHANGE_LOG.md) — 공개 가능한 결과 중심 변경 요약
- [트러블슈팅](TROUBLESHOOTING.md) — 공개해도 무방하고 재발 가능성이 있는 이슈만 정리

## 공개 문서 기준

`docs/`에 두지 않는 문서:

- 세부 migration plan / cutover runbook
- remediation plan / 보안 점검 세부 기록
- DB deployment plan / 운영 checklist
- 긴 파일 단위 changelog와 작업 세션 기록
- 실제 secret, 계정, 토큰, 운영 도메인별 내부 값

이런 문서는 비공개 문서 레이어에 보존한다.
