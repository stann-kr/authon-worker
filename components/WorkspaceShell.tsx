"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { useVenueBrand } from "@/components/VenueBrandProvider";
import { useRouteTransition } from "@/components/RouteTransitionProvider";
import TransitionLink from "@/components/TransitionLink";
import LogoutControl from "@/components/LogoutControl";
import RoleLabel from "@/components/RoleLabel";
import Footer from "@/components/Footer";
import WorkspaceNavigation from "./workspace/WorkspaceNavigation";
import { getWorkspaceActiveId, getWorkspaceItems, type WorkspaceItem } from "./workspace/navigation";
import type { AdminTask } from "@/lib/admin-navigation";

interface WorkspaceShellProps {
  children: ReactNode;
  width?: "default" | "narrow";
  contentClassName?: string;
  bottomInsetClassName?: string;
  footerLayer?: "chrome" | "below-mobile-dock";
  title?: string;
  actions?: ReactNode;
  adminNavigation?: {
    activeTask: AdminTask;
    onTaskChange: (task: AdminTask) => void;
    disabled?: boolean;
    pendingPasswordResetCount?: number;
  };
}

const widthClasses = {
  default: "workspace-content-wide",
  narrow: "max-w-[1040px]",
} as const;

export default function WorkspaceShell({
  children,
  width = "default",
  contentClassName = "",
  bottomInsetClassName = "",
  footerLayer = "chrome",
  title,
  actions,
  adminNavigation,
}: WorkspaceShellProps) {
  const t = useTranslations("Workspace");
  const pathname = usePathname();
  const { user } = useAuthSession();
  const { brand } = useVenueBrand();
  const { isRouteTransitionActive } = useRouteTransition();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try { setSidebarCollapsed(window.localStorage.getItem("workspace:sidebarCollapsed") === "true"); } catch { /* Optional preference. */ }
  }, []);
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem("workspace:sidebarCollapsed", String(next)); } catch { /* Keep the current layout in memory. */ }
  };
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      if (height > 0) shellRef.current?.style.setProperty("--app-header-height", `${height}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(header);
    return () => observer?.disconnect();
  }, []);
  const items = user ? getWorkspaceItems({
    role: user.role,
    accountKind: user.account_kind,
    doorAccessEnabled: user.door_access_enabled,
  }) : [];
  const activeId = getWorkspaceActiveId(pathname, adminNavigation?.activeTask, items);
  const activeItem = items.find((item) => item.id === activeId);
  const selectItem = (item: WorkspaceItem, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (pathname === "/admin" && item.task && adminNavigation) {
      event.preventDefault();
      if (!adminNavigation.disabled && !isRouteTransitionActive) adminNavigation.onTaskChange(item.task);
    } else if (item.href === pathname) {
      event.preventDefault();
    }
  };
  return (
    <div ref={shellRef} data-sidebar-collapsed={sidebarCollapsed} className={`page-shell workspace-shell${user ? " workspace-shell--authenticated" : ""}`}>
      <header ref={headerRef} className="workspace-header">
        <div className="workspace-heading">
          <TransitionLink href="/" className="workspace-mobile-brand">{brand.name}</TransitionLink>
          <p className="workspace-title">{title ?? (activeItem ? t(activeItem.label) : brand.name)}</p>
        </div>
        {actions && <div className="workspace-header-actions" role="group" aria-label={t("actions")}>{actions}</div>}
        <div className="workspace-header-account">
          {user && <TransitionLink href="/profile" className="workspace-profile-link"
            aria-label={t("profile")} aria-current={pathname === "/profile" ? "page" : undefined}>
            <span aria-hidden="true">{user.name.charAt(0)}</span>
          </TransitionLink>}
          <LogoutControl />
        </div>
      </header>
      <div className={`page-scroll ${bottomInsetClassName}`}>
        <main
          id="main-content"
          tabIndex={-1}
          className={`page-container ${widthClasses[width]} ${contentClassName}`}
        >
          {children}
        </main>
        <Footer layer={user ? "below-mobile-dock" : footerLayer} />
        {user && <WorkspaceNavigation items={items} activeId={activeId} brandName={brand.name}
          accountName={user.name} accountRole={<RoleLabel role={user.account_kind === "shared" ? "shared" : user.role} />}
          collapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}
          disabled={isRouteTransitionActive || adminNavigation?.disabled}
          counts={{ "password-requests": adminNavigation?.pendingPasswordResetCount ?? 0 }}
          actions={actions} onSelect={selectItem} />}
      </div>
    </div>
  );
}
