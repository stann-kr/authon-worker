import { useId, useLayoutEffect, useRef, useState } from "react";
import { useMock } from "../data/MockData";
import type { View } from "../data/types";
import { Icon } from "../shared/Icon";
import { navigationGroups, navigationLabel, navigationPendingCounts } from "./navigation";
import "./dock.css";

function reveal(button: HTMLElement, scroller: HTMLElement, vertical = false) {
  const item = button.getBoundingClientRect(),
    box = scroller.getBoundingClientRect();
  if (vertical) {
    if (item.top < box.top + 4) scroller.scrollTop -= box.top + 4 - item.top;
    else if (item.bottom > box.bottom - 4) scroller.scrollTop += item.bottom - box.bottom + 4;
  } else if (item.left < box.left + 20)
    scroller.scrollLeft -= box.left + 20 - item.left;
  else if (item.right > box.right - 20)
    scroller.scrollLeft += item.right - box.right + 20;
}

export function DockNavigation({
  items,
  allowedViews,
  pendingCount,
  menuOpen,
  expanded = false,
  onSelect,
}: {
  items: View[];
  allowedViews: View[];
  pendingCount: number;
  menuOpen: boolean;
  expanded?: boolean;
  onSelect: (view: View | "more") => void;
}) {
  const { view, user, locale, isAdmin, t, data, event, venue } = useMock();
  const navigationId = useId();
  const navRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [itemLimit, setItemLimit] = useState(5);
  const groups = navigationGroups.map((group) => ({ ...group,
    items: group.items.filter((item) => allowedViews.includes(item.view) && item.view !== "home" && item.view !== "profile"),
  })).filter((group) => group.items.length > 0);
  const context = `${user.id}:${venue.id}:${view}`;
  const [groupChoice, setGroupChoice] = useState<{ context: string; id: string | null } | null>(null);
  if (groupChoice && groupChoice.context !== context) setGroupChoice(null);
  const activeGroup = groups.find((group) => group.items.some((item) => item.view === view));
  const openGroup = groupChoice?.context === context ? groupChoice.id : activeGroup?.id ?? groups[0]?.id;
  const counts = navigationPendingCounts(data, event.id, venue.id, user.id, isAdmin);
  const visible = items.slice(0, itemLimit);
  if (allowedViews.includes(view) && !visible.includes(view)) {
    if (visible.length < itemLimit) visible.push(view);
    else visible[visible.length - 1] = view;
  }
  const refreshEdges = () => {
    const el = scrollerRef.current;
    if (!el) return;
    el.dataset.previous = String(el.scrollLeft > 2);
    el.dataset.next = String(
      el.scrollWidth - el.clientWidth - el.scrollLeft > 2,
    );
  };
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const resize = () => {
      const workspaceWidth = navRef.current?.closest<HTMLElement>(".app-shell")?.clientWidth;
      const width = workspaceWidth ? workspaceWidth - 24 : navRef.current?.clientWidth;
      if (width) setItemLimit(width < 340 ? 4 : 5);
      const selected = el.querySelector<HTMLElement>('[aria-current="page"]');
      if (selected && !selected.closest("[hidden]")) {
        if (el.contains(document.activeElement) && document.activeElement?.closest("[hidden]")) selected.focus({ preventScroll: true });
        reveal(selected, expanded && navRef.current ? navRef.current : el, expanded);
      }
      refreshEdges();
    };
    resize();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(el);
    if (navRef.current) observer?.observe(navRef.current);
    const workspace = navRef.current?.closest(".app-shell");
    if (workspace) observer?.observe(workspace);
    return () => observer?.disconnect();
  }, [view, user.id, locale, items.length, itemLimit, expanded, openGroup]);
  const button = (target: View) => {
    const count = expanded ? counts[target] ?? 0 : !isAdmin && target === "requests" ? pendingCount : 0;
    const countId = `${navigationId}-${target}-count`;
    return (
      <button
        type="button"
        key={target}
        className="navigation-pill"
        aria-current={view === target ? "page" : undefined}
        aria-label={t(navigationLabel(target, isAdmin))}
        aria-describedby={count > 0 ? countId : undefined}
        onClick={() => onSelect(target)}
      >
        <span>{t(navigationLabel(target, isAdmin))}</span>
        {count > 0 && (
          <span
            className="nav-count"
            id={countId}
            aria-label={t("대기 {count}건", { count })}
          >
            {count}
          </span>
        )}
      </button>
    );
  };
  return (
    <nav className="dock-nav" ref={navRef} aria-label={t("주요 메뉴")}>
      <div className="dock-nav-window">
        <div
          className="dock-nav-scroll"
          ref={scrollerRef}
          onScroll={refreshEdges}
          onFocusCapture={(event) => {
            if (scrollerRef.current && event.target instanceof HTMLElement) {
              reveal(event.target, expanded && navRef.current ? navRef.current : scrollerRef.current, expanded);
              refreshEdges();
            }
          }}
        >
          {expanded ? <>
            {allowedViews.includes("home") && button("home")}
            {groups.map((group) => {
              const isOpen = groups.length === 1 || openGroup === group.id;
              const panelId = `${navigationId}-${group.id}`;
              const count = group.items.reduce((total, item) => total + (counts[item.view] ?? 0), 0);
              return <section className="sidebar-group" key={group.id} aria-labelledby={`${panelId}-title`}>
                <h2>
                  {groups.length === 1 ? <span className="sidebar-group-label" id={`${panelId}-title`}>{t(group.title)}</span> :
                    <button type="button" className="sidebar-group-toggle"
                      aria-label={t(group.title)}
                      aria-expanded={isOpen} aria-controls={panelId}
                      aria-describedby={!isOpen && count > 0 ? `${panelId}-count` : undefined}
                      data-current={activeGroup?.id === group.id}
                      onClick={() => setGroupChoice({ context, id: isOpen ? null : group.id })}>
                      <Icon name={isOpen ? "down" : "chevron"} size={14} />
                      <span id={`${panelId}-title`}>{t(group.title)}</span>
                      {!isOpen && count > 0 && <span className="nav-count" id={`${panelId}-count`}
                        aria-label={t("대기 {count}건", { count })}>{count}</span>}
                    </button>}
                </h2>
                <div className="sidebar-group-items" id={panelId} hidden={!isOpen}>
                  {group.items.map((item) => button(item.view))}
                </div>
              </section>;
            })}
          </> : visible.map(button)}
        </div>
        <span className="dock-edge previous" aria-hidden="true">
          ‹
        </span>
        <span className="dock-edge next" aria-hidden="true">
          ›
        </span>
      </div>
      {!expanded && <button
        type="button"
        className="dock-more"
        aria-label={t("전체 메뉴")}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? "workspace-all-menu" : undefined}
        aria-describedby={
          isAdmin && pendingCount > 0 ? "workspace-pending-count" : undefined
        }
        onClick={() => onSelect("more")}
      >
        <span>{t("전체")}</span>
        {isAdmin && pendingCount > 0 && (
          <span
            className="nav-count"
            id="workspace-pending-count"
            aria-label={t("대기 {count}건", { count: pendingCount })}
          >
            {pendingCount}
          </span>
        )}
      </button>}
    </nav>
  );
}
