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
  const { startRouteTransition } = useRouteTransition();
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
        const href = accessibleMenus[keyIndex].href;
        if (startRouteTransition(href)) router.push(href);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [accessibleMenus, router, startRouteTransition, user]);

  if (isLoading) {
    return <RouteLoadingFallback />;
  }

  if (!user) return null;

  const preferredPrimaryId =
    user.role === "super_admin" || user.role === "venue_admin"
      ? "admin"
      : user.role === "door_staff"
        ? "door"
        : "guest";
  const primaryWorkspace =
    accessibleMenus.find((item) => item.id === preferredPrimaryId) ??
    accessibleMenus[0];
  const orderedWorkspaces = primaryWorkspace
    ? [
        primaryWorkspace,
        ...accessibleMenus.filter((item) => item.id !== primaryWorkspace.id),
      ]
    : accessibleMenus;
  const shortcutIndexById = new Map(
    accessibleMenus.map((item, index) => [item.id, index]),
  );

  return (
    <WorkspaceShell width="home" contentClassName="gap-4 pb-8">
      <h1 className="sr-only">{t("availableWorkspaces")}</h1>

      {user.role === "venue_admin" && pendingGuestRequestCount > 0 && (
        <TransitionLink
          href="/admin?tab=guests&view=requests"
          className="group flex min-h-14 items-center gap-3 border border-status-waiting/70 bg-status-waiting/10 px-4 py-3 text-status-waiting hover:border-status-waiting sm:px-5"
        >
          <Icon name="warning" size={20} />
          <span className="min-w-0 flex-1 text-sm font-semibold text-text-heading">
            {t("pendingGuestRequests", { count: pendingGuestRequestCount })}
          </span>
          <Icon name="arrow-right" size={18} />
        </TransitionLink>
      )}

      {orderedWorkspaces.length > 0 && (
        <nav
          aria-label={t("availableWorkspaces")}
          className="app-panel divide-y divide-border-subtle"
        >
          {orderedWorkspaces.map((item) => (
            <WorkspaceLink
              key={item.id}
              item={item}
              index={shortcutIndexById.get(item.id) ?? 0}
            />
          ))}
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
      className="pressable group flex min-h-16 items-center gap-3 bg-surface px-4 py-3 hover:bg-surface-raised focus-visible:bg-surface-raised sm:gap-4 sm:px-5"
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center border border-border-default bg-canvas text-text-muted group-hover:border-border-strong group-hover:text-text-heading">
        <Icon name={item.icon} size={20} />
      </div>
      <span className="min-w-0 flex-1 text-sm font-semibold text-text-heading sm:text-base">
        {item.title}
      </span>
      <kbd className="hidden border border-border-default bg-canvas px-2 py-0.5 font-mono text-xs tabular-nums text-text-dim group-hover:border-border-strong sm:block">
        {index + 1}
      </kbd>
      <Icon name="arrow-right" size={17} className="text-text-muted" />
    </TransitionLink>
  );
}
