import { useState, type ReactNode } from "react";
import {
  events,
  initialLinks,
  initialRequests,
  roleNames,
  screenNames,
  seedGuests,
  type Guest,
  type GuestLink,
  type GuestRequest,
  type PreviewRole,
  type Screen,
  type SheetName,
} from "./model";
import { Icon, type IconName } from "./shared/Icon";
import { Sheet } from "./shared/Sheet";
import {
  AddGuestForm,
  GuestRoster,
  RequestForm,
} from "./guests/GuestWorkspace";
import { Attendance } from "./door/Attendance";
import { AdminWorkspace } from "./admin/AdminWorkspace";
import { ExternalRegistration } from "./registration/ExternalRegistration";
import "./shell.css";

type ScopeData = {
  guests: Guest[];
  walkIns: number;
  addedWalkIns: number;
  closed: boolean;
  requests: GuestRequest[];
  links: GuestLink[];
  quota: number;
};
const makeScope = (id: string): ScopeData => ({
  guests: seedGuests(id),
  walkIns: id === "tonight" ? 42 : 0,
  addedWalkIns: 0,
  closed: false,
  requests: id === "tonight" ? initialRequests : [],
  links: id === "tonight" ? initialLinks : [],
  quota: 10,
});
const screenIcons: Record<Screen, IconName> = {
  overview: "home",
  roster: "people",
  attendance: "chart",
  events: "calendar",
  requests: "bell",
  links: "link",
  users: "user",
  analytics: "chart",
  venues: "venue",
};

export default function App() {
  const [role, setRole] = useState<PreviewRole>("admin");
  const [mobile, setMobile] = useState(true);
  const [screen, setScreen] = useState<Screen>("overview");
  const [eventId, setEventId] = useState("tonight");
  const [scopes, setScopes] = useState<Record<string, ScopeData>>({
    tonight: makeScope("tonight"),
    next: makeScope("next"),
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [selectedLink, setSelectedLink] = useState<GuestLink | null>(null);
  const [accountName, setAccountName] = useState("SORA");
  const [operatorName, setOperatorName] = useState("도어 담당자");
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [codeError, setCodeError] = useState("");
  const data = scopes[eventId];
  const event = events.find((item) => item.id === eventId)!;
  const isAdmin = role === "admin" || role === "super";
  const isMine = role === "guest";
  const isOpen = eventId === "tonight" && !data.closed;
  const scopeGuests = isMine
    ? data.guests.filter((guest) => guest.owner === "SORA")
    : data.guests;
  const checked = data.guests.filter((guest) => guest.checked).length;
  const mineCount = data.guests.filter(
    (guest) => guest.owner === "SORA",
  ).length;
  const visible = scopeGuests
    .filter(
      (guest) =>
        `${guest.name} ${guest.owner}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()) &&
        (filter === "all" ||
          (filter === "checked" ? guest.checked : !guest.checked)) &&
        (ownerFilter === "all" || guest.owner === ownerFilter),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const update = (change: (current: ScopeData) => ScopeData) =>
    setScopes((current) => ({
      ...current,
      [eventId]: change(current[eventId]),
    }));
  const closeSheet = () => {
    setSheet(null);
    setSelectedGuest(null);
    setSelectedLink(null);
    setConfirm(false);
    setCodeError("");
  };
  const openSheet = (next: SheetName) => {
    closeSheet();
    setSheet(next);
  };
  const navigate = (next: Screen) => {
    setScreen(next);
    setNotice("");
    closeSheet();
  };
  const selectEvent = (id: string) => {
    setEventId(id);
    setQuery("");
    setFilter("all");
    setOwnerFilter("all");
    setNotice("");
    setScreen(isAdmin ? "overview" : "roster");
    closeSheet();
  };
  const clearFilters = () => {
    setQuery("");
    setFilter("all");
    setOwnerFilter("all");
  };
  const changeRole = (next: PreviewRole) => {
    setRole(next);
    setScreen(next === "admin" || next === "super" ? "overview" : "roster");
    clearFilters();
    closeSheet();
    setNotice("");
  };
  const toggleGuest = (guest: Guest) => {
    if (!isOpen) {
      setNotice(
        data.closed
          ? "마감된 행사예요. 입장 내역을 확인할 수 있어요."
          : "입장 처리는 행사 당일에 열려요.",
      );
      return;
    }
    if (guest.checked) {
      setSelectedGuest(guest);
      setConfirm(true);
      return;
    }
    update((current) => ({
      ...current,
      guests: current.guests.map((item) =>
        item.id === guest.id ? { ...item, checked: true, time: "00:18" } : item,
      ),
    }));
    setNotice(`${guest.name}님 입장 완료`);
  };
  const addWalkIn = () => {
    if (!isOpen) {
      setNotice("지금은 워크인을 추가할 수 없어요.");
      return;
    }
    update((current) => ({
      ...current,
      walkIns: current.walkIns + 1,
      addedWalkIns: current.addedWalkIns + 1,
    }));
    setNotice("워크인 1명 추가 완료");
  };
  const undoWalkIn = () => {
    if (!isOpen || data.addedWalkIns <= 0) return;
    update((current) => ({
      ...current,
      walkIns: current.walkIns - 1,
      addedWalkIns: current.addedWalkIns - 1,
    }));
    setNotice("마지막 워크인 1명을 되돌렸어요.");
  };
  const addGuests = (names: string[], owner: string) => {
    if (data.closed) return "마감된 행사에는 등록할 수 없어요.";
    if (names.some((name) => name.length > 80))
      return "이름은 80자 이내로 입력해 주세요.";
    if (isMine && mineCount + names.length > data.quota)
      return "남은 한도를 초과했어요. 추가 인원을 요청해 주세요.";
    const normalized = names.map((name) => name.toLowerCase());
    if (
      new Set(normalized).size !== names.length ||
      data.guests.some((guest) => normalized.includes(guest.name.toLowerCase()))
    )
      return "같은 이름이 있어요. 명단을 확인한 뒤 다시 입력해 주세요.";
    const newGuests: Guest[] = names.map((name) => ({
      id: crypto.randomUUID(),
      name,
      owner: isMine ? "SORA" : owner,
      source: owner === "운영팀" ? "스태프" : "DJ",
      checked: false,
      code: `DEMO-${crypto.randomUUID().slice(0, 6)}`,
      time: "",
    }));
    update((current) => ({
      ...current,
      guests: [...current.guests, ...newGuests],
    }));
    clearFilters();
    setScreen("roster");
    closeSheet();
    setNotice(`${names.length}명 등록 완료`);
    return null;
  };
  const attendanceProps = {
    checked,
    walkIns: data.walkIns,
    onWalkIn: addWalkIn,
    onUndo: undoWalkIn,
    canUndo: data.addedWalkIns > 0,
    isClosed: data.closed,
    canRecord: isOpen,
    onCloseout: () => openSheet("closeout"),
    canClose: isAdmin,
  };
  const navItems: {
    id: Screen | "more" | "account";
    label: string;
    icon: IconName;
  }[] = isAdmin
    ? [
        { id: "overview", label: "운영", icon: "home" },
        { id: "roster", label: "명단", icon: "people" },
        { id: "events", label: "행사", icon: "calendar" },
        { id: "more", label: "더보기", icon: "more" },
      ]
    : isMine
      ? [
          { id: "roster", label: "내 명단", icon: "people" },
          { id: "requests", label: "인원 요청", icon: "bell" },
          { id: "account", label: "내 계정", icon: "user" },
        ]
      : [
          { id: "roster", label: "게스트 명단", icon: "people" },
          { id: "attendance", label: "입장 집계", icon: "chart" },
          { id: "account", label: "내 계정", icon: "user" },
        ];
  const isRosterScreen = screen === "roster" || screen === "overview";
  const heading = isRosterScreen ? event.title : screenNames[screen];
  const titleStats = isMine
    ? [
        { label: "내 등록", value: mineCount },
        { label: "남은 한도", value: Math.max(0, data.quota - mineCount) },
      ]
    : [
        { label: "입장 완료", value: checked },
        { label: "등록 게스트", value: data.guests.length },
      ];
  const pendingRequests = data.requests.filter(
    (request) => request.state === "pending",
  ).length;
  const hasPendingRequest = data.requests.some(
    (request) => request.name === "SORA" && request.state === "pending",
  );
  type DockAction = {
    label: string;
    icon: IconName;
    tone: "green" | "blue" | "gray";
    onClick: () => void;
    disabled?: boolean;
  };
  const dockActions: DockAction[] = isRosterScreen
    ? role === "door"
      ? [
          {
            label: "워크인 추가",
            icon: "plus",
            tone: "green",
            onClick: addWalkIn,
            disabled: !isOpen,
          },
          {
            label: "코드 조회",
            icon: "code",
            tone: "blue",
            onClick: () => openSheet("code"),
          },
          {
            label: "입장 집계",
            icon: "chart",
            tone: "gray",
            onClick: () => navigate("attendance"),
          },
        ]
      : isMine
        ? [
            {
              label: "게스트 등록",
              icon: "plus",
              tone: "green",
              onClick: () => openSheet("add"),
              disabled: data.closed,
            },
            {
              label: "인원 요청",
              icon: "bell",
              tone: "blue",
              onClick: () => navigate("requests"),
            },
            {
              label: "행사 선택",
              icon: "calendar",
              tone: "gray",
              onClick: () => openSheet("scope"),
            },
          ]
        : [
            {
              label: "게스트 등록",
              icon: "plus",
              tone: "green",
              onClick: () => openSheet("add"),
              disabled: data.closed,
            },
            {
              label: "코드 조회",
              icon: "code",
              tone: "blue",
              onClick: () => openSheet("code"),
            },
            {
              label: `추가 요청 ${pendingRequests}`,
              icon: "bell",
              tone: "gray",
              onClick: () => navigate("requests"),
            },
          ]
    : screen === "attendance"
      ? [
          {
            label: "워크인 1명",
            icon: "plus",
            tone: "green",
            onClick: addWalkIn,
            disabled: !isOpen,
          },
          {
            label: "되돌리기",
            icon: "undo",
            tone: "gray",
            onClick: undoWalkIn,
            disabled: !isOpen || !data.addedWalkIns,
          },
          {
            label: "명단 보기",
            icon: "people",
            tone: "blue",
            onClick: () => navigate("roster"),
          },
        ]
      : screen === "requests" && isMine
        ? [
            {
              label: hasPendingRequest ? "승인 대기 중" : "인원 요청",
              icon: "plus",
              tone: "green",
              onClick: () => openSheet("request"),
              disabled: hasPendingRequest,
            },
            {
              label: "내 명단",
              icon: "people",
              tone: "gray",
              onClick: () => navigate("roster"),
            },
          ]
        : screen === "links"
          ? [
              {
                label: "링크 만들기",
                icon: "plus",
                tone: "green",
                onClick: () => openSheet("link"),
              },
              {
                label: "행사 선택",
                icon: "calendar",
                tone: "gray",
                onClick: () => openSheet("scope"),
              },
            ]
          : [
              {
                label: "명단 보기",
                icon: "people",
                tone: "green",
                onClick: () => navigate("roster"),
              },
              {
                label: "행사 선택",
                icon: "calendar",
                tone: "blue",
                onClick: () => openSheet("scope"),
              },
              ...(isAdmin
                ? [
                    {
                      label: "입장 집계",
                      icon: "chart" as const,
                      tone: "gray" as const,
                      onClick: () => navigate("attendance"),
                    },
                  ]
                : []),
            ];

  let sheetContent: ReactNode = null;
  let sheetTitle = "";
  if (sheet === "add") {
    sheetTitle = "게스트 등록";
    sheetContent = (
      <AddGuestForm
        mine={isMine}
        remaining={Math.max(0, data.quota - mineCount)}
        onAdd={addGuests}
      />
    );
  }
  if (sheet === "scope") {
    sheetTitle = "행사 선택";
    sheetContent = (
      <div className="sheet-options">
        {events.map((item) => (
          <button
            className={`sheet-option ${item.id === eventId ? "active" : ""}`}
            key={item.id}
            onClick={() => selectEvent(item.id)}
          >
            <Icon name="calendar" />
            <div>
              <strong>{item.title}</strong>
              <p>
                {item.venue} · {item.date} · {item.time}
              </p>
            </div>
            {eventId === item.id && <Icon name="check" />}
          </button>
        ))}
      </div>
    );
  }
  if (sheet === "filter") {
    sheetTitle = "명단 필터";
    sheetContent = (
      <>
        <span className="eyebrow">입장 상태</span>
        <div className="segmented">
          {[
            { id: "all", label: "전체" },
            { id: "pending", label: "미입장" },
            { id: "checked", label: "입장 완료" },
          ].map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {!isMine && (
          <label className="field">
            <span>등록 담당자</span>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
            >
              <option value="all">전체 담당자</option>
              <option>SORA</option>
              <option>MILO</option>
              <option>운영팀</option>
            </select>
          </label>
        )}
        <button
          className="primary"
          onClick={() => {
            if (!isRosterScreen) setScreen("roster");
            closeSheet();
          }}
        >
          {visible.length}명 보기
          <Icon name="arrow" />
        </button>
      </>
    );
  }
  if (sheet === "code") {
    sheetTitle = "입장 코드 조회";
    sheetContent = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = String(new FormData(e.currentTarget).get("code"))
            .trim()
            .toUpperCase();
          const found = data.guests.find((guest) => guest.code === value);
          if (!found) {
            setCodeError(
              "일치하는 코드가 없어요. 입력한 코드를 확인해 주세요.",
            );
            return;
          }
          setSheet(null);
          setSelectedGuest(found);
        }}
      >
        <label className="field">
          <span>게스트 입장 코드</span>
          <input
            name="code"
            autoFocus
            required
            placeholder="예시 코드: DEMO01"
            autoCapitalize="characters"
            aria-describedby={codeError ? "code-error" : undefined}
          />
        </label>
        {codeError && (
          <p id="code-error" role="alert" className="form-error">
            {codeError}
          </p>
        )}
        <button className="primary">
          명단에서 찾기
          <Icon name="search" />
        </button>
      </form>
    );
  }
  if (sheet === "more") {
    sheetTitle = "운영 도구";
    sheetContent = (
      <div className="sheet-menu">
        {(
          [
            { id: "requests", sub: "추가 인원 검토" },
            { id: "links", sub: "외부 초대·등록" },
            { id: "users", sub: "계정·비밀번호 요청" },
            { id: "analytics", sub: "행사·담당자별 결과" },
            ...(role === "super"
              ? [{ id: "venues", sub: "베뉴·운영 설정" }]
              : []),
          ] as { id: Screen; sub: string }[]
        ).map((item) => (
          <button key={item.id} onClick={() => navigate(item.id)}>
            <Icon name={screenIcons[item.id]} />
            <span>{screenNames[item.id]}</span>
            <small>{item.sub}</small>
          </button>
        ))}
      </div>
    );
  }
  if (sheet === "account") {
    sheetTitle = "내 계정";
    sheetContent = (
      <>
        <div className="profile-summary">
          <span className="avatar">{isMine ? "S" : "A"}</span>
          <div>
            <strong>{isMine ? "SORA" : roleNames[role]}</strong>
            <p>FAUST · {isMine ? "개인 계정" : "공용 계정"}</p>
          </div>
        </div>
        {!isMine && (
          <label className="field">
            <span>현재 작업자 이름</span>
            <input
              value={operatorName}
              onChange={(e) => setOperatorName(e.target.value)}
              placeholder="실제 작업자 이름"
            />
          </label>
        )}
        <dl className="sheet-detail">
          <div>
            <dt>이용 언어</dt>
            <dd>한국어</dd>
          </div>
          <div>
            <dt>이용 범위</dt>
            <dd>
              {isAdmin
                ? "베뉴 운영 관리"
                : isMine
                  ? "내 게스트 등록"
                  : "명단 조회·입장 처리"}
            </dd>
          </div>
        </dl>
        <button
          className="primary"
          onClick={() => {
            closeSheet();
            setNotice("계정 화면을 닫았어요.");
          }}
        >
          확인
          <Icon name="check" />
        </button>
      </>
    );
  }
  if (sheet === "request") {
    sheetTitle = "추가 인원 요청";
    sheetContent = (
      <RequestForm
        onRequest={(count, reason) => {
          update((current) => ({
            ...current,
            requests: [
              ...current.requests,
              {
                id: crypto.randomUUID(),
                name: "SORA",
                count,
                reason,
                state: "pending",
              },
            ],
          }));
          navigate("requests");
          setNotice("추가 인원 요청을 보냈어요. 관리자 승인을 기다려 주세요.");
        }}
      />
    );
  }
  if (sheet === "link") {
    sheetTitle = "등록 링크 만들기";
    sheetContent = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fields = new FormData(e.currentTarget);
          const name = String(fields.get("name")).trim();
          if (!name) return;
          update((current) => ({
            ...current,
            links: [
              ...current.links,
              {
                id: crypto.randomUUID(),
                name,
                kind: String(fields.get("kind")),
                limit: Number(fields.get("limit")),
                used: 0,
                active: true,
              },
            ],
          }));
          closeSheet();
          setNotice("목업에 새 등록 링크를 추가했어요.");
        }}
      >
        <label className="field">
          <span>링크 이름</span>
          <input
            name="name"
            required
            maxLength={60}
            autoFocus
            placeholder="예: SORA 게스트"
          />
        </label>
        <div className="form-duo">
          <label className="field">
            <span>등록 방식</span>
            <select name="kind">
              <option>담당자 등록</option>
              <option>본인 등록</option>
            </select>
          </label>
          <label className="field">
            <span>등록 한도</span>
            <input
              name="limit"
              type="number"
              min="1"
              max="500"
              defaultValue="10"
              required
            />
          </label>
        </div>
        <button className="primary">
          링크 만들기
          <Icon name="plus" />
        </button>
      </form>
    );
  }
  if (sheet === "closeout") {
    sheetTitle = "입장 합계 마감";
    sheetContent = (
      <>
        <dl className="sheet-detail">
          <div>
            <dt>게스트 입장</dt>
            <dd>{checked}명</dd>
          </div>
          <div>
            <dt>워크인</dt>
            <dd>{data.walkIns}명</dd>
          </div>
          <div>
            <dt>누적 입장 합계</dt>
            <dd>{checked + data.walkIns}명</dd>
          </div>
        </dl>
        {confirm ? (
          <div className="confirmation">
            <span>
              {event.title}의 입장 합계를 마감할까요? 이 목업에서는 마감 후 입장
              추가가 잠깁니다.
            </span>
            <div className="button-row">
              <button className="secondary" onClick={() => setConfirm(false)}>
                취소
              </button>
              <button
                className="primary"
                onClick={() => {
                  update((current) => ({ ...current, closed: true }));
                  closeSheet();
                  setNotice("입장 합계를 마감했어요.");
                }}
              >
                마감 확정
              </button>
            </div>
          </div>
        ) : (
          <button className="primary" onClick={() => setConfirm(true)}>
            합계 확인 후 마감
            <Icon name="check" />
          </button>
        )}
      </>
    );
  }
  if (sheet === "user") {
    sheetTitle = `${accountName} 계정`;
    sheetContent = (
      <>
        <dl className="sheet-detail">
          <div>
            <dt>베뉴</dt>
            <dd>FAUST</dd>
          </div>
          <div>
            <dt>계정 상태</dt>
            <dd>활성</dd>
          </div>
          <div>
            <dt>등록 게스트</dt>
            <dd>
              {
                data.guests.filter((guest) => guest.owner === accountName)
                  .length
              }
              명
            </dd>
          </div>
        </dl>
        <p className="form-note">
          비밀번호 발급·권한 변경·계정 삭제는 별도의 대상 확인 화면으로 이어지는
          배치입니다. 이 목업에는 연결하지 않았어요.
        </p>
      </>
    );
  }
  if (sheet === "event") {
    sheetTitle = "FAUST 베뉴 설정";
    sheetContent = (
      <dl className="sheet-detail">
        <div>
          <dt>베뉴</dt>
          <dd>FAUST</dd>
        </div>
        <div>
          <dt>시간대</dt>
          <dd>Asia/Seoul</dd>
        </div>
        <div>
          <dt>관리 범위</dt>
          <dd>전체 관리자 전용</dd>
        </div>
      </dl>
    );
  }
  if (sheet === "map") {
    sheetTitle = "화면 배치 제안";
    sheetContent = (
      <div className="design-map">
        <p>
          상단에서 행사 맥락을 확인하고, 중앙에서 현재 작업을 처리하고, 하단에서
          메뉴와 도구를 사용합니다.
        </p>
        <div>
          <b>01 · 상단 / 현재 범위</b>
          <span>
            베뉴 → 운영일 → 행사. 메뉴를 바꿔도 같은 범위를 유지합니다.
          </span>
        </div>
        <div>
          <b>02 · 중앙 / 작업 영역</b>
          <span>
            명단·요청·행사·통계를 교체합니다. 화면 폭과 관계없이 하나의 작업
            영역을 사용합니다.
          </span>
        </div>
        <div>
          <b>03 · 하단 / 메뉴 + 작업</b>
          <span>
            역할별 주요 메뉴와 작업 버튼을 독립된 pill 두 줄로 배치합니다.
            검색은 명단 바로 위에 둡니다.
          </span>
        </div>
        <div>
          <b>04 · 바텀시트 / 짧은 작업</b>
          <span>
            게스트 등록·상세·행사 선택·필터를 현재 화면 위에서 처리합니다.
          </span>
        </div>
        <p className="form-note">
          로그인·비밀번호 복구는 진입 전 화면으로, 장문 리포트·상세 설정은 중앙
          작업 영역으로 배치합니다. 현재 파일은 핵심 흐름을 검토하는 샘플
          목업입니다.
        </p>
      </div>
    );
  }

  return (
    <div className="preview-root">
      <header className="preview-toolbar">
        <a
          className="preview-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changeRole("admin");
          }}
        >
          <span className="brand-glyph" aria-hidden="true">
            a
          </span>
          <strong>
            authon<span> / reference study</span>
          </strong>
        </a>
        <div className="preview-controls">
          <label className="role-select">
            <span className="sr-only">미리볼 사용자 역할</span>
            <select
              aria-label="미리볼 사용자 역할"
              value={role}
              onChange={(e) => changeRole(e.target.value as PreviewRole)}
            >
              {Object.entries(roleNames).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
            <Icon name="down" size={13} />
          </label>
          <button
            className="preview-device"
            aria-pressed={mobile}
            onClick={() => setMobile((value) => !value)}
          >
            {mobile ? "전체 폭" : "모바일 폭"}
          </button>
          <button className="preview-map" onClick={() => openSheet("map")}>
            화면 구성
            <Icon name="arrow" size={14} />
          </button>
        </div>
      </header>
      <div className="preview-meta">
        <span>INTERACTIVE MOCKUP</span>
        <span>모든 이름·수치는 샘플 · 새로고침하면 초기화</span>
      </div>
      <div className={`preview-frame ${mobile ? "mobile" : ""}`}>
        <div className="app-shell">
          {role === "external" ? (
            <ExternalRegistration />
          ) : (
            <>
              <main className="workspace-scroll" id="workspace-content">
                <header className="workspace-header">
                  <div className="header-title">
                    <button
                      className="scope-button"
                      onClick={() => openSheet("scope")}
                      aria-label="베뉴와 행사 선택"
                    >
                      <span
                        className={`live-dot ${!isOpen ? "inactive" : ""}`}
                      />
                      <span>
                        FAUST · {event.date.slice(5).replace(".", ".")}{" "}
                        {event.day}
                      </span>
                      <Icon name="down" size={12} />
                    </button>
                    <h1>{heading}</h1>
                  </div>
                  <button
                    className="account-button"
                    aria-label="내 계정 열기"
                    onClick={() => openSheet("account")}
                  >
                    <Icon name="user" size={21} />
                  </button>
                </header>
                <section className="stat-strip" aria-label="선택한 행사 요약">
                  {titleStats.map((stat) => (
                    <div className="stat" key={stat.label}>
                      <strong>{stat.value.toLocaleString()}</strong>
                      <span>{stat.label}</span>
                    </div>
                  ))}
                  <button
                    className={`filter-pill ${filter !== "all" || ownerFilter !== "all" ? "active" : ""}`}
                    aria-label="명단 필터"
                    onClick={() => openSheet("filter")}
                  >
                    <span>
                      {filter === "checked"
                        ? "입장 완료"
                        : filter === "pending"
                          ? "미입장"
                          : "전체"}
                    </span>
                    <Icon name="down" size={14} />
                  </button>
                </section>
                {isRosterScreen && (
                  <label className="roster-search">
                    <Icon name="search" size={20} />
                    <span className="sr-only">
                      게스트 이름 또는 등록 담당자 검색
                    </span>
                    <input
                      aria-label="게스트 이름 또는 등록 담당자 검색"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="게스트 이름 검색..."
                    />
                    {query && (
                      <button
                        aria-label="검색어 지우기"
                        onClick={() => setQuery("")}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    )}
                  </label>
                )}
                <div
                  className={`primary-workspace ${isRosterScreen ? "roster-workspace" : "detail-workspace"}`}
                >
                  {isRosterScreen ? (
                    <GuestRoster
                      guests={visible}
                      total={scopeGuests.length}
                      role={role}
                      onDetail={(guest) => {
                        closeSheet();
                        setSelectedGuest(guest);
                      }}
                      onCheck={toggleGuest}
                      onClear={clearFilters}
                    />
                  ) : screen === "attendance" ? (
                    <Attendance {...attendanceProps} />
                  ) : (
                    <AdminWorkspace
                      screen={screen}
                      guests={data.guests}
                      requests={data.requests}
                      links={data.links}
                      eventId={eventId}
                      mine={isMine}
                      onNavigate={navigate}
                      onDecision={(id, approved) => {
                        update((current) => {
                          const request = current.requests.find(
                            (item) => item.id === id,
                          );
                          if (!request || request.state !== "pending")
                            return current;
                          return {
                            ...current,
                            requests: current.requests.map((item) =>
                              item.id === id
                                ? {
                                    ...item,
                                    state: approved ? "approved" : "rejected",
                                  }
                                : item,
                            ),
                            quota:
                              current.quota +
                              (approved && request.name === "SORA"
                                ? request.count
                                : 0),
                          };
                        });
                        setNotice(
                          approved
                            ? "추가 인원을 승인했어요."
                            : "추가 인원 요청을 거절했어요.",
                        );
                      }}
                      onEvent={selectEvent}
                      onLinkToggle={(id) =>
                        update((current) => ({
                          ...current,
                          links: current.links.map((link) =>
                            link.id === id
                              ? { ...link, active: !link.active }
                              : link,
                          ),
                        }))
                      }
                      onLinkInspect={setSelectedLink}
                      onAccount={(name) => {
                        setAccountName(name);
                        openSheet("user");
                      }}
                      onVenue={() => openSheet("event")}
                    />
                  )}
                </div>
              </main>
              <div className="dock-region">
                {notice && (
                  <div className="toast" role="status">
                    <span>{notice}</span>
                    <button
                      aria-label="알림 닫기"
                      onClick={() => setNotice("")}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                )}
                <div className="nav-handle" aria-hidden="true" />
                <nav className="dock-nav" aria-label="주요 메뉴">
                  {navItems.map((item) => (
                    <button
                      key={item.id}
                      className={
                        screen === item.id ||
                        (item.id === "more" &&
                          !["overview", "roster", "events"].includes(screen))
                          ? "active"
                          : ""
                      }
                      aria-current={screen === item.id ? "page" : undefined}
                      onClick={() =>
                        item.id === "more" || item.id === "account"
                          ? openSheet(item.id)
                          : navigate(item.id)
                      }
                    >
                      <Icon name={item.icon} size={18} />
                      <span>{item.label}</span>
                      {item.id === "requests" && hasPendingRequest && (
                        <i className="nav-dot" />
                      )}
                    </button>
                  ))}
                </nav>
                <div className="dock-tools" aria-label="현재 화면 작업">
                  {dockActions.map((action) => (
                    <button
                      key={action.label}
                      className="action-pill"
                      onClick={action.onClick}
                      disabled={action.disabled}
                    >
                      <span className={`circle-icon ${action.tone}`}>
                        <Icon name={action.icon} size={14} />
                      </span>
                      <span>{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {sheet && (
        <Sheet
          key={sheet}
          title={sheetTitle}
          subtitle={
            sheet === "add"
              ? undefined
              : sheet === "map"
                ? "Authon · 하단 중심 작업 화면"
                : `${event.venue} · ${event.date} · ${event.title}`
          }
          onClose={closeSheet}
        >
          {sheetContent}
        </Sheet>
      )}
      {selectedGuest && (
        <Sheet
          title={selectedGuest.name}
          subtitle={`${event.title} · 게스트 상세`}
          onClose={closeSheet}
        >
          <dl className="sheet-detail">
            <div>
              <dt>등록 담당자</dt>
              <dd>
                {selectedGuest.owner} · {selectedGuest.source}
              </dd>
            </div>
            <div>
              <dt>입장 상태</dt>
              <dd>
                {selectedGuest.checked
                  ? `${selectedGuest.time} 입장 완료`
                  : "입장 전"}
              </dd>
            </div>
            <div>
              <dt>입장 코드 · 샘플</dt>
              <dd>{selectedGuest.code}</dd>
            </div>
          </dl>
          {!isMine &&
            (confirm ? (
              <div className="confirmation">
                <span>{selectedGuest.name}님의 입장 처리를 취소할까요?</span>
                <div className="button-row">
                  <button className="secondary" onClick={closeSheet}>
                    닫기
                  </button>
                  <button
                    className="primary"
                    disabled={!isOpen}
                    onClick={() => {
                      update((current) => ({
                        ...current,
                        guests: current.guests.map((guest) =>
                          guest.id === selectedGuest.id
                            ? { ...guest, checked: false, time: "" }
                            : guest,
                        ),
                      }));
                      closeSheet();
                      setNotice(`${selectedGuest.name}님의 입장을 취소했어요.`);
                    }}
                  >
                    입장 취소
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="primary"
                disabled={!isOpen}
                onClick={() => {
                  if (selectedGuest.checked) setConfirm(true);
                  else {
                    toggleGuest(selectedGuest);
                    closeSheet();
                  }
                }}
              >
                <Icon name={selectedGuest.checked ? "undo" : "check"} />
                {selectedGuest.checked ? "입장 취소하기" : "입장 처리하기"}
              </button>
            ))}
        </Sheet>
      )}
      {selectedLink && (
        <Sheet
          title={selectedLink.name}
          subtitle="등록 링크 상세 · 샘플"
          onClose={closeSheet}
        >
          <dl className="sheet-detail">
            <div>
              <dt>등록 방식</dt>
              <dd>{selectedLink.kind}</dd>
            </div>
            <div>
              <dt>등록 인원</dt>
              <dd>
                {selectedLink.used} / {selectedLink.limit}명
              </dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>{selectedLink.active ? "활성" : "비활성"}</dd>
            </div>
          </dl>
          <p className="form-note">
            검토용 샘플 링크입니다. 상단 역할 선택의 ‘외부 등록’에서 받는 사람의
            화면을 확인할 수 있어요.
          </p>
        </Sheet>
      )}
    </div>
  );
}
