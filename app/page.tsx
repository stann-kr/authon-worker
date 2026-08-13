"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { logout, hasAccess } from "../lib/auth";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";
import Icon, { type IconName } from "@/components/Icon";
import TransitionLink from "@/components/TransitionLink";
import { useRouteTransition } from "@/components/RouteTransitionProvider";
import WorkspaceShell from "@/components/WorkspaceShell";
import { fetchMyVenuePendingGuestLimitRequestCount } from "@/lib/api/guest-limits";
import { fetchPendingPasswordResetRequestCount } from "@/lib/api/password-reset-requests";
import { useLatestRequestGuard } from "@/lib/hooks";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/components/AuthSessionProvider";

interface MenuItem {
  id: string;
  category: string;
  title: string;
  description: string;
  action: string;
  icon: IconName;
  href: string;
  requiredAccess: import("@/lib/users/policy").AccessScope[];
}

export default function Home() {
  const t = useTranslations("Home");
  const { user } = useAuthSession();
  const [pendingGuestRequestCount, setPendingGuestRequestCount] = useState(0);
  const [pendingPasswordResetCount, setPendingPasswordResetCount] = useState(0);
  const router = useRouter();
  const { isRouteTransitionActive, startRouteTransition } =
    useRouteTransition();
  const requestGuard = useLatestRequestGuard();
  const menuItems: MenuItem[] = useMemo(() => [
    {
      id: "guest",
      category: t("guestCategory"),
      title: t("guestTitle"),
      description: t("guestDescription"),
      action: t("guestAction"),
      icon: "user-add",
      href: "/guest",
      requiredAccess: ["guest"],
    },
    {
      id: "door",
      category: t("doorCategory"),
      title: t("doorTitle"),
      description: t("doorDescription"),
      action: t("doorAction"),
      icon: "login",
      href: "/door",
      requiredAccess: ["door"],
    },
    {
      id: "admin",
      category: t("adminCategory"),
      title: t("adminTitle"),
      description: t("adminDescription"),
      action: t("adminAction"),
      icon: "settings",
      href: "/admin",
      requiredAccess: ["admin"],
    },
  ], [t]);

  useEffect(() => {
    const initializeHome = async () => {
      const isLatestRequest = requestGuard.beginRequest();
      if (!user) {
        void logout();
        return;
      }

      try {
        const [guestRequestResult, passwordResetResult] = await Promise.all([
          user.role === "venue_admin"
            ? fetchMyVenuePendingGuestLimitRequestCount()
            : Promise.resolve(null),
          user.role === "venue_admin" || user.role === "super_admin"
            ? fetchPendingPasswordResetRequestCount()
            : Promise.resolve(null),
        ]);
        if (!isLatestRequest()) return;
        if (guestRequestResult?.error) {
          console.error("Failed to load pending guest request count:", guestRequestResult.error);
        } else if (guestRequestResult) {
          setPendingGuestRequestCount(guestRequestResult.data ?? 0);
        }
        if (passwordResetResult?.error) {
          console.error("Failed to load pending password reset count:", passwordResetResult.error);
        } else if (passwordResetResult) {
          setPendingPasswordResetCount(passwordResetResult.data ?? 0);
        }
      } catch (error: unknown) {
        if (isLatestRequest()) {
          console.error("Failed to load pending guest request count:", error);
        }
      }
    };

    initializeHome();
  }, [requestGuard, user]);

  const accessibleMenus = useMemo(
    () =>
      user
        ? menuItems
            .filter((item) => hasAccess(user, item.requiredAccess))
        : [],
    [menuItems, user],
  );

  useEffect(() => {
    if (!user || accessibleMenus.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isRouteTransitionActive ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        document.querySelector('[role="alertdialog"][aria-modal="true"]')
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const keyIndex = Number.parseInt(event.key, 10) - 1;
      if (!Number.isNaN(keyIndex) && accessibleMenus[keyIndex]) {
        event.preventDefault();
        const href = accessibleMenus[keyIndex].href;
        if (startRouteTransition(href)) router.push(href);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    accessibleMenus,
    isRouteTransitionActive,
    router,
    startRouteTransition,
    user,
  ]);

  if (!user) {
    return <RouteLoadingFallback />;
  }

  const workspaceWidthClass =
    accessibleMenus.length === 1
      ? "max-w-[28rem]"
      : accessibleMenus.length === 2
        ? "max-w-[58rem]"
        : "max-w-none";
  const workspaceGridClass =
    accessibleMenus.length === 1
      ? "md:grid-cols-1"
      : accessibleMenus.length === 2
        ? "md:grid-cols-2"
        : "md:grid-cols-3";

  return (
    <WorkspaceShell contentClassName="gap-4 pb-8 sm:gap-5">
      <h1 className="sr-only">{t("availableWorkspaces")}</h1>

      {user.role === "venue_admin" && pendingGuestRequestCount > 0 && (
        <TransitionLink
          href="/admin?tab=guests&view=requests"
          className="pressable group flex min-h-14 items-center gap-3 border border-status-waiting/70 bg-status-waiting/10 px-4 py-3 text-status-waiting hover:border-status-waiting sm:px-5"
        >
          <Icon name="warning" size={20} />
          <span className="min-w-0 flex-1 text-sm font-semibold text-text-heading">
            {t("pendingGuestRequests", { count: pendingGuestRequestCount })}
          </span>
          <Icon name="arrow-right" size={18} />
        </TransitionLink>
      )}

      {(user.role === "venue_admin" || user.role === "super_admin") &&
        pendingPasswordResetCount > 0 && (
          <TransitionLink
            href="/admin?tab=users&view=password-requests"
            className="pressable group flex min-h-14 items-center gap-3 border border-status-waiting/70 bg-status-waiting/10 px-4 py-3 text-status-waiting hover:border-status-waiting sm:px-5"
          >
            <Icon name="key" size={20} />
            <span className="min-w-0 flex-1 text-sm font-semibold text-text-heading">
              {t("pendingPasswordResetRequests", {
                count: pendingPasswordResetCount,
              })}
            </span>
            <Icon name="arrow-right" size={18} />
          </TransitionLink>
        )}

      {accessibleMenus.length > 0 && (
        <nav aria-label={t("availableWorkspaces")} className="w-full">
          <div
            className={`home-workspace-grid mx-auto grid gap-3 sm:gap-4 ${workspaceWidthClass} ${workspaceGridClass}`}
          >
            {accessibleMenus.map((item, index) => (
              <WorkspaceLink key={item.id} item={item} index={index} />
            ))}
          </div>
        </nav>
      )}
    </WorkspaceShell>
  );
}

function WorkspaceLink({
  item,
  index,
}: {
  item: MenuItem;
  index: number;
}) {
  return (
    <TransitionLink
      href={item.href}
      aria-keyshortcuts={String(index + 1)}
      className="home-workspace-card pressable group relative flex h-full min-h-[11rem] flex-col overflow-hidden border border-border-default bg-surface p-5 hover:border-border-strong hover:bg-surface-raised focus-visible:border-border-strong focus-visible:bg-surface-raised sm:min-h-[13rem] sm:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-medium text-text-muted">
          {item.category}
        </p>
        <kbd className="font-mono text-xs font-semibold tabular-nums text-text-dim transition-colors group-hover:text-text-muted">
          [{index + 1}]
        </kbd>
      </div>

      <div className="mt-5 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 sm:mt-6 sm:items-start sm:gap-x-4 sm:gap-y-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center border border-border-default bg-canvas text-text-muted transition-colors group-hover:border-border-strong group-hover:text-text-heading sm:row-span-2 sm:h-11 sm:w-11">
          <Icon name={item.icon} size={22} />
        </span>
        <h2 className="min-w-0 text-xl font-semibold tracking-[-0.025em] text-text-heading sm:text-2xl">
          {item.title}
        </h2>
        <p className="col-span-2 text-pretty text-sm leading-6 text-text-muted sm:col-span-1">
          {item.description}
        </p>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border-subtle pt-4 transition-colors group-hover:border-border-default sm:mt-auto">
        <span className="text-xs font-semibold text-text-muted transition-colors group-hover:text-text-heading">
          {item.action}
        </span>
        <span className="grid h-8 w-8 shrink-0 place-items-center text-text-dim transition-[color,transform] duration-150 group-hover:translate-x-1 group-hover:text-text-heading">
          <Icon name="arrow-right" size={19} />
        </span>
      </div>
    </TransitionLink>
  );
}
