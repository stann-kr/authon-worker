import { useLayoutEffect, useRef, useState } from "react";
import { useMock } from "../data/MockData";
import type { View } from "../data/types";
import { navigationLabel } from "./navigation";
import "./dock.css";

function reveal(button: HTMLElement, scroller: HTMLElement) {
  const item = button.getBoundingClientRect(),
    box = scroller.getBoundingClientRect();
  if (item.left < box.left + 20)
    scroller.scrollLeft -= box.left + 20 - item.left;
  else if (item.right > box.right - 20)
    scroller.scrollLeft += item.right - box.right + 20;
}

export function DockNavigation({
  items,
  allowedViews,
  pendingCount,
  menuOpen,
  onSelect,
}: {
  items: View[];
  allowedViews: View[];
  pendingCount: number;
  menuOpen: boolean;
  onSelect: (view: View | "more") => void;
}) {
  const { view, user, locale, isAdmin, t } = useMock();
  const navRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [itemLimit, setItemLimit] = useState(5);
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
      if (selected) reveal(selected, el);
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
  }, [view, user.id, locale, items.length, itemLimit]);
  const button = (target: View) => {
    const showCount = pendingCount > 0 && !isAdmin && target === "requests";
    return (
      <button
        type="button"
        key={target}
        className="navigation-pill"
        aria-current={view === target ? "page" : undefined}
        aria-label={t(navigationLabel(target, isAdmin))}
        aria-describedby={showCount ? "workspace-request-count" : undefined}
        onClick={() => onSelect(target)}
      >
        <span>{t(navigationLabel(target, isAdmin))}</span>
        {showCount && (
          <span
            className="nav-count"
            id="workspace-request-count"
            aria-label={t("대기 {count}건", { count: pendingCount })}
          >
            {pendingCount}
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
              reveal(event.target, scrollerRef.current);
              refreshEdges();
            }
          }}
        >
          {visible.map(button)}
        </div>
        <span className="dock-edge previous" aria-hidden="true">
          ‹
        </span>
        <span className="dock-edge next" aria-hidden="true">
          ›
        </span>
      </div>
      <button
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
      </button>
    </nav>
  );
}
