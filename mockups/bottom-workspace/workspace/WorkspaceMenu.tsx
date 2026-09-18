import { useId, useState } from "react";
import { useMock } from "../data/MockData";
import { viewLabels, type View } from "../data/types";
import { Icon } from "../shared/Icon";
import { navigationGroups, navigationLabel, navigationPendingCounts } from "./navigation";
import "./menu.css";

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
  const menuId = useId();
  const [query, setQuery] = useState("");
  const matches = navigationGroups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        views.includes(item.view) &&
        `${t(navigationLabel(item.view, isAdmin))} ${t(viewLabels[item.view])} ${t(item.detail)} ${t(group.title)}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    ),
  }));
  const counts = navigationPendingCounts(data, event.id, venue.id, user.id, isAdmin);
  const pending = (target: View) => counts[target] ?? 0;
  return (
    <div
      className={`workspace-menu ${searchable ? "workspace-menu-expanded" : ""}`}
    >
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
              <div className={searchable ? "menu-pills" : "sheet-menu"}>
                {group.items.map((item) => (
                  <button
                    key={item.view}
                    type="button"
                    className={searchable ? "navigation-pill" : undefined}
                    aria-label={t(
                      item.view === "roster" && !isAdmin
                        ? "내 명단"
                        : viewLabels[item.view],
                    )}
                    aria-current={view === item.view ? "page" : undefined}
                    aria-describedby={pending(item.view) > 0 ? `${menuId}-${item.view}-pending` : undefined}
                    onClick={() => onNavigate(item.view)}
                  >
                    {!searchable && <Icon name={item.icon} />}
                    <span>
                      <strong>{t(navigationLabel(item.view, isAdmin))}</strong>
                    </span>
                    {pending(item.view) > 0 && (
                      <b
                        className="menu-count"
                        id={`${menuId}-${item.view}-pending`}
                        aria-label={t("대기 {count}건", {
                          count: pending(item.view),
                        })}
                      >
                        {pending(item.view)}
                      </b>
                    )}
                    {!searchable && (
                      <Icon
                        name={view === item.view ? "check" : "chevron"}
                        size={16}
                      />
                    )}
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
