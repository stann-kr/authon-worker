"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, logout, hasAccess, type User } from "../lib/auth";
import Footer from "@/components/Footer";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";
import Icon, { type IconName } from "@/components/Icon";
import TransitionLink from "@/components/TransitionLink";
import { useRouteTransition } from "@/components/RouteTransitionProvider";
import AdminHeader from "@/app/admin/components/AdminHeader";
import { fetchMyVenuePendingGuestLimitRequestCount } from "@/lib/api/guest-limits";
import { useLatestRequestGuard } from "@/lib/hooks";
import { useTranslations } from "next-intl";

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
  const [user, setUser] = useState<User | null>(null);
  const [pendingGuestRequestCount, setPendingGuestRequestCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { startRouteTransition } = useRouteTransition();
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

  const workspaceWidthClass =
    accessibleMenus.length === 1
      ? "max-w-[34rem]"
      : accessibleMenus.length === 2
        ? "max-w-[44rem]"
        : "max-w-[1040px]";

  const workspaceGridClass =
    accessibleMenus.length === 1
      ? "md:grid-cols-1"
      : accessibleMenus.length === 2
        ? "md:grid-cols-2"
        : "md:grid-cols-3";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <AdminHeader />

      <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-4 pb-8 pt-20 sm:px-6 sm:pt-24 lg:px-10">
        {user.role === "venue_admin" && pendingGuestRequestCount > 0 && (
          <TransitionLink
            href="/admin?tab=guests&view=requests"
            className="group mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border border-status-waiting/70 bg-status-waiting/10 px-4 py-4 text-status-waiting hover:border-status-waiting focus-visible:outline-none sm:px-5"
          >
            <Icon name="warning" size={22} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-heading">
                {t("pendingGuestRequests", { count: pendingGuestRequestCount })}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t("pendingGuestRequestsDescription")}
              </p>
            </div>
            <span className="flex items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-status-waiting">
                {t("pendingGuestRequestCount", { count: pendingGuestRequestCount })}
              </span>
              <Icon name="arrow-right" size={18} />
            </span>
          </TransitionLink>
        )}

        {accessibleMenus.length > 0 && (
          <nav
            aria-label={t("availableWorkspaces")}
            className={`mx-auto w-full ${workspaceWidthClass}`}
          >
            <div
              className={`grid border-l border-t border-border-default ${workspaceGridClass}`}
            >
              {accessibleMenus.map((item, index) => (
                <WorkspaceLink key={item.id} item={item} index={index} />
              ))}
            </div>
          </nav>
        )}
      </main>

      <Footer />
    </div>
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
      className="pressable group relative flex min-h-[210px] flex-col border-b border-r border-border-default bg-surface hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-action-primary before:opacity-0 before:transition-opacity hover:before:opacity-100 focus-visible:before:opacity-100 sm:min-h-[230px]"
    >
      <div className="flex w-full flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid h-11 w-11 place-items-center border border-border-default bg-canvas text-text-muted transition-colors group-hover:border-border-strong group-hover:text-text-heading">
            <Icon name={item.icon} size={22} />
          </div>
          <span className="font-mono text-xs font-semibold tabular-nums text-text-dim group-hover:text-text-muted">
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>

        <div className="mt-5 min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-[-0.015em] text-text-heading group-hover:text-action-primary">
            {item.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            {item.description}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end">
          <span className="flex items-center gap-2 text-text-dim transition-colors group-hover:text-text-heading">
            <kbd className="border border-border-default bg-canvas px-2 py-0.5 font-mono text-xs text-text-dim group-hover:border-border-strong">
              {index + 1}
            </kbd>
            <Icon name="arrow-right" size={18} />
          </span>
        </div>
      </div>
    </TransitionLink>
  );
}
