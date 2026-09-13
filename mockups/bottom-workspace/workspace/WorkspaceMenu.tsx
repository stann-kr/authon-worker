import { useId, useState } from "react";
import { useMock } from "../data/MockData";
import { viewLabels, type View } from "../data/types";
import { Icon, type IconName } from "../shared/Icon";
import "./menu.css";

const groups: {
  title: string;
  items: { view: View; icon: IconName; detail: string }[];
}[] = [
  {
    title: "공연 준비",
    items: [
      { view: "artists", icon: "user", detail: "연락처·자료·출연 이력" },
      { view: "bookings", icon: "file", detail: "문의·조율·홀드·출연 확정" },
      {
        view: "schedule",
        icon: "calendar",
        detail: "출연 시간과 일정 겹침 확인",
      },
      {
        view: "preparation",
        icon: "check",
        detail: "출연표·자료·준비 체크리스트",
      },
    ],
  },
  {
    title: "현장 운영",
    items: [
      { view: "home", icon: "home", detail: "작업 공간과 대기 요청" },
      { view: "roster", icon: "people", detail: "등록·검색·명단 관리" },
      { view: "door", icon: "door", detail: "게스트 확인과 입장 처리" },
      { view: "attendance", icon: "chart", detail: "워크인·동기화·집계 마감" },
      { view: "requests", icon: "bell", detail: "등록 한도 요청과 승인 내역" },
    ],
  },
  {
    title: "행사와 기록",
    items: [
      { view: "events", icon: "calendar", detail: "행사 준비·개시·종료" },
      { view: "links", icon: "link", detail: "외부 담당자·본인 등록 링크" },
      { view: "report", icon: "file", detail: "운영 결과 확인과 내보내기" },
      { view: "analytics", icon: "chart", detail: "기간별 추이와 기여자" },
    ],
  },
  {
    title: "계정과 설정",
    items: [
      { view: "users", icon: "people", detail: "초대·역할·등록 한도" },
      {
        view: "password-requests",
        icon: "user",
        detail: "본인 확인과 재설정 승인",
      },
      { view: "venues", icon: "venue", detail: "베뉴 정보와 운영 설정" },
      { view: "profile", icon: "user", detail: "내 정보·언어·비밀번호" },
    ],
  },
];

export function WorkspaceMenu({
  views,
  onNavigate,
  searchable,
}: {
  views: View[];
  onNavigate: (view: View) => void;
  searchable: boolean;
}) {
  const { t, view, data, event, venue, user, isAdmin } = useMock();
  const [query, setQuery] = useState("");
  const menuId = useId();
  const matches = groups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        views.includes(item.view) &&
        `${t(viewLabels[item.view])} ${t(item.detail)} ${t(group.title)}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    ),
  }));
  const pending = (target: View) =>
    target === "requests"
      ? data.requests.filter(
          (r) =>
            r.eventId === event.id &&
            r.state === "pending" &&
            (isAdmin || r.userId === user.id),
        ).length
      : target === "password-requests"
        ? data.resetRequests.filter(
            (r) =>
              r.state === "pending" &&
              data.users.find((u) => u.id === r.userId)?.venueId === venue.id,
          ).length
        : 0;
  return (
    <div className="workspace-menu">
      {searchable && (
        <label className="menu-search">
          <Icon name="search" size={18} />
          <span className="sr-only">{t("메뉴 검색")}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("메뉴 검색")}
            type="search"
          />
        </label>
      )}
      {matches.map(
        (group) =>
          group.items.length > 0 && (
            <section key={group.title}>
              {searchable && <h3>{t(group.title)}</h3>}
              <div className="sheet-menu">
                {group.items.map((item) => (
                  <button
                    key={item.view}
                    aria-label={t(viewLabels[item.view])}
                    aria-describedby={`${menuId}-${item.view}`}
                    aria-current={view === item.view ? "page" : undefined}
                    onClick={() => onNavigate(item.view)}
                  >
                    <Icon name={item.icon} />
                    <span>
                      <strong>{t(viewLabels[item.view])}</strong>
                      <small id={`${menuId}-${item.view}`}>
                        {t(item.detail)}
                      </small>
                    </span>
                    {pending(item.view) > 0 && (
                      <b className="menu-count">{pending(item.view)}</b>
                    )}
                    <Icon
                      name={view === item.view ? "check" : "chevron"}
                      size={16}
                    />
                  </button>
                ))}
              </div>
            </section>
          ),
      )}
      {!matches.some((group) => group.items.length) && (
        <div className="menu-empty" role="status">
          <p>{t("일치하는 메뉴가 없습니다.")}</p>
          <button className="secondary" onClick={() => setQuery("")}>
            {t("검색 지우기")}
          </button>
        </div>
      )}
    </div>
  );
}
