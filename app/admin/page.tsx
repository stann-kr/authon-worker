"use client";

import { useState, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocalStorage } from "../../lib/hooks";
import AdminHeader from "./components/AdminHeader";
import GuestList from "./components/GuestList";
import LinkManagement from "./components/LinkManagement";
import UserManagement from "./components/UserManagement";
import VenueManagement from "./components/VenueManagement";
import AuthGuard from "../../components/AuthGuard";
import Footer from "../../components/Footer";
import { getBusinessDate } from "../../lib/date";
import { getUser } from "../../lib/auth";
import Icon, { type IconName } from "../../components/Icon";
import { useTranslations } from "next-intl";

export default function AdminPage() {
  return (
    <AuthGuard requiredAccess={["admin"]}>
      <AdminPageContent />
    </AuthGuard>
  );
}

function AdminPageContent() {
  const t = useTranslations("AdminNav");
  const router = useRouter();
  const [activeTab, setActiveTab] = useLocalStorage(
    "admin:activeTab",
    "guests",
  );
  const [selectedDate, setSelectedDate] = useLocalStorage(
    "admin:selectedDate",
    getBusinessDate(),
  );
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isRoleReady, setIsRoleReady] = useState(false);

  useEffect(() => {
    const user = getUser();
    setIsSuperAdmin(user?.role === "super_admin");
    setIsRoleReady(true);
  }, []);

  const tabs = useMemo(
    () => [
      { id: "guests", label: t("guests"), icon: "users" as IconName, shortcut: "1" },
      { id: "links", label: t("links"), icon: "link" as IconName, shortcut: "2" },
      { id: "users", label: t("users"), icon: "user-admin" as IconName, shortcut: "3" },
      ...(isSuperAdmin
        ? [{ id: "venues", label: t("venues"), icon: "store" as IconName, shortcut: "4" }]
        : []),
    ],
    [isSuperAdmin, t],
  );

  useEffect(() => {
    if (isRoleReady && !tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("guests");
    }
  }, [activeTab, isRoleReady, setActiveTab, tabs]);

  // Keyboard shortcut listener for tab switching & home return
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Escape") {
        router.push("/");
      } else if (e.key === "1" && tabs[0]) {
        setActiveTab(tabs[0].id);
      } else if (e.key === "2" && tabs[1]) {
        setActiveTab(tabs[1].id);
      } else if (e.key === "3" && tabs[2]) {
        setActiveTab(tabs[2].id);
      } else if (e.key === "4" && tabs[3]) {
        setActiveTab(tabs[3].id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tabs, setActiveTab, router]);

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (tabIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`tab-${nextTab.id}`)?.focus();
  };

  return (
    <div className="min-h-[100dvh] bg-canvas flex flex-col">
      <AdminHeader />
      <div className="flex flex-1 flex-col overflow-x-hidden pt-20 sm:pt-24">
        <div className="page-container">
          {/* Tab Bar */}
          <div className="mb-4 lg:mb-6 flex-shrink-0">
            <div
              role="tablist"
              aria-label={t("sections")}
              aria-orientation="horizontal"
              className={`grid ${tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"} divide-x divide-border-subtle border border-border-subtle bg-surface`}
            >
              {tabs.map((tab, tabIndex) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-selected={isActive}
                    aria-controls={`panel-${tab.id}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, tabIndex)}
                    className={`relative z-10 min-h-14 p-3 text-sm font-medium after:absolute after:inset-x-0 after:-bottom-px after:h-px after:content-[''] focus-visible:outline-none sm:p-4 ${
                      isActive
                        ? "bg-surface-raised font-semibold text-text-heading after:bg-action-primary"
                        : "bg-surface text-text-muted after:bg-transparent hover:bg-surface-raised hover:text-text-heading"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Icon name={tab.icon} size={18} />
                      <span className="text-xs sm:text-sm">{tab.label}</span>
                      <span className="ml-1 hidden border border-border-default px-1 py-0.5 font-mono text-xs text-text-dim lg:inline-block">
                        [{tab.shortcut}]
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Tab Panel */}
          <div
            role="tabpanel"
            id={`panel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            className="flex min-h-0 flex-col"
          >
            {activeTab === "guests" && (
              <GuestList
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
              />
            )}
            {activeTab === "links" && (
              <LinkManagement
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
              />
            )}
            {activeTab === "users" && <UserManagement />}
            {activeTab === "venues" && <VenueManagement />}
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}
