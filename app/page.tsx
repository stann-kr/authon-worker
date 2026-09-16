"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { logout, hasAccess } from "../lib/auth";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";
import RoleLabel from "@/components/RoleLabel";
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
        const logoutResult = await logout();
        if (!logoutResult.success && isLatestRequest()) {
          // Pending logout preserves the server credential. Refreshing lets the
          // server-authenticated user hydrate again instead of leaving Home stuck.
          router.refresh();
        }
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
  }, [requestGuard, router, user]);

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
        document.querySelector('[aria-modal="true"]:is([role="alertdialog"], [role="dialog"])')
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

  return (
    <WorkspaceShell contentClassName="gap-4 pb-8 sm:gap-5">
      <h1 className="sr-only">{t("availableWorkspaces")}</h1>
      <div className="home-overview">
        <div className="home-account"><span aria-hidden="true">{user.name.charAt(0)}</span>
          <div><h2>{user.name}</h2><p><RoleLabel role={user.account_kind === "shared" ? "shared" : user.role} /></p></div>
        </div>
      </div>

      {user.role === "venue_admin" && pendingGuestRequestCount > 0 && (
        <TransitionLink
          href="/admin?tab=guests&view=requests"
          className="home-pending home-overview pressable"
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
            className="home-pending home-overview pressable"
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
            className="home-workspace-grid home-overview"
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
      className="home-workspace-card pressable"
    >
      <span className="home-workspace-icon"><Icon name={item.icon} size={22} /></span>
      <div className="home-workspace-copy"><h2>{item.title}</h2><p>{item.description}</p></div>
      <kbd aria-hidden="true">{index + 1}</kbd>
      <Icon name="chevron-right" size={16} />
    </TransitionLink>
  );
}
