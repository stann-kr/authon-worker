"use client";

import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth";
import Icon from "@/components/Icon";
import AppHeader from "@/components/AppHeader";
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
    <AppHeader
      brandName={brand.name}
      homeHref="/"
      homeLabel={t("brandHome", { brand: brand.name })}
      contextLabel={contextLabel}
      actions={
        <>
          {pathname !== "/profile" && (
            <TransitionLink
              href="/profile"
              className="pressable flex h-10 w-10 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
              aria-label={t("profileSettings")}
              title={t("profileSettings")}
            >
              <Icon name="user-admin" size={18} />
            </TransitionLink>
          )}
          <button
            onClick={logout}
            className="pressable flex h-10 w-10 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
            aria-label={t("logout")}
            title={t("logout")}
          >
            <Icon name="logout" size={18} />
          </button>
        </>
      }
    />
  );
}
