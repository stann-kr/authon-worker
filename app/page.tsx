"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, logout, hasAccess, type User } from "../lib/auth";
import Footer from "@/components/Footer";
import Spinner from "@/components/Spinner";
import Icon, { type IconName } from "@/components/Icon";
import TransitionLink from "@/components/TransitionLink";
import AdminHeader from "@/app/admin/components/AdminHeader";
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
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
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
    const currentUser = getUser();
    if (!currentUser) {
      logout();
      return;
    }

    setUser(currentUser);
    setIsLoading(false);
  }, []);

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
        router.push(accessibleMenus[keyIndex].href);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [accessibleMenus, router, user]);

  if (isLoading) {
    return <Spinner mode="fullscreen" text={t("loading")} />;
  }

  if (!user) return null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <AdminHeader />

      <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col justify-center px-4 pb-8 pt-20 sm:px-6 sm:pt-24 lg:px-10">
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
