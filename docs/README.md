# Authon Worker 문서

`authon-worker`는 베뉴 게스트 운영을 위한 Next.js / Cloudflare Workers 기반 웹 애플리케이션이다. DJ와 스태프는 게스트를 등록하고, 도어 스태프는 입장 상태와 워크인을 기록하며, 관리자는 행사·등록 링크·사용자·베뉴와 통계를 운영한다.

이 `docs/` 디렉토리는 공개 저장소에 포함해도 무방한 프로젝트 이해용 문서만 담는다. 공개 범위 기준은 아래 「공개 문서 기준」 섹션을 따른다.

## 현재 상태

- 런타임: Next.js + OpenNext + Cloudflare Workers
- 데이터: Cloudflare D1 + Drizzle ORM
- 세션: JWT + Cloudflare KV session storage
- 비밀번호 복구: 관리자 확인을 거치는 요청·승인과 1회용 설정 코드. 자가 이메일 재설정 발송은 비활성화했다.
- UI: 역할별 작업 공간 shell, 1000px 이상 sidebar와 미만의 떠 있는 하단 dock, EN/KO
- 주요 흐름: 관리자 운영, 게스트 등록, 도어 체크인·워크인, 외부 DJ 링크와 Self-RSVP 기반 공개 등록

## 주요 기능

- 역할 기반 접근 제어: `super_admin`, `venue_admin`, `door_staff`, `staff`, `dj`와 `staff` 공용 계정 유형
- 베뉴별 게스트 등록/조회/체크인, 계정별 기본 한도와 날짜별 추가 인원 요청·승인
- 영업일 단위 행사(Event)의 생성·수정·오픈·마감·보관과 행사 마감 리포트
- Door 입장 확인, 비식별 워크인 기록, 오프라인 대기열과 관리자 입장 마감 확정
- 외부 DJ 링크와 방문자 Self-RSVP 링크를 통한 계정 없는 게스트 등록
- 등록일 기준 게스트·입장·기여자 통계
- 관리자 승인 기반 비밀번호 복구와 세션 무효화
- terminal 계열 서비스와의 내부 게스트 동기화 경계
- 요청 도메인별 베뉴 브랜드와 기본 언어

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
