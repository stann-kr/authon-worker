"use client";

import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth";
import Icon from "@/components/Icon";
import TransitionLink from "@/components/TransitionLink";
import { useVenueBrand } from "@/components/VenueBrandProvider";
import { useTranslations } from "next-intl";

export default function AdminHeader() {
  const t = useTranslations("Common");
  const pathname = usePathname();
  const contextLabels: Record<string, string> = {
    "/admin": t("admin"),
    "/door": t("door"),
    "/guest": t("guest"),
    "/profile": t("profile"),
  };
  const contextLabel = contextLabels[pathname];
  const { brand } = useVenueBrand();

  return (
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
            type="button"
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
  );
}
