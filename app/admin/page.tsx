"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import GuestList from "./components/GuestList";
import LinkManagement, {
  type LinkManagementSection,
} from "./components/LinkManagement";
import UserManagement, {
  type UserManagementSection,
} from "./components/UserManagement";
import VenueManagement, {
  type VenueManagementSection,
} from "./components/VenueManagement";
import GuestLimitRequestManagement from "./components/GuestLimitRequestManagement";
import PasswordResetRequestManagement from "./components/PasswordResetRequestManagement";
import EventManagement from "./components/EventManagement";
import EventScopeSelector from "@/components/EventScopeSelector";
import AdminTaskSwitcher, {
  type AdminTaskOption,
} from "./components/AdminTaskSwitcher";
import AuthGuard from "../../components/AuthGuard";
import WorkspaceShell from "../../components/WorkspaceShell";
import VenueLoadNotice from "../../components/VenueLoadNotice";
import { getBusinessDate } from "../../lib/date";
import { useTranslations } from "next-intl";
import { useAuthSession } from "../../components/AuthSessionProvider";
import { useVenueSelector } from "../../components/VenueSelector";
import {
  useRouteLoadingTask,
  useRouteTransition,
} from "../../components/RouteTransitionProvider";
import { type AdminTaskGroup } from "../../lib/admin-navigation";
import { fetchPendingPasswordResetRequestCount } from "@/lib/api/password-reset-requests";
import useAdminWorkspaceNavigation from "./useAdminWorkspaceNavigation";

const AdminAnalytics = dynamic(() => import("./components/AdminAnalytics"));

export default function AdminPage() {
  return (
    <AuthGuard requiredAccess={["admin"]}>
      <AdminPageContent />
    </AuthGuard>
  );
}

function AdminPageContent() {
  const t = useTranslations("AdminNav");
  const linkT = useTranslations("LinkAdmin");
  const userT = useTranslations("UserAdmin");
  const venueT = useTranslations("VenueAdmin");
  const { user } = useAuthSession();
  const { isRouteTransitionActive } = useRouteTransition();
  const {
    currentVenue,
    venueId,
    isLoadingVenues,
    venueLoadError,
    refreshVenues,
  } = useVenueSelector();
  const businessDate = getBusinessDate(currentVenue ?? {});
  const [eventRefreshKey, setEventRefreshKey] = useState(0);
  const isSuperAdmin = user?.role === "super_admin";
  const {
    activeTask,
    changeTask,
    isRoleReady,
    onAnalyticsEventOpen,
    selectedDate,
    selectedEventId,
    setSelectedDate,
    setSelectedEventId,
  } = useAdminWorkspaceNavigation({
    businessDate,
    hasCurrentVenue: Boolean(currentVenue),
    isRouteTransitionActive,
    isSuperAdmin,
    venueId,
  });
  const [pendingPasswordResetCount, setPendingPasswordResetCount] = useState(0);
  useRouteLoadingTask(!isRoleReady);

  useEffect(() => {
    if (!isRoleReady) return;
    let cancelled = false;
    const loadPendingPasswordResetCount = async () => {
      const { data, error } = await fetchPendingPasswordResetRequestCount();
      if (cancelled) return;
      if (error) {
        console.error("Failed to load pending password reset count:", error);
        return;
      }
      setPendingPasswordResetCount(data ?? 0);
    };
    void loadPendingPasswordResetCount();
    return () => {
      cancelled = true;
    };
  }, [isRoleReady]);

  const taskOptions = useMemo<AdminTaskOption[]>(
    () =>
      [
        { id: "guest-list", group: "guests", label: t("guestList") },
        { id: "guest-requests", group: "guests", label: t("requests") },
        { id: "event-manage", group: "events", label: t("eventManagement") },
        { id: "link-create", group: "links", label: linkT("createLink") },
        { id: "link-manage", group: "links", label: linkT("manageLinks") },
        { id: "user-create", group: "users", label: userT("createUser") },
        { id: "user-list", group: "users", label: userT("users") },
        {
          id: "password-requests",
          group: "users",
          label: t("passwordRequests"),
          badgeCount: pendingPasswordResetCount,
        },
        { id: "analytics", group: "analytics", label: t("guestAnalytics") },
        ...(isSuperAdmin
          ? [
              {
                id: "venue-list" as const,
                group: "venues" as const,
                label: venueT("venues"),
              },
              {
                id: "venue-create" as const,
                group: "venues" as const,
                label: venueT("createVenue"),
              },
            ]
          : []),
      ],
    [isSuperAdmin, linkT, pendingPasswordResetCount, t, userT, venueT],
  );


  const groupLabels: Record<AdminTaskGroup, string> = {
    guests: t("guests"),
    events: t("events"),
    links: t("links"),
    users: t("users"),
    analytics: t("analytics"),
    venues: t("venues"),
  };

  const handleLinkSectionChange = useCallback(
    (section: LinkManagementSection) =>
      changeTask(section === "create" ? "link-create" : "link-manage"),
    [changeTask],
  );
  const handleUserSectionChange = useCallback(
    (section: UserManagementSection) =>
      changeTask(section === "create" ? "user-create" : "user-list"),
    [changeTask],
  );
  const handleVenueSectionChange = useCallback(
    (section: VenueManagementSection) =>
      changeTask(section === "create" ? "venue-create" : "venue-list"),
    [changeTask],
  );
  const activeTaskLabel =
    taskOptions.find((option) => option.id === activeTask)?.label ?? t("title");

  return (
    <WorkspaceShell contentClassName="gap-4 pb-8">
      <h1 id="admin-page-title" className="sr-only">
        {t("title")}
      </h1>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {t("activeTaskAnnouncement", { task: activeTaskLabel })}
      </p>
      {venueLoadError && (
        <VenueLoadNotice
          onRetry={refreshVenues}
          isLoading={isLoadingVenues}
        />
      )}

      <div className="grid min-h-0 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside className="lg:sticky lg:top-[calc(var(--app-header-height)+2rem)] lg:self-start">
          <AdminTaskSwitcher
            label={t("sections")}
            groupLabels={groupLabels}
            options={taskOptions}
            value={activeTask}
            onChange={changeTask}
            disabled={!isRoleReady || isRouteTransitionActive}
          />
        </aside>

        <section
          id="admin-workspace"
          aria-labelledby="admin-active-task-title"
          className="min-h-0"
        >
        <h2 id="admin-active-task-title" className="sr-only">
          {activeTaskLabel}
        </h2>
        {[
          "guest-list",
          "guest-requests",
          "event-manage",
          "link-create",
          "link-manage",
        ].includes(activeTask) && (
          <div className="context-bar mb-4">
            <EventScopeSelector
              venueId={venueId}
              businessDate={selectedDate}
              value={selectedEventId}
              onChange={setSelectedEventId}
              reloadKey={eventRefreshKey}
            />
          </div>
        )}
        {activeTask === "guest-list" && (
          <GuestList
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            businessDate={businessDate}
            eventId={selectedEventId}
          />
        )}
        {activeTask === "guest-requests" && (
          <GuestLimitRequestManagement
            eventId={selectedEventId}
            businessDate={selectedDate}
          />
        )}
        {activeTask === "event-manage" && (
          <EventManagement
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            businessDate={businessDate}
            selectedEventId={selectedEventId}
            onSelectedEventChange={setSelectedEventId}
            onEventsChanged={() => setEventRefreshKey((value) => value + 1)}
          />
        )}
        {(activeTask === "link-create" || activeTask === "link-manage") && (
          <LinkManagement
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            businessDate={businessDate}
            activeSection={
              activeTask === "link-create" ? "create" : "manage"
            }
            onActiveSectionChange={handleLinkSectionChange}
            showSectionNavigation={false}
            eventId={selectedEventId}
          />
        )}
        {(activeTask === "user-create" || activeTask === "user-list") && (
          <UserManagement
            activeSection={
              activeTask === "user-create" ? "create" : "users"
            }
            onActiveSectionChange={handleUserSectionChange}
            showSectionNavigation={false}
          />
        )}
        {activeTask === "password-requests" && (
          <PasswordResetRequestManagement
            onPendingCountChange={setPendingPasswordResetCount}
          />
        )}
        {activeTask === "analytics" && (
          <AdminAnalytics onOpenEvent={onAnalyticsEventOpen} />
        )}
        {(activeTask === "venue-list" || activeTask === "venue-create") && (
          <VenueManagement
            activeSection={activeTask === "venue-create" ? "create" : "list"}
            onActiveSectionChange={handleVenueSectionChange}
            showSectionNavigation={false}
          />
        )}
        </section>
      </div>
    </WorkspaceShell>
  );
}
