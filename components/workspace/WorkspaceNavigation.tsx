"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import TransitionLink from "@/components/TransitionLink";
import WorkspaceMenu from "./WorkspaceMenu";
import { getWorkspacePrimaryItems, workspaceGroups, type WorkspaceItem } from "./navigation";

export interface WorkspaceNavigationProps {
  items: WorkspaceItem[];
  activeId?: string;
  brandName: string;
  accountName: string;
  accountRole: ReactNode;
  actions?: ReactNode;
  counts?: Record<string, number>;
  disabled?: boolean;
  onSelect: (item: WorkspaceItem, event: MouseEvent<HTMLAnchorElement>) => void;
}

export default function WorkspaceNavigation({
  items, activeId, brandName, accountName, accountRole, actions, counts = {}, disabled, onSelect,
}: WorkspaceNavigationProps) {
  const t = useTranslations("Workspace");
  const navigationId = useId();
  const [desktop, setDesktop] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [groupChoice, setGroupChoice] = useState<{ context: string; group: string | null } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const activeGroup = items.find((item) => item.id === activeId)?.group;
  const groups = workspaceGroups.map((id) => ({ id, items: items.filter((item) => item.group === id) }))
    .filter((group) => group.items.length > 0);
  const context = `${activeId}:${items.map((item) => item.id).join(",")}`;
  const openGroup = groupChoice?.context === context ? groupChoice.group : activeGroup ?? groups[0]?.id;

  useEffect(() => { setGroupChoice(null); }, [context]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1000px)");
    const update = () => {
      restoreFocusRef.current = Boolean(navRef.current?.contains(document.activeElement) ||
        dockRef.current?.contains(document.activeElement) ||
        document.activeElement?.closest(".workspace-header-actions") ||
        document.getElementById("workspace-all-menu")?.contains(document.activeElement));
      setMenuOpen(false);
      setDesktop(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (restoreFocusRef.current || (navRef.current?.contains(document.activeElement) && document.activeElement?.closest("[hidden]"))) {
      (current ?? navRef.current?.querySelector<HTMLElement>("a, button"))?.focus({ preventScroll: true });
      restoreFocusRef.current = false;
    }
    if (!desktop) current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [desktop, activeId]);

  useLayoutEffect(() => {
    const dock = dockRef.current;
    const scroll = dock?.closest<HTMLElement>(".page-scroll");
    if (!dock || !scroll) return;
    const measure = () => {
      const height = Math.ceil(dock.getBoundingClientRect().height);
      if (height > 0) scroll.style.setProperty("--workspace-dock-height", `${height + 16}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(dock);
    return () => {
      observer?.disconnect();
      scroll.style.removeProperty("--workspace-dock-height");
    };
  }, [desktop, actions]);

  const link = (item: WorkspaceItem, account = false, surface = "nav") => {
    const count = counts[item.id] ?? 0;
    return <TransitionLink key={item.id} href={item.href}
      className={account ? "workspace-account" : "workspace-nav-link"}
      aria-current={activeId === item.id ? "page" : undefined}
      aria-disabled={disabled}
      aria-describedby={count > 0 ? `${navigationId}-${surface}-${item.id}-count` : undefined}
      onClick={(event) => {
        if (disabled) { event.preventDefault(); return; }
        onSelect(item, event);
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          setMenuOpen(false);
        }
      }}>
      {account ? <><span className="workspace-avatar" aria-hidden="true">{accountName.charAt(0)}</span>
        <span><strong>{accountName}</strong><small>{accountRole}</small></span></> : <span>{t(item.label)}</span>}
      {count > 0 && <span id={`${navigationId}-${surface}-${item.id}-count`} className="workspace-nav-count"
        aria-label={t("pendingCount", { count })}>{count}</span>}
    </TransitionLink>;
  };
  const groupedLinks = (collapsible: boolean) => groups.map((group) => {
    const open = !collapsible || groups.length === 1 || openGroup === group.id;
    const panelId = `${navigationId}-${group.id}`;
    const count = group.items.reduce((sum, item) => sum + (counts[item.id] ?? 0), 0);
    return <section className="workspace-nav-group" key={group.id} aria-labelledby={`${panelId}-title`}>
      <h2 id={`${panelId}-title`}>
        {collapsible && groups.length > 1 ? <button type="button"
          aria-label={t(`groups.${group.id}`)}
          aria-describedby={!open && count > 0 ? `${panelId}-count` : undefined}
          aria-expanded={open} aria-controls={panelId}
          onClick={() => setGroupChoice({ context, group: open ? null : group.id })}>
          <span aria-hidden="true">{open ? "⌄" : "›"}</span>{t(`groups.${group.id}`)}
          {!open && count > 0 && <span id={`${panelId}-count`} className="workspace-nav-count" aria-label={t("pendingCount", { count })}>{count}</span>}
        </button> : t(`groups.${group.id}`)}
      </h2>
      <div id={panelId} className="workspace-group-links" hidden={!open}>{group.items.map((item) => link(item, false, collapsible ? "nav" : "menu"))}</div>
    </section>;
  });
  const home = items.find((item) => item.id === "home");
  const profile = items.find((item) => item.id === "profile");

  if (desktop) return <aside className="workspace-sidebar">
    <TransitionLink href="/" className="workspace-brand">{brandName}</TransitionLink>
    <nav ref={navRef} aria-label={t("navigation")}>
      {home && link(home)}{groupedLinks(true)}
      {profile && link(profile, true)}
    </nav>
  </aside>;

  return <>
    <div className="workspace-dock" ref={dockRef}>
      <nav ref={navRef} className="workspace-primary-nav" aria-label={t("navigation")}>
        <div className="workspace-primary-scroll">{getWorkspacePrimaryItems(items, activeId).map((item) => link(item))}</div>
        <button type="button" className="workspace-nav-link workspace-more" aria-haspopup="dialog"
          aria-label={t("allMenu")} aria-expanded={menuOpen}
          aria-controls={menuOpen ? "workspace-all-menu" : undefined}
          disabled={disabled} onClick={() => setMenuOpen(true)}>{t("more")}</button>
      </nav>
      {actions && <div className="workspace-context-actions" role="group" aria-label={t("actions")}>{actions}</div>}
    </div>
    {menuOpen && <WorkspaceMenu title={t("allMenu")} closeLabel={t("close")} onClose={() => setMenuOpen(false)}>
      <nav aria-label={t("allMenu")}>{home && link(home, false, "menu")}{groupedLinks(false)}{profile && link(profile, false, "menu")}</nav>
    </WorkspaceMenu>}
  </>;
}
