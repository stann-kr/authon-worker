# 디자인 시스템

Authon UI는 베뉴 현장에서 반복적으로 사용하는 운영 도구다. 직선 중심의 산업적 구조를 사용하되 장식적 터미널 효과는 배제하고, 빠른 탐색과 저조도 환경의 가독성을 우선한다.

## 디자인 방향

- neutral black 계열의 단일 dark substrate를 사용한다.
- 주요 action과 선택은 밝은 무채색으로 표현한다.
- green은 check-in 완료와 성공, amber는 대기, red는 오류와 위험에만 제한한다.
- 일반 UI는 Geist Sans, 숫자와 짧은 운영 상태는 Geist Mono를 사용한다.
- route, role, 권한, form field 순서는 시각 개편과 분리해 유지한다.

## 기반 기술

- Carbon `GlobalTheme`의 `g100` 컨텍스트를 사용한다.
- 아이콘은 `@carbon/icons-react` 한 계열로 통일한다.
- Tailwind CSS는 layout과 Authon semantic token 적용에 사용한다.
- Carbon 전체 stylesheet는 불러오지 않는다. 실제 사용하는 token과 component style만 앱 CSS에 정의해 번들 크기를 제한한다.
- gradient, soft shadow, 반투명 glass surface, scanline과 noise texture는 사용하지 않는다.

## 색상 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| `canvas` | `#0A0B0C` | 페이지 배경 |
| `surface` | `#111315` | 기본 패널 |
| `surface-raised` | `#181B1E` | 입력, 선택된 영역, 보조 패널 |
| `surface-hover` | `#202428` | hover와 약한 강조 |
| `border-default` | `#42484E` | control과 구획 경계 |
| `border-strong` | `#626B73` | 선택과 상호작용 경계 |
| `text-heading` | `#F4F5F5` | 제목과 핵심 값 |
| `text-body` | `#D4D7D9` | 본문 |
| `text-muted` | `#AAB0B5` | 보조 정보 |
| `action-primary` | `#E7EAEC` | primary action과 선택 |
| `action-primary-text` | `#111315` | primary action 텍스트 |
| `status-checked` | `#86A98D` | check-in 완료와 성공 |
| `status-waiting` | `#C2A56C` | 대기 상태 |
| `status-danger` | `#CC7770` | 오류, 삭제, 비활성 위험 상태 |
| `focus` | `#F4F5F5` | 키보드 focus |

## 형태와 간격

- panel, input, button, badge는 예외 없이 `0px` radius를 사용한다.
- panel은 shadow 없이 `1px` 구획선으로만 계층을 구분한다.
- spinner와 작은 상태 점처럼 원형 자체가 의미인 요소만 원형을 허용한다.
- desktop content 폭은 최대 `1440px`다. 홈은 선택 밀도를 낮추기 위해 `1040px`를 유지한다.
- multi-column 화면은 `768px` 미만에서 단일 column으로 축소한다.
- interactive control은 최소 `44px × 44px` touch target을 제공한다.
- Guest와 Door는 모바일에서 dashboard와 list를 한 열로 쌓고, `768px` 이상에서는 좌측 운영 dashboard와 우측 guest list의 master-detail 구조를 사용한다.
- 날짜 입력은 viewport가 아니라 component container 폭을 기준으로 배치한다. 좁은 container에서는 날짜와 quick control을 두 줄로 표시한다.
- 고정 또는 sticky 영역은 목록의 첫 행을 가리지 않아야 하며, 페이지 안에 불필요한 중첩 scroll container를 만들지 않는다.

## 타이포그래피

- 페이지 제목은 sans-serif, semibold, 좁은 letter spacing을 사용한다.
- label은 sentence case를 기본으로 한다.
- mono uppercase는 짧은 상태, 키보드 shortcut, 날짜, 숫자에만 사용한다.
- 운영 label, helper, error 문장은 최소 `12px`로 유지하고 배경 대비 WCAG AA를 만족해야 한다.

| 역할 | 크기 | 굵기 | semantic class | 용도 |
|---|---:|---:|---|---|
| Page title | 24–30px | 600 | route별 heading | 로그인·오류처럼 독립된 화면의 제목 |
| Section title | 18px | 600 | `type-section-title` | Admin의 독립 form·migration section |
| Panel title | 16px | 600 | `type-panel-title` | Door check-in, Guest list, Add guest 같은 panel heading |
| Context title | 14px | 600 | `type-context-title` | Operational date, Guest owner, User filter, Section처럼 dashboard card의 맥락을 정의하는 제목 |
| Field label | 14px | 500 | `app-label` | Guest name, Email, Sort처럼 개별 control을 설명하는 label |
| Body / Control value | 14px | 400–500 | `type-body`, `app-field` | 본문 설명과 입력값 |
| Row title | 14–16px | 600 | `type-row-title` | guest·link·user·venue 목록의 주 식별자 |
| Status / Metadata | 12px | 400–600 | `type-meta` | count, timestamp, helper, 짧은 상태 |

- 같은 semantic role은 viewport가 달라도 임의로 크기를 바꾸지 않는다. row title만 넓은 화면에서 14px에서 16px로 한 단계 확장한다.
- context title과 panel title은 모두 600 weight를 사용하고, 14px와 16px의 크기 차이로 dashboard context와 작업 section의 위계를 표현한다.
- 개별 form control의 field label은 500 weight를 유지해 context title보다 한 단계 낮게 표시한다.
- 700 bold는 운영 UI에서 사용하지 않는다. 제목·주요 action·상태는 600, label·보조 action은 500, 본문·숫자·metadata는 400을 기본으로 한다.

## 상태 표현

- 로그인 후 작업 화면 사이의 route loading은 현재 header와 footer를 유지하고 콘텐츠 영역에 공통 spinner를 표시한다. 최초 진입과 인증 확인은 fullscreen spinner를 사용한다.
- 초기 data loading은 최종 행 구조와 같은 skeleton을 사용한다.
- button loading은 label 위치를 유지하는 작은 progress indicator를 사용한다.
- empty state는 원인과 다음 행동을 함께 제시할 수 있어야 한다.
- error는 영향받는 section 가까이에 표시하고 재시도가 가능한 경우 action을 제공한다.
- destructive action은 red semantic tone과 확인 단계를 함께 사용한다.
- 상태는 색상만으로 전달하지 않는다. 목록 행은 2px 상태선을 기본 신호로 사용하고, 상태별로 가능한 행동이나 아이콘·텍스트를 함께 제공한다.
- 입장 행동은 `CHECK IN`, 완료 상태는 `CHECKED IN`으로 구분한다. 모든 대기 행은 왼쪽 상태선과 현재 가능한 행동으로 표현하고 행 안에 `WAITING` label을 반복하지 않는다.

## 모션

- 일반 UI 전환은 `140-200ms` 범위로 제한한다.
- route loading overlay는 header 아래 콘텐츠 영역에서 최소 `160ms` 동안 상태를 명확히 전달하고 `140ms` ease-out으로 종료한다.
- enter와 직접 피드백은 강한 ease-out 곡선을 사용한다.
- 버튼 press는 위치나 크기를 움직이지 않고 substrate 밝기만 바꾼다.
- keyboard shortcut, tab 전환, 반복 check-in에는 장식 animation을 사용하지 않는다.
- hover feedback은 fine pointer 환경에서만 제공한다.
- `prefers-reduced-motion`에서는 transform motion을 제거한다.

## 주요 component

- `Button`: primary, secondary, outline, danger, ghost variant와 loading state를 제공한다.
- `PanelHeader`: count, sort, refresh, 추가 action의 위치를 통일한다.
- `GuestListCard`: waiting, checked, removed 상태와 registration/operations 작업 모드별 action을 표현한다. 공용 계정 게스트는 계정명과 실제 입력자를 함께 표시하고, checked 상태의 되돌리기는 해당 행 안에서 제공한다.
- `StatusLabel`: 상태별 아이콘, 텍스트, 색상 규칙을 통일한다.
- `Alert`: error와 success를 live region으로 전달한다.
- `Skeleton`: list loading 중 레이아웃 공간을 예약한다.
- `EmptyState`: icon, message, description, action을 조합한다.
- `DatePicker`, `VenueSelector`, `GuestSearchInput`: 공통 field와 focus token을 사용한다.
- 운영 날짜는 Guest, Door, Admin에서 같은 `DatePicker`와 날짜 이동 control을 사용한다. container가 좁으면 날짜 입력과 quick control을 두 줄로 배치한다.
- Guest, Door와 Admin 하위 작업은 태블릿 이상에서 공통 `OperationsLayout`을 사용한다. 좌측 열에는 날짜·범위·section·요약을, 우측 열에는 생성 form 또는 작업 목록을 둔다.
- Links 관리는 기본 상태와 예외 상태를 한 번씩만 표시한다. 목록 범위는 날짜별 보기와 최근 생성 5개·10개 보기로 구분한다.
- Links의 긴 URL은 기본 목록에 상시 노출하지 않는다. `VIEW` disclosure 안에서 읽기 전용 URL 선택과 새 탭 열기를 제공해 clipboard 실패 시에도 접근할 수 있게 한다.
- 반복되는 guest row는 교차 neutral surface를 사용한다. waiting과 checked-in 상태는 각 행의 왼쪽 2px indicator를 공유하되, 모든 waiting 행은 중복 status label을 표시하지 않는다.
- 되돌리기처럼 특정 guest 상태에 종속된 control은 전역 banner가 아니라 해당 guest 행 안에 표시한다.
- guest row의 상태는 왼쪽 indicator와 metadata가 전달하고, 우측에는 현재 수행 가능한 action만 둔다. `CHECK IN`과 `UNDO`는 동일한 위치와 최소 폭을 사용한다.
- 등록자처럼 선택적인 metadata는 값이 없을 때 공간을 예약하지 않는다. 행 본문과 우측 action은 전체 행 높이를 기준으로 수직 중앙 정렬한다.
- 추가 게스트 요청은 요청 수량을 주요 control로 두고 선택 사유임을 label과 helper text에서 명확히 표시한다. 승인 목록은 요청값, 승인값과 처리 상태를 함께 보여준다.
- 데이터가 적은 list panel에는 고정 최소 높이를 강제하지 않고 실제 행 수에 맞춰 높이를 결정한다.
- 등록 시각은 감사 정보가 필요한 Admin guest 목록에서만 표시한다. 입장 시각은 checked 상태의 metadata로 표시한다.
- panel과 tab group의 외곽선은 가장 바깥 container가 한 번만 그리며, 자식은 내부 구획선만 담당한다.
- 검색 초기화는 공통 clear button 하나만 제공하고 브라우저 native search cancel control은 숨긴다.
- 권한에 따라 개수가 달라지는 보조 panel은 빈 grid column을 예약하지 않고 실제 항목 수에 맞춰 폭을 자동 분배한다.

## 접근성 기준

- 모든 form control은 visible label 또는 동등한 accessible name을 가져야 한다.
- focus ring은 밝은 무채색 `focus` token으로 통일하고 배경과 3:1 이상 대비를 유지한다.
- icon-only button은 `aria-label`과 충분한 hit area를 제공한다.
- tab은 arrow, Home, End key 이동과 올바른 ARIA 연결을 유지한다.
- loading, success, error 상태는 적절한 live region을 사용한다.
