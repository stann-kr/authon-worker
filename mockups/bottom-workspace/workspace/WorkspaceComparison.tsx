import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useMock } from "../data/MockData";
import "./workspace-comparison.css";

export type WorkspaceLayout = "sidebar" | "top";

export function useWorkspaceLayout(frameRef: RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState<WorkspaceLayout | null>(() => {
    const value = new URLSearchParams(window.location.search).get("workspace-layout");
    return value === "sidebar" || value === "top" ? value : null;
  });
  const [wide, setWide] = useState(false);
  const pendingFocus = useRef<{ label: string | null; text: string | null } | null>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let previous: boolean | undefined;
    const resize = () => {
      const next = frame.getBoundingClientRect().width >= 1000;
      if (previous !== undefined && previous !== next) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && frame.contains(active) &&
          active.closest(".dock-nav, .dock-tools, .account-button, [data-responsive-control]")) {
          pendingFocus.current = { label: active.getAttribute("aria-label"), text: active.textContent };
        }
      }
      previous = next;
      setWide(next);
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(frame);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [frameRef]);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const controls = frameRef.current?.querySelectorAll<HTMLElement>(".dock-nav button, .dock-tools button, .account-button, [data-responsive-control] button");
    const replacement = [...(controls ?? [])].find((button) => target.label
      ? button.getAttribute("aria-label") === target.label
      : button.textContent === target.text);
    (replacement ?? frameRef.current?.querySelector<HTMLElement>("main"))?.focus({ preventScroll: true });
  }, [wide, frameRef]);
  const chooseLayout = (next: WorkspaceLayout) => {
    const url = new URL(window.location.href);
    url.searchParams.set("workspace-layout", next);
    window.history.replaceState(window.history.state, "", url);
    setLayout(next);
  };
  return { layout: layout ?? "sidebar", comparing: layout !== null, chooseLayout, desktop: wide };
}

export function WorkspaceComparison({ layout, onChange }: {
  layout: WorkspaceLayout;
  onChange: (layout: WorkspaceLayout) => void;
}) {
  const { t } = useMock();
  return (
    <div className="workspace-comparison" role="group" aria-label={t("데스크톱 메뉴 비교")}>
      <span>{t("데스크톱 메뉴")}</span>
      <button type="button" aria-pressed={layout === "sidebar"} onClick={() => onChange("sidebar")}>
        {t("A · 좌측 사이드바")}
      </button>
      <button type="button" aria-pressed={layout === "top"} onClick={() => onChange("top")}>
        {t("B · 상단 메뉴")}
      </button>
      <small>{t("좁은 화면에서는 하단 메뉴를 사용합니다.")}</small>
    </div>
  );
}
