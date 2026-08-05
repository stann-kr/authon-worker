"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, logout, hasAccess, type User } from "../lib/auth";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";
import Icon, { type IconName } from "@/components/Icon";
import TransitionLink from "@/components/TransitionLink";
import { useRouteTransition } from "@/components/RouteTransitionProvider";
import WorkspaceShell from "@/components/WorkspaceShell";
import { fetchMyVenuePendingGuestLimitRequestCount } from "@/lib/api/guest-limits";
import { useLatestRequestGuard } from "@/lib/hooks";
import { useTranslations } from "next-intl";

interface MenuItem {
  id: string;
  title: string;
  icon: IconName;
  href: string;
  requiredAccess: import("@/lib/users/policy").AccessScope[];
}

export default function Home() {
  const t = useTranslations("Home");
  const commonT = useTranslations("Common");
  const [user, setUser] = useState<User | null>(null);
  const [pendingGuestRequestCount, setPendingGuestRequestCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { isRouteTransitionActive, startRouteTransition } =
    useRouteTransition();
  const requestGuard = useLatestRequestGuard();
  const menuItems: MenuItem[] = useMemo(() => [
    {
      id: "guest",
      title: commonT("guest"),
      icon: "user-add",
      href: "/guest",
      requiredAccess: ["guest"],
    },
    {
      id: "door",
      title: commonT("door"),
      icon: "login",
      href: "/door",
      requiredAccess: ["door"],
    },
    {
      id: "admin",
      title: commonT("admin"),
      icon: "settings",
      href: "/admin",
      requiredAccess: ["admin"],
    },
  ], [commonT]);

  useEffect(() => {
    const initializeHome = async () => {
      const isLatestRequest = requestGuard.beginRequest();
      const currentUser = getUser();
      if (!currentUser) {
        logout();
        return;
      }

      setUser(currentUser);
      setIsLoading(false);

      try {
        if (currentUser.role === "venue_admin") {
          const { data, error } =
            await fetchMyVenuePendingGuestLimitRequestCount();
          if (!isLatestRequest()) return;
          if (error) {
            console.error("Failed to load pending guest request count:", error);
          } else {
            setPendingGuestRequestCount(data ?? 0);
          }
        }
      } catch (error: unknown) {
        if (isLatestRequest()) {
          console.error("Failed to load pending guest request count:", error);
        }
      }
    };

    initializeHome();
  }, [requestGuard]);

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

  if (isLoading) {
    return <RouteLoadingFallback />;
  }

  if (!user) return null;

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
        : "md:grid-cols-2 lg:grid-cols-3";

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
      className="home-workspace-card pressable group relative flex min-h-[11rem] flex-col justify-between overflow-hidden border border-border-default bg-surface p-5 hover:border-border-strong hover:bg-surface-raised focus-visible:border-border-strong focus-visible:bg-surface-raised sm:min-h-[13rem] sm:p-6 lg:min-h-[15rem]"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center border border-border-default bg-canvas text-text-muted transition-colors group-hover:border-border-strong group-hover:text-text-heading">
          <Icon name={item.icon} size={23} />
        </span>
        <kbd className="font-mono text-xs font-semibold tabular-nums text-text-dim transition-colors group-hover:text-text-muted">
          [{index + 1}]
        </kbd>
      </div>

      <div className="mt-8 flex min-w-0 items-end justify-between gap-5">
        <h2 className="min-w-0 text-xl font-semibold tracking-[-0.025em] text-text-heading sm:text-2xl">
          {item.title}
        </h2>
        <span className="grid h-11 w-11 shrink-0 place-items-center text-text-dim transition-[color,transform] duration-150 group-hover:translate-x-1 group-hover:text-text-heading">
          <Icon name="arrow-right" size={19} />
        </span>
      </div>
    </TransitionLink>
  );
}
