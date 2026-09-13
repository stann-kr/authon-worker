import { isBusinessDate } from "../../lib/events/domain";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MockProvider,
  useMock,
  attendanceFor,
  quotaFor,
  id,
} from "./data/MockData";
import {
  MOCK_DATE,
  MOCK_NOW,
  roleLabels,
  viewLabels,
  scenarioLabels,
  type Scenario,
  type View,
} from "./data/types";
import { coverage } from "./data/coverage";
import { Icon, type IconName } from "./shared/Icon";
import { Sheet } from "./shared/Sheet";
import { Action, Empty, Field, Notice, Row, Select } from "./shared/ui";
import { AuthViews, ProfileView } from "./auth/AuthViews";
import { Accounts, ResetRequests } from "./accounts/Accounts";
import { Venues } from "./venues/Venues";
import { Events } from "./events/Events";
import { Reports } from "./events/Reports";
import { Links } from "./links/Links";
import { Roster } from "./guests/Roster";
import { QuotaRequests } from "./guests/QuotaRequests";
import { DoorAttendance } from "./door/DoorAttendance";
import { ExternalView } from "./registration/ExternalView";
import { Analytics } from "./analytics/Analytics";
import { WorkspaceMenu } from "./workspace/WorkspaceMenu";
import { Artists } from "./planning/Artists";
import { Bookings } from "./planning/Bookings";
import { Schedule } from "./planning/Schedule";
import { Preparation } from "./planning/Preparation";
import "./planning/planning.css";
import "./shell.css";
import "./guests/guests.css";
import "./shared/flows.css";

export default function App() {
  return (
    <MockProvider>
      <Workspace />
    </MockProvider>
  );
}
function Workspace() {
  const ctx = useMock();
  const {
    data,
    user,
    venue,
    event,
    view,
    scenario,
    locale,
    setLocale,
    busy,
    notice,
    notify,
    t,
    isAdmin,
    isSuper,
    canDoor,
    chooseUser,
    chooseEvent,
    chooseVenue,
    navigate,
    setScenario,
    setIntent,
    setAuthPage,
    setExternalLinkId,
    setData,
    operator,
    setOperator,
    reset,
    writable,
  } = ctx;
  const [mobile, setMobile] = useState(true),
    [modal, setModal] = useState<string | null>(null),
    [scopeDate, setScopeDate] = useState(event.date);
  const open = (name: string) => {
    notify("");
    setScopeDate(event.date);
    setModal(name);
  };
  const go = (v: View, intent = "") => {
    setModal(null);
    navigate(v);
    setIntent(intent);
  };
  const routeRef = useRef<() => void>(() => {});
  routeRef.current = () => {
    const parts = location.hash.slice(1).split("/");
    if (
      parts[0] === "planning" &&
      ["artists", "bookings", "schedule", "preparation"].includes(parts[1])
    ) {
      navigate(parts[1] as View);
    } else if (parts[0] === "external" && parts[1]) {
      setExternalLinkId(decodeURIComponent(parts[1]));
      navigate("external");
    } else if (parts[0] === "auth") {
      setAuthPage(parts.slice(1).join(":") || "login");
      navigate("auth");
    }
  };
  useEffect(() => {
    const route = () => routeRef.current();
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const isPublic = view === "auth" || view === "external";
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const shell = dock?.closest<HTMLElement>(".app-shell");
    if (!dock || !shell) return;
    const reserveDockSpace = () => {
      const height = dock.getBoundingClientRect().height;
      if (height) shell.style.setProperty("--dock-space", `${height + 16}px`);
    };
    reserveDockSpace();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(reserveDockSpace);
    observer?.observe(dock);
    return () => {
      observer?.disconnect();
      shell.style.removeProperty("--dock-space");
    };
  }, [isPublic]);
  const isRoster = view === "roster" || view === "door";
  const isPlanning = [
    "artists",
    "bookings",
    "schedule",
    "preparation",
  ].includes(view);
  const isTeamView = ["artists", "bookings", "schedule"].includes(view);
  const quota = quotaFor(data, user.id, event.id);
  const canRequest =
    user.accountKind === "personal" &&
    ["dj", "staff"].includes(user.role) &&
    quota.limit !== null;
  const forbidden =
    (!isAdmin &&
      [
        "artists",
        "bookings",
        "schedule",
        "preparation",
        "events",
        "report",
        "links",
        "users",
        "password-requests",
        "analytics",
      ].includes(view)) ||
    (view === "venues" && !isSuper) ||
    (["door", "attendance"].includes(view) && !canDoor);
  const inactive =
    (!venue.active || !user.active || user.deleted) &&
    view !== "venues" &&
    view !== "auth";
  const nav: { view: View | "more"; label: string; icon: IconName }[] = isAdmin
    ? [
        { view: "artists", label: "아티스트", icon: "user" },
        { view: "bookings", label: "부킹", icon: "file" },
        { view: "schedule", label: "일정", icon: "calendar" },
        { view: "roster", label: "명단", icon: "people" },
        { view: "door", label: "도어", icon: "door" },
        { view: "events", label: "행사", icon: "calendar" },
        { view: "more", label: "더보기", icon: "more" },
      ]
    : user.role === "door_staff"
      ? [
          { view: "door", label: "도어", icon: "door" },
          { view: "roster", label: "내 명단", icon: "people" },
          { view: "attendance", label: "입장 집계", icon: "chart" },
          { view: "more", label: "더보기", icon: "more" },
        ]
      : [
          { view: "roster", label: "내 명단", icon: "people" },
          ...(canRequest
            ? [
                {
                  view: "requests" as const,
                  label: "인원 요청",
                  icon: "bell" as const,
                },
              ]
            : []),
          ...(canDoor
            ? [{ view: "door" as const, label: "도어", icon: "door" as const }]
            : []),
          { view: "more", label: "더보기", icon: "more" },
        ];
  type Tool = {
    label: string;
    icon: IconName;
    color: "green" | "blue" | "gray";
    action: () => void;
    disabled?: boolean;
  };
  let tools: Tool[] = [];
  if (view === "roster")
    tools = [
      {
        label: "게스트 등록",
        icon: "plus",
        color: "green",
        action: () => setIntent("guest-add"),
        disabled:
          !["draft", "open"].includes(event.state) ||
          attendanceFor(data, event.id).finalized,
      },
      ...(isAdmin || canRequest
        ? [
            {
              label: isAdmin ? "코드 조회" : "인원 요청",
              icon: isAdmin ? "code" : "bell",
              color: "blue",
              action: () =>
                isAdmin ? setIntent("guest-code") : go("requests"),
              disabled: !isAdmin && !canRequest,
            } as Tool,
          ]
        : []),
    ];
  else if (view === "door")
    tools = [
      {
        label: "워크인 추가",
        icon: "plus",
        color: "green",
        action: () => go("attendance", "walkin-add"),
        disabled: !writable || event.date !== MOCK_DATE,
      },
      {
        label: "코드 조회",
        icon: "code",
        color: "blue",
        action: () => setIntent("guest-code"),
      },
    ];
  else if (view === "attendance")
    tools = [
      {
        label: "워크인 추가",
        icon: "plus",
        color: "green",
        action: () => setIntent("walkin-add"),
        disabled: !writable || event.date !== MOCK_DATE,
      },
      {
        label: "도어 명단",
        icon: "people",
        color: "blue",
        action: () => go("door"),
      },
      ...(isAdmin
        ? [
            {
              label: "마감 검토",
              icon: "file" as const,
              color: "gray" as const,
              action: () => setIntent("attendance-closeout"),
            },
          ]
        : []),
    ];
  else if (view === "artists")
    tools = [
      {
        label: "아티스트 추가",
        icon: "plus",
        color: "green",
        action: () => setIntent("artist-create"),
      },
      {
        label: "부킹 관리",
        icon: "file",
        color: "blue",
        action: () => go("bookings"),
      },
    ];
  else if (view === "bookings")
    tools = [
      {
        label: "새 부킹",
        icon: "plus",
        color: "green",
        action: () => setIntent("booking-create"),
      },
      {
        label: "공유 일정",
        icon: "calendar",
        color: "blue",
        action: () => go("schedule"),
      },
      {
        label: "행사 준비",
        icon: "check",
        color: "gray",
        action: () => go("preparation"),
      },
    ];
  else if (view === "schedule")
    tools = [
      {
        label: "새 부킹",
        icon: "plus",
        color: "green",
        action: () => go("bookings", "booking-create"),
      },
      {
        label: "행사 준비",
        icon: "check",
        color: "blue",
        action: () => go("preparation"),
      },
    ];
  else if (view === "preparation")
    tools = [
      {
        label: "업무 추가",
        icon: "plus",
        color: "green",
        action: () => setIntent("preparation-add"),
      },
      {
        label: "게스트 명단",
        icon: "people",
        color: "blue",
        action: () => go("roster"),
      },
    ];
  else if (view === "events")
    tools = [
      {
        label: "행사 만들기",
        icon: "plus",
        color: "green",
        action: () => setIntent("event-create"),
      },
      {
        label: "마감 리포트",
        icon: "file",
        color: "blue",
        action: () => go("report"),
      },
      {
        label: "행사 선택",
        icon: "calendar",
        color: "gray",
        action: () => open("scope"),
      },
    ];
  else if (view === "links")
    tools = [
      {
        label: "링크 생성",
        icon: "plus",
        color: "green",
        action: () => setIntent("link-create"),
      },
      {
        label: "행사 선택",
        icon: "calendar",
        color: "blue",
        action: () => open("scope"),
      },
      {
        label: "외부 등록",
        icon: "link",
        color: "gray",
        action: () => go("external"),
      },
    ];
  else if (view === "users")
    tools = [
      {
        label: "계정 생성",
        icon: "plus",
        color: "green",
        action: () => setIntent("user-create"),
      },
      {
        label: "재설정 요청",
        icon: "user",
        color: "blue",
        action: () => go("password-requests"),
      },
    ];
  else if (view === "venues")
    tools = [
      {
        label: "베뉴 생성",
        icon: "plus",
        color: "green",
        action: () => setIntent("venue-create"),
      },
      {
        label: "베뉴 선택",
        icon: "venue",
        color: "blue",
        action: () => open("scope"),
      },
    ];
  else if (view === "requests" && !isAdmin)
    tools = [
      {
        label: "인원 요청",
        icon: "plus",
        color: "green",
        action: () => setIntent("quota-request"),
        disabled: !canRequest,
      },
      {
        label: "내 명단",
        icon: "people",
        color: "gray",
        action: () => go("roster"),
      },
    ];
  else if (view === "home")
    tools = [
      {
        label: "게스트 등록",
        icon: "plus",
        color: "green",
        action: () => go("roster", "guest-add"),
      },
    ];
  // Door starts with lookup; walk-ins remain the adjacent secondary action.
  if (view === "door") tools.reverse();
  const pendingCount =
    data.requests.filter(
      (r) =>
        r.eventId === event.id &&
        r.state === "pending" &&
        (isAdmin || r.userId === user.id),
    ).length +
    (isAdmin
      ? data.resetRequests.filter(
          (r) =>
            r.state === "pending" &&
            data.users.find((u) => u.id === r.userId)?.venueId === venue.id,
        ).length
      : 0);
  const scopeState = attendanceFor(data, event.id).finalized
    ? "집계 마감"
    : event.state === "open"
      ? "운영 중"
      : event.state === "draft"
        ? "준비 중"
        : event.state === "archived"
          ? "보관됨"
          : "운영 종료";
  const renderView = () => {
    switch (view) {
      case "auth":
        return <AuthViews />;
      case "external":
        return <ExternalView />;
      case "profile":
        return <ProfileView />;
      case "home":
        return <Home />;
      case "users":
        return <Accounts />;
      case "password-requests":
        return <ResetRequests />;
      case "venues":
        return <Venues />;
      case "artists":
        return <Artists />;
      case "bookings":
        return <Bookings />;
      case "schedule":
        return <Schedule />;
      case "preparation":
        return <Preparation />;
      case "events":
        return <Events />;
      case "report":
        return <Reports />;
      case "links":
        return <Links />;
      case "attendance":
        return <DoorAttendance />;
      case "requests":
        return <QuotaRequests />;
      case "analytics":
        return <Analytics />;
      default:
        return <Roster />;
    }
  };
  const allowedViews: View[] = [
    "home",
    "roster",
    ...(canDoor ? (["door", "attendance"] as View[]) : []),
    ...(canRequest || isAdmin ? (["requests"] as View[]) : []),
    ...(isAdmin
      ? ([
          "artists",
          "bookings",
          "schedule",
          "preparation",
          "events",
          "report",
          "links",
          "users",
          "password-requests",
          "analytics",
        ] as View[])
      : []),
    ...(isSuper ? (["venues"] as View[]) : []),
    "profile",
  ];
  return (
    <div className="preview-root">
      <header className="preview-toolbar">
        <a
          href="#"
          className="preview-brand"
          onClick={(e) => {
            e.preventDefault();
            go("roster");
          }}
        >
          <strong>
            authon<span> / full feature mockup</span>
          </strong>
        </a>
        <div className="preview-controls">
          <label className="role-select">
            <span className="sr-only">{t("역할 미리보기")}</span>
            <select
              aria-label={t("역할 미리보기")}
              value={isPublic ? view : user.id}
              disabled={busy}
              onChange={(e) => {
                setModal(null);
                const value = e.target.value;
                if (value === "auth") {
                  if (ctx.authPage !== "pending") setAuthPage("login");
                  go("auth");
                } else if (value === "external") go("external");
                else chooseUser(value);
              }}
            >
              {data.users
                .filter((u) => !u.deleted && u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {t(roleLabels[u.role])}
                  </option>
                ))}
              <option value="auth">{t("로그인")}</option>
              <option value="external">{t("외부 등록")}</option>
            </select>
          </label>
          <details className="preview-settings">
            <summary>{t("검토 설정")}</summary>
            <div className="preview-settings-panel">
              <div className="flow-status-tools">
                <select
                  aria-label={t("목업 상태")}
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as Scenario)}
                >
                  {Object.entries(scenarioLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("미리보기 언어")}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as "ko" | "en")}
                >
                  <option value="ko">KO</option>
                  <option value="en">EN</option>
                </select>
              </div>
              <button
                className="preview-device"
                aria-pressed={mobile}
                onClick={() => setMobile((v) => !v)}
              >
                {t(mobile ? "전체 폭" : "모바일 폭")}
              </button>
            </div>
          </details>
          <button className="preview-map" onClick={() => open("coverage")}>
            {t("기능 목록")}
          </button>
        </div>
      </header>
      <div className="preview-meta">
        <span>INTERACTIVE MOCKUP</span>
        <span>
          {t("모든 이름·수치는 샘플입니다.")} · {t("새로고침하면 초기화")}
        </span>
      </div>
      <div className={`preview-frame ${mobile ? "mobile" : ""}`}>
        <div className={`app-shell ${isPublic ? "public" : ""}`}>
          {!isPublic && (
            <>
              <header className="workspace-header">
                <div className="header-title">
                  <button
                    className="scope-button"
                    onClick={() => open("scope")}
                    aria-label={t("베뉴와 행사 선택")}
                  >
                    <span
                      className={`live-dot ${!writable ? "inactive" : ""}`}
                    />
                    <span>
                      {venue.brandName || venue.name} ·{" "}
                      {isTeamView
                        ? t("운영팀")
                        : event.date.slice(5).replace("-", ".")}{" "}
                    </span>
                    <Icon name="down" size={12} />
                  </button>
                  <h1>{isRoster ? event.name : t(viewLabels[view])}</h1>
                </div>
                <button
                  className="account-button"
                  onClick={() => open("account")}
                  aria-label={t("내 계정 열기")}
                >
                  <Icon name="user" size={21} />
                </button>
              </header>
              <div className="workspace-context">
                <span>
                  {isTeamView
                    ? t("전체 행사 · 공연 준비")
                    : isRoster
                      ? t(viewLabels[view])
                      : event.name}
                </span>
                <span className={`scope-status ${writable ? "live" : ""}`}>
                  {t(isTeamView ? "팀 작업 공간" : scopeState)}
                </span>
              </div>
            </>
          )}
          <main
            className="workspace-scroll"
            id="workspace-content"
            aria-label={t(viewLabels[view])}
          >
            {scenario === "loading" ? (
              <div
                className="flow-section"
                role="status"
                aria-label={t("조회 중")}
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <div className="flow-skeleton" key={i} />
                ))}
              </div>
            ) : scenario === "read-error" ? (
              <div className="flow-section">
                <Notice error>
                  데이터를 불러오지 못했습니다. 다시 시도해주세요.
                </Notice>
                <Action onClick={() => setScenario("normal")}>다시 시도</Action>
              </div>
            ) : !isPublic && (scenario === "session-expired" || inactive) ? (
              <div className="flow-section">
                <Notice error>
                  {inactive
                    ? "이 베뉴를 사용할 수 없습니다."
                    : "세션이 만료되었습니다. 다시 로그인해 주세요."}
                </Notice>
                <Action
                  onClick={() => {
                    setScenario("normal");
                    setAuthPage("login");
                    go("auth");
                  }}
                >
                  로그인으로 이동
                </Action>
                {isSuper && (
                  <Action secondary onClick={() => go("venues")}>
                    베뉴 관리
                  </Action>
                )}
              </div>
            ) : forbidden || scenario === "access-denied" ? (
              <div className="flow-section">
                <Notice error>이 화면에 접근할 권한이 없습니다.</Notice>
                <Action
                  onClick={() => {
                    setScenario("normal");
                    go("home");
                  }}
                >
                  홈
                </Action>
              </div>
            ) : (
              <>
                {[
                  "partial-error",
                  "saving",
                  "unknown-result",
                  "scope-closed",
                ].includes(scenario) && (
                  <div className="flow-state-banner">
                    <Notice>
                      {scenario === "partial-error"
                        ? "일부 운영 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요."
                        : scenario === "saving"
                          ? "저장 중입니다."
                          : scenario === "scope-closed"
                            ? "입장 집계가 마감되어 변경을 반영하지 않았습니다."
                            : isPlanning
                              ? "최신 내용을 확인할 수 없어 변경을 잠시 멈췄습니다. 다시 확인해주세요."
                              : "최신 명단을 확인할 수 없어 변경을 잠시 멈췄습니다. 새로고침해주세요."}
                    </Notice>
                    {scenario === "unknown-result" && (
                      <Action secondary onClick={() => setScenario("normal")}>
                        {isPlanning ? "최신 내용 확인" : "최신 명단 확인"}
                      </Action>
                    )}
                  </div>
                )}
                <div key={`${view}:${user.id}:${venue.id}:${event.id}`}>
                  {renderView()}
                </div>
              </>
            )}
          </main>
          {!isPublic && (
            <div className="dock-region" ref={dockRef}>
              {notice && (
                <div
                  className={`toast ${ctx.noticeError ? "error" : ""}`}
                  role={ctx.noticeError ? "alert" : "status"}
                >
                  <span>{t(notice)}</span>
                  <button
                    aria-label={t("알림 닫기")}
                    onClick={() => notify("")}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              )}
              <div className="nav-handle" aria-hidden="true" />
              <nav className="dock-nav" aria-label={t("주요 메뉴")}>
                {nav.map((item) => (
                  <button
                    key={item.view}
                    className={
                      view === item.view ||
                      (item.view === "more" &&
                        !nav.some((n) => n.view === view))
                        ? "active"
                        : ""
                    }
                    aria-current={
                      view === item.view ||
                      (item.view === "more" &&
                        !nav.some((n) => n.view === view))
                        ? "page"
                        : undefined
                    }
                    aria-label={t(item.label)}
                    aria-describedby={
                      pendingCount > 0 &&
                      ((item.view === "more" && isAdmin) ||
                        item.view === "requests")
                        ? "workspace-pending-count"
                        : undefined
                    }
                    aria-haspopup={item.view === "more" ? "dialog" : undefined}
                    onClick={() =>
                      item.view === "more" ? open("more") : go(item.view)
                    }
                  >
                    <Icon name={item.icon} size={18} />
                    <span>{t(item.label)}</span>
                    {pendingCount > 0 &&
                      ((item.view === "more" && isAdmin) ||
                        item.view === "requests") && (
                        <span
                          className="nav-count"
                          id="workspace-pending-count"
                          aria-label={t("대기 {count}건", {
                            count: pendingCount,
                          })}
                        >
                          {pendingCount}
                        </span>
                      )}
                  </button>
                ))}
              </nav>
              <div className="dock-tools" aria-label={t("현재 화면 작업")}>
                {tools.map((tool) => (
                  <button
                    className="action-pill"
                    key={tool.label}
                    disabled={tool.disabled || busy || forbidden || inactive}
                    onClick={tool.action}
                  >
                    <span className={`circle-icon ${tool.color}`}>
                      <Icon name={tool.icon} size={14} />
                    </span>
                    <span>{t(tool.label)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {isPublic && notice && (
            <div className="flow-public-notice">
              <Notice>{notice}</Notice>
            </div>
          )}
        </div>
      </div>
      {modal === "scope" && (
        <Sheet title={t("베뉴와 행사 선택")} onClose={() => setModal(null)}>
          {isSuper && (
            <Select
              label="베뉴"
              value={venue.id}
              onChange={(e) => chooseVenue(e.target.value)}
            >
              {data.venues
                .filter((v) => v.active)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </Select>
          )}
          <Field
            label="운영일"
            type="date"
            value={scopeDate}
            onChange={(e) => setScopeDate(e.target.value)}
          />
          <div className="sheet-options">
            {data.events
              .filter(
                (e) =>
                  e.venueId === venue.id &&
                  e.date === scopeDate &&
                  e.state !== "archived",
              )
              .map((e) => (
                <button
                  className={`sheet-option ${e.id === event.id ? "active" : ""}`}
                  key={e.id}
                  onClick={() => {
                    chooseEvent(e.id);
                    setModal(null);
                  }}
                >
                  <Icon name="calendar" />
                  <div>
                    <strong>{t(e.name)}</strong>
                    <p>
                      {e.date} ·{" "}
                      {t(
                        e.general
                          ? "일반 명단"
                          : e.state === "open"
                            ? "운영 중"
                            : e.state === "draft"
                              ? "초안"
                              : "종료",
                      )}
                    </p>
                  </div>
                </button>
              ))}
          </div>
          {!data.events.some(
            (e) => e.venueId === venue.id && e.date === scopeDate,
          ) && (
            <>
              <Empty text="이 날짜에 별도 행사가 없습니다" />
              <Action
                disabled={!isBusinessDate(scopeDate)}
                onClick={() => {
                  if (!isBusinessDate(scopeDate)) return;
                  const eid = id();
                  setData((d) => ({
                    ...d,
                    events: [
                      ...d.events,
                      {
                        id: eid,
                        venueId: venue.id,
                        date: scopeDate,
                        name: "일반 명단",
                        state: "open",
                        general: true,
                        capacity: null,
                        target: null,
                        createdAt: MOCK_NOW,
                        openedAt: MOCK_NOW,
                        closedAt: null,
                        templateId: null,
                      },
                    ],
                  }));
                  chooseEvent(eid);
                  setModal(null);
                }}
              >
                일반 명단으로 사용
              </Action>
            </>
          )}
        </Sheet>
      )}
      {(modal === "more" || modal === "account") && (
        <Sheet
          title={t(modal === "more" ? "운영 도구" : "내 계정")}
          onClose={() => setModal(null)}
        >
          {modal === "account" && (
            <>
              <strong>{user.name}</strong>
              <p className="flow-hint">
                {user.email} · {t(roleLabels[user.role])}
              </p>
              {user.accountKind === "shared" && (
                <Field
                  label="현재 입력자"
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                  required
                  placeholder="본인 이름 입력"
                />
              )}
            </>
          )}
          <WorkspaceMenu
            views={modal === "account" ? ["profile", "home"] : allowedViews}
            onNavigate={go}
            searchable={modal === "more"}
          />
          {modal === "account" && (
            <>
              <Select
                label="언어"
                value={locale}
                onChange={(e) => setLocale(e.target.value as "ko" | "en")}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </Select>
              <Action
                secondary
                onClick={() => {
                  setAuthPage("login");
                  go("auth");
                }}
              >
                로그아웃
              </Action>
            </>
          )}
        </Sheet>
      )}
      {modal === "coverage" && (
        <Sheet title={t("기능 목록")} onClose={() => setModal(null)}>
          <div className="flow-coverage">
            {coverage.map((item) => (
              <button
                key={item.title}
                onClick={() => {
                  if (item.view === "venues" && !isSuper) chooseUser("super");
                  else if (
                    [
                      "users",
                      "password-requests",
                      "artists",
                      "bookings",
                      "schedule",
                      "preparation",
                      "events",
                      "report",
                      "links",
                      "analytics",
                    ].includes(item.view) &&
                    !isAdmin
                  )
                    chooseUser("admin");
                  else if (
                    ["door", "attendance"].includes(item.view) &&
                    !canDoor
                  )
                    chooseUser("door");
                  if (item.view === "auth") setAuthPage("login");
                  go(item.view, item.intent);
                }}
              >
                <strong>{t(item.title)}</strong>
                <small>{item.features.map((f) => t(f)).join(" · ")}</small>
                <small>
                  {t("지원 상태")}: {item.states.map((s) => t(s)).join(" · ")}
                </small>
              </button>
            ))}
          </div>
          <Action
            secondary
            onClick={() => {
              reset();
              setModal(null);
            }}
          >
            샘플 데이터 초기화
          </Action>
        </Sheet>
      )}
    </div>
  );
}
function Home() {
  const { user, data, event, venue, isAdmin, canDoor, navigate } = useMock();
  const requests = data.requests.filter(
    (r) => r.eventId === event.id && r.state === "pending",
  );
  const resets = data.resetRequests.filter(
    (r) =>
      r.state === "pending" &&
      data.users.find((u) => u.id === r.userId)?.venueId === venue.id,
  );
  return (
    <div className="flow-section">
      <Row title="게스트 등록" onClick={() => navigate("roster")} />
      {canDoor && (
        <Row title="도어 체크인" onClick={() => navigate("door")} />
      )}{" "}
      {isAdmin && (
        <>
          <Row title="부킹 관리" onClick={() => navigate("bookings")} />
          <Row title="계정 관리" onClick={() => navigate("users")} />
          <Row
            title="추가 인원 요청"
            badge={String(requests.length)}
            onClick={() => navigate("requests")}
          />
          <Row
            title="비밀번호 재설정 요청"
            badge={String(resets.length)}
            onClick={() => navigate("password-requests")}
          />
        </>
      )}
      <Row
        title="프로필"
        meta={user.name}
        onClick={() => navigate("profile")}
      />
    </div>
  );
}
