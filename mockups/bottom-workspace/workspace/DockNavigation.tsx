import { useLayoutEffect, useRef } from "react";
import { useMock } from "../data/MockData";
import type { View } from "../data/types";
import { Icon, type IconName } from "../shared/Icon";
import "./dock.css";

type Item = { view: View | "more"; label: string; icon: IconName };

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
  pendingCount,
  onSelect,
}: {
  items: Item[];
  pendingCount: number;
  onSelect: (view: Item["view"]) => void;
}) {
  const { view, user, locale, isAdmin, t } = useMock();
  const scrollerRef = useRef<HTMLDivElement>(null);
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
      const selected = el.querySelector<HTMLElement>('[aria-current="page"]');
      if (selected) reveal(selected, el);
      refreshEdges();
    };
    resize();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [view, user.id, locale, items.length]);
  const button = (item: Item) => {
    const active =
      view === item.view ||
      (item.view === "more" && !items.some((n) => n.view === view));
    const showCount =
      pendingCount > 0 &&
      ((item.view === "more" && isAdmin) || item.view === "requests");
    return (
      <button
        key={item.view}
        className={`${active ? "active" : ""} ${item.view === "more" ? "dock-more" : ""}`}
        aria-current={active ? "page" : undefined}
        aria-label={t(item.label)}
        aria-describedby={showCount ? "workspace-pending-count" : undefined}
        aria-haspopup={item.view === "more" ? "dialog" : undefined}
        onClick={() => onSelect(item.view)}
      >
        <Icon name={item.icon} size={18} />
        <span>{t(item.label)}</span>
        {showCount && (
          <span
            className="nav-count"
            id="workspace-pending-count"
            aria-label={t("대기 {count}건", { count: pendingCount })}
          >
            {pendingCount}
          </span>
        )}
      </button>
    );
  };
  return (
    <nav className="dock-nav" aria-label={t("주요 메뉴")}>
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
          {items.filter((item) => item.view !== "more").map(button)}
        </div>
        <span className="dock-edge previous" aria-hidden="true">
          ‹
        </span>
        <span className="dock-edge next" aria-hidden="true">
          ›
        </span>
      </div>
      {items.filter((item) => item.view === "more").map(button)}
    </nav>
  );
}
