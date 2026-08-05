"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { getUser, hasAccess, logout, type User } from "@/lib/auth";
import Icon, { type IconName } from "@/components/Icon";
import TransitionLink from "@/components/TransitionLink";
import { useVenueBrand } from "@/components/VenueBrandProvider";
import type { AccessScope } from "@/lib/users/policy";
import { useTranslations } from "next-intl";

interface WorkspaceItem {
  href: "/guest" | "/door" | "/admin";
  label: string;
  icon: IconName;
  requiredAccess: AccessScope[];
}

export default function AdminHeader() {
  const t = useTranslations("Common");
  const homeT = useTranslations("Home");
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const contextLabels: Record<string, string> = {
    "/admin": t("admin"),
    "/door": t("door"),
    "/guest": t("guest"),
    "/profile": t("profile"),
  };
  const contextLabel = contextLabels[pathname];
  const { brand } = useVenueBrand();
  const workspaceItems = useMemo<WorkspaceItem[]>(
    () => [
      {
        href: "/guest",
        label: t("guest"),
        icon: "user-add",
        requiredAccess: ["guest"],
      },
      {
        href: "/door",
        label: t("door"),
        icon: "login",
        requiredAccess: ["door"],
      },
      {
        href: "/admin",
        label: t("admin"),
        icon: "settings",
        requiredAccess: ["admin"],
      },
    ],
    [t],
  );
  const accessibleWorkspaces = user
    ? workspaceItems.filter((item) => hasAccess(user, item.requiredAccess))
    : [];

  useEffect(() => {
    setUser(getUser());
  }, []);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[var(--app-z-chrome)] border-b border-border-default bg-canvas pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <TransitionLink
            href="/"
            className="pressable flex min-h-11 min-w-0 items-center gap-3 rounded-control"
            aria-label={t("brandHome", { brand: brand.name })}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
              {brand.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-text-heading">
                {brand.name}
              </span>
              {contextLabel && (
                <span className="block truncate text-xs text-text-muted">
                  {contextLabel}
                </span>
              )}
            </span>
          </TransitionLink>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {pathname !== "/profile" && (
              <TransitionLink
                href="/profile"
                className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
                aria-label={t("profileSettings")}
                title={t("profileSettings")}
              >
                <Icon name="user-admin" size={18} />
              </TransitionLink>
            )}
            <button
              onClick={logout}
              className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
              aria-label={t("logout")}
              title={t("logout")}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </header>

      {accessibleWorkspaces.length > 0 && (
        <nav
          aria-label={homeT("availableWorkspaces")}
          className="fixed inset-x-0 bottom-0 z-[var(--app-z-chrome)] border-t border-border-strong bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <div
            className="mx-auto grid w-full max-w-xl divide-x divide-border-subtle"
            style={{
              gridTemplateColumns: `repeat(${accessibleWorkspaces.length + 1}, minmax(0, 1fr))`,
            }}
          >
            <MobileWorkspaceLink
              href="/"
              label={t("home")}
              icon="home"
              isActive={pathname === "/"}
            />
            {accessibleWorkspaces.map((item) => (
              <MobileWorkspaceLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                isActive={pathname === item.href}
              />
            ))}
          </div>
        </nav>
      )}
    </>
  );
}

function MobileWorkspaceLink({
  href,
  label,
  icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: IconName;
  isActive: boolean;
}) {
  return (
    <TransitionLink
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`pressable flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.6875rem] ${
        isActive
          ? "bg-surface-raised font-semibold text-text-heading"
          : "text-text-muted"
      }`}
    >
      <Icon name={icon} size={19} />
      <span className="max-w-full truncate">{label}</span>
    </TransitionLink>
  );
}
