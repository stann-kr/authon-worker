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
  title: string;
  description: string;
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
      title: t("guestTitle"),
      description: t("guestDescription"),
      icon: "user-add",
      href: "/guest",
      requiredAccess: ["guest"],
    },
    {
      id: "door",
      title: t("doorTitle"),
      description: t("doorDescription"),
      icon: "login",
      href: "/door",
      requiredAccess: ["door"],
    },
    {
      id: "admin",
      title: t("adminTitle"),
      description: t("adminDescription"),
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
      } finally {
        if (isLatestRequest()) setIsLoading(false);
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

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <AdminHeader />

      <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col justify-center px-4 pb-8 pt-20 sm:px-6 sm:pt-24 lg:px-10">
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
            className="mx-auto w-full border-y border-border-default"
          >
            {accessibleMenus.map((item, index) => (
              <WorkspaceLink key={item.id} item={item} index={index} />
            ))}
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
      className="pressable group relative grid min-h-[88px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border-subtle px-4 py-4 last:border-b-0 hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none sm:min-h-[104px] sm:gap-5 sm:px-5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-action-primary before:opacity-0 before:transition-opacity hover:before:opacity-100 focus-visible:before:opacity-100"
    >
      <Icon name={item.icon} size={22} className="text-text-muted group-hover:text-text-heading" />

      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-[-0.015em] text-text-heading sm:text-lg">
          {item.title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">
          {item.description}
        </p>
      </div>

      <span className="flex items-center gap-3 text-text-muted group-hover:text-text-heading">
        <kbd className="hidden border border-border-default bg-canvas px-2 py-1 font-mono text-xs text-text-dim sm:inline-block">
          {index + 1}
        </kbd>
        <Icon name="arrow-right" size={18} />
      </span>
    </TransitionLink>
  );
}
