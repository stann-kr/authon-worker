"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { logout, hasAccess } from "../lib/auth";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";
import RoleLabel from "@/components/RoleLabel";
import Icon, { type IconName } from "@/components/Icon";
import TransitionLink from "@/components/TransitionLink";
import { useRouteTransition } from "@/components/RouteTransitionProvider";
import WorkspaceShell from "@/components/WorkspaceShell";
import { useVenueBrand } from "@/components/VenueBrandProvider";
import { getWorkspaceItems } from "@/components/workspace/navigation";
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
  const workspaceT = useTranslations("Workspace");
  const { user } = useAuthSession();
  const { brand } = useVenueBrand();
  const router = useRouter();
  const { isRouteTransitionActive, startRouteTransition } =
    useRouteTransition();
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
  ], [t]);

  useEffect(() => {
    if (user) return;
    let active = true;
    void logout().then((result) => {
      // A pending logout still has a server credential; hydrate that identity again.
      if (!result.success && active) router.refresh();
    });
    return () => { active = false; };
  }, [router, user]);

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

  const primaryId = hasAccess(user, ["door"]) ? "door" : "guest";
  const primary = accessibleMenus.find((item) => item.id === primaryId) ?? accessibleMenus[0];
  const quickLinks = getWorkspaceItems({
    role: user.role, accountKind: user.account_kind, doorAccessEnabled: user.door_access_enabled,
  }).filter((item) => ["events", "links", "users", "analytics"].includes(item.id));
  const quickIcons: Record<string, IconName> = { events: "calendar", links: "link", users: "users", analytics: "chart-line" };

  return (
    <WorkspaceShell contentClassName="home-page">
      <div className="home-overview">
        <header className="home-heading">
          <div><p className="home-brand">{brand.name}</p><h1>{t("homeTitle")}</h1></div>
          <TransitionLink href="/profile" className="home-identity">
            <div><strong>{user.name}</strong><span><RoleLabel role={user.account_kind === "shared" ? "shared" : user.role} /></span></div>
            <Icon name="chevron-right" size={18} />
          </TransitionLink>
        </header>

        <div className="home-workbench">
          <nav aria-label={t("availableWorkspaces")} className="home-tasks">
            {primary && <WorkspaceLink item={primary} index={accessibleMenus.indexOf(primary)} primary />}
            <div className="home-secondary-tasks">
              {accessibleMenus.filter((item) => item !== primary).map((item) => (
                <WorkspaceLink key={item.id} item={item} index={accessibleMenus.indexOf(item)} />
              ))}
            </div>
          </nav>

          <section className="home-account-panel" aria-labelledby="home-account-title">
            <h2 id="home-account-title">{t("registrationInfo")}</h2>
            <dl>
              <div><dt>{t("defaultGuestLimit")}</dt><dd>{user.guest_limit === null ? t("unlimited") : t("guestLimitCount", { count: user.guest_limit })}</dd></div>
              <div><dt>{t("doorAccess")}</dt><dd>{hasAccess(user, ["door"]) ? t("allowed") : t("notAllowed")}</dd></div>
            </dl>
            <TransitionLink href="/profile" className="home-account-link">{workspaceT("profile")}<Icon name="arrow-right" size={18} /></TransitionLink>
          </section>
        </div>

        {quickLinks.length > 0 && <nav className="home-shortcuts" aria-label={t("quickLinks")}>
          <h2>{t("quickLinks")}</h2>
          <div>{quickLinks.map((item) => <TransitionLink key={item.id} href={item.href} className="home-shortcut pressable">
            <Icon name={quickIcons[item.id]} size={20} /><span>{workspaceT(item.label)}</span><Icon name="chevron-right" size={16} />
          </TransitionLink>)}</div>
        </nav>}
      </div>
    </WorkspaceShell>
  );
}

function WorkspaceLink({
  item,
  index,
  primary = false,
}: {
  item: MenuItem;
  index: number;
  primary?: boolean;
}) {
  return (
    <TransitionLink
      href={item.href}
      aria-keyshortcuts={String(index + 1)}
      className={`${primary ? "home-primary-task" : "home-secondary-task"} pressable`}
    >
      {primary ? <>
        <div className="home-primary-label"><span><Icon name={item.icon} size={22} />{item.category}</span><kbd aria-hidden="true">{index + 1}</kbd></div>
        <div className="home-primary-copy"><h2>{item.title}</h2><p>{item.description}</p></div>
        <span className="home-primary-action">{item.action}<Icon name="arrow-right" size={18} /></span>
      </> : <>
        <Icon name={item.icon} size={22} />
        <div className="home-secondary-copy"><h2>{item.title}</h2><p>{item.description}</p></div>
        <kbd aria-hidden="true">{index + 1}</kbd><Icon name="chevron-right" size={16} />
      </>}
    </TransitionLink>
  );
}
