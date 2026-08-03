"use client";

import { useState, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocalStorage } from "../../lib/hooks";
import AdminHeader from "./components/AdminHeader";
import GuestList from "./components/GuestList";
import LinkManagement from "./components/LinkManagement";
import UserManagement from "./components/UserManagement";
import VenueManagement from "./components/VenueManagement";
import GuestLimitRequestManagement from "./components/GuestLimitRequestManagement";
import AuthGuard from "../../components/AuthGuard";
import Footer from "../../components/Footer";
import { getBusinessDate } from "../../lib/date";
import { getUser } from "../../lib/auth";
import Icon, { type IconName } from "../../components/Icon";
import { useTranslations } from "next-intl";
import { useVenueSelector } from "../../components/VenueSelector";

type AdminTab = "guests" | "links" | "users" | "venues";
type GuestAdminTab = "list" | "requests";

interface AdminTabDefinition {
  id: AdminTab;
  label: string;
  icon: IconName;
  shortcut: string;
}

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
  const { currentVenue } = useVenueSelector();
  const businessDate = getBusinessDate(currentVenue ?? {});
  const [activeTab, setActiveTab] = useLocalStorage<AdminTab>(
    "admin:activeTab",
    "guests",
  );
  const [selectedDate, setSelectedDate] = useLocalStorage(
    "admin:selectedDate",
    getBusinessDate(),
  );
  const [activeGuestTab, setActiveGuestTab] = useLocalStorage<GuestAdminTab>(
    "admin:guestTab",
    "list",
  );
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isRoleReady, setIsRoleReady] = useState(false);

  useEffect(() => {
    if (currentVenue) setSelectedDate(businessDate);
  }, [businessDate, currentVenue, setSelectedDate]);

  useEffect(() => {
    const user = getUser();
    setIsSuperAdmin(user?.role === "super_admin");
    setIsRoleReady(true);
  }, []);

  const tabs = useMemo<AdminTabDefinition[]>(
    () => [
      { id: "guests", label: t("guests"), icon: "users" as IconName, shortcut: "1" },
      { id: "links", label: t("links"), icon: "link" as IconName, shortcut: "2" },
      { id: "users", label: t("users"), icon: "user-admin" as IconName, shortcut: "3" },
      ...(isSuperAdmin
        ? [{ id: "venues" as const, label: t("venues"), icon: "store" as IconName, shortcut: "4" }]
        : []),
    ],
    [isSuperAdmin, t],
  );

  useEffect(() => {
    if (isRoleReady && !tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("guests");
    }
  }, [activeTab, isRoleReady, setActiveTab, tabs]);

  useEffect(() => {
    if (!isRoleReady) return;
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    const requestedGuestTab = new URLSearchParams(window.location.search).get("view");
    if (requestedTab === "requests") {
      setActiveTab("guests");
      setActiveGuestTab("requests");
      return;
    }
    const matchingTab = tabs.find((tab) => tab.id === requestedTab);
    if (matchingTab) setActiveTab(matchingTab.id);
    if (
      requestedTab === "guests" &&
      (requestedGuestTab === "list" || requestedGuestTab === "requests")
    ) {
      setActiveGuestTab(requestedGuestTab);
    }
  }, [isRoleReady, setActiveGuestTab, setActiveTab, tabs]);

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
      } else {
        const shortcutIndex = Number.parseInt(e.key, 10) - 1;
        if (!Number.isNaN(shortcutIndex) && tabs[shortcutIndex]) {
          setActiveTab(tabs[shortcutIndex].id);
        }
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
              <>
                <div
                  role="tablist"
                  aria-label={t("guestSections")}
                  className="mb-4 grid grid-cols-2 divide-x divide-border-subtle border border-border-subtle bg-surface"
                >
                  {(["list", "requests"] as const).map((guestTab) => {
                    const isActive = activeGuestTab === guestTab;
                    return (
                      <button
                        key={guestTab}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActiveGuestTab(guestTab)}
                        className={`min-h-11 px-4 py-2 text-sm font-medium focus-visible:outline-none ${
                          isActive
                            ? "bg-surface-raised text-text-heading"
                            : "text-text-muted hover:bg-surface-raised hover:text-text-heading"
                        }`}
                      >
                        {guestTab === "list" ? t("guestList") : t("requests")}
                      </button>
                    );
                  })}
                </div>
                {activeGuestTab === "list" ? (
                  <GuestList
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    businessDate={businessDate}
                  />
                ) : (
                  <GuestLimitRequestManagement />
                )}
              </>
            )}
            {activeTab === "links" && (
              <LinkManagement
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
                businessDate={businessDate}
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
