"use client";

import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import TransitionLink from "@/components/TransitionLink";
import Icon, { type IconName } from "@/components/Icon";
import { useKeyboardOpen } from "@/components/viewport/ViewportProvider";
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
  collapsed?: boolean;
  onToggleSidebar?: () => void;
  onSelect: (item: WorkspaceItem, event: MouseEvent<HTMLAnchorElement>) => void;
}

const navigationIcons: Record<string, IconName> = {
  home: "home", events: "calendar", guest: "user-add", door: "login",
  links: "link", requests: "user-add", analytics: "chart-line", users: "user-admin",
  "password-requests": "key", venues: "store", profile: "user",
};

export default function WorkspaceNavigation({
  items, activeId, brandName, accountName, accountRole, actions, counts = {}, disabled, onSelect,
  collapsed = false, onToggleSidebar,
}: WorkspaceNavigationProps) {
  const t = useTranslations("Workspace");
  const keyboardOpen = useKeyboardOpen();
  const navigationId = useId();
  const [desktop, setDesktop] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const groups = workspaceGroups.map((id) => ({ id, items: items.filter((item) => item.group === id) }))
    .filter((group) => group.items.length > 0);

  useLayoutEffect(() => {
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
    if (!desktop && current) {
      const scroller = current.closest<HTMLElement>(".workspace-primary-scroll");
      if (scroller) {
        const item = current.getBoundingClientRect();
        const viewport = scroller.getBoundingClientRect();
        // Reveal only the horizontal menu; scrollIntoView can also move page content.
        if (item.left < viewport.left) scroller.scrollLeft += item.left - viewport.left;
        else if (item.right > viewport.right) scroller.scrollLeft += item.right - viewport.right;
      }
    }
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
      aria-label={desktop && collapsed ? account ? `${accountName} · ${t("profile")}` : t(item.label) : undefined}
      aria-describedby={count > 0 ? `${navigationId}-${surface}-${item.id}-count` : undefined}
      onClick={(event) => {
        if (disabled) { event.preventDefault(); return; }
        onSelect(item, event);
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          setMenuOpen(false);
        }
      }}>
      {account ? <><span className="workspace-avatar" aria-hidden="true">{accountName.charAt(0)}</span>
        <span className="workspace-account-label"><strong>{accountName}</strong><small>{accountRole}</small></span></> : <>
          <Icon name={navigationIcons[item.id] ?? "settings"} size={18} className="workspace-nav-icon" />
          <span className="workspace-nav-label">{t(item.label)}</span>
        </>}
      {desktop && collapsed && <span className="workspace-nav-tooltip" aria-hidden="true">{account ? accountName : t(item.label)}</span>}
      {count > 0 && <span id={`${navigationId}-${surface}-${item.id}-count`} className="workspace-nav-count"
        aria-label={t("pendingCount", { count })}>{count}</span>}
    </TransitionLink>;
  };
  const groupedLinks = (surface: string) => groups.map((group) => {
    const panelId = `${navigationId}-${group.id}`;
    return <section className="workspace-nav-group" key={group.id} aria-labelledby={`${panelId}-title`}>
      <h2 id={`${panelId}-title`}>{t(`groups.${group.id}`)}</h2>
      <div id={panelId} className="workspace-group-links">{group.items.map((item) => link(item, false, surface))}</div>
    </section>;
  });
  const home = items.find((item) => item.id === "home");
  const profile = items.find((item) => item.id === "profile");

  if (desktop) return <aside className="workspace-sidebar" data-collapsed={collapsed}>
    <div className="workspace-sidebar-heading">
      <TransitionLink href="/" className="workspace-brand" aria-label={brandName}>
        <span className="workspace-brand-full">{brandName}</span><span className="workspace-brand-short" aria-hidden="true">{brandName.charAt(0)}</span>
      </TransitionLink>
      {onToggleSidebar && <button type="button" className="workspace-sidebar-toggle"
        onClick={onToggleSidebar} disabled={disabled} aria-expanded={!collapsed}
        aria-label={t(collapsed ? "expandSidebar" : "collapseSidebar")}>
        <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={18} />
      </button>}
    </div>
    <nav ref={navRef} aria-label={t("navigation")}>
      {home && link(home)}{groupedLinks("nav")}
      {profile && link(profile, true)}
    </nav>
  </aside>;

  return <>
    <div className="workspace-dock" ref={dockRef} hidden={keyboardOpen}>
      {actions && <div className="workspace-context-actions" role="group" aria-label={t("actions")}>{actions}</div>}
      <nav ref={navRef} className="workspace-primary-nav" aria-label={t("navigation")}>
        <div className="workspace-primary-scroll">{getWorkspacePrimaryItems(items, activeId).map((item) => link(item))}</div>
        <button type="button" className="workspace-nav-link workspace-more"
          aria-label={t("allMenu")} aria-expanded={menuOpen}
          aria-controls={menuOpen ? "workspace-all-menu" : undefined}
          disabled={disabled} onClick={() => setMenuOpen((open) => !open)}>
          <span className="workspace-nav-label">{t("more")}</span>
        </button>
      </nav>
    </div>
    <WorkspaceMenu open={menuOpen} title={t("allMenu")}
      onClose={() => setMenuOpen(false)}>
      <nav aria-label={t("allMenu")}>{home && link(home, false, "menu")}{groupedLinks("menu")}{profile && link(profile, false, "menu")}</nav>
    </WorkspaceMenu>
  </>;
}
