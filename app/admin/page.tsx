"use client";

import WorkspaceAction from "@/components/workspace/WorkspaceAction";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { isBusinessDate } from "@/lib/events/domain";
import type { LinkManagementSection } from "./components/LinkManagement";
import type { UserManagementSection } from "./components/UserManagement";
import type { VenueManagementSection } from "./components/VenueManagement";
import Skeleton from "@/components/Skeleton";
import EventScopeSelector from "@/components/EventScopeSelector";
import OperationsScope from "@/components/operations/OperationsScope";
import type { AdminTaskOption } from "./components/AdminTaskSwitcher";
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
import { fetchPendingPasswordResetRequestCount } from "@/lib/api/password-reset-requests";
import useAdminWorkspaceNavigation, {
  focusAdminWorkspaceAfterTaskChange,
} from "./useAdminWorkspaceNavigation";

function AdminTaskLoading() {
  return <div className="app-panel"><Skeleton rows={5} /></div>;
}

const LinkManagement = dynamic(() => import("./components/LinkManagement"), {
  loading: AdminTaskLoading,
});
const UserManagement = dynamic(() => import("./components/UserManagement"), {
  loading: AdminTaskLoading,
});
const VenueManagement = dynamic(() => import("./components/VenueManagement"), {
  loading: AdminTaskLoading,
});
const GuestLimitRequestManagement = dynamic(() => import("./components/GuestLimitRequestManagement"), {
  loading: AdminTaskLoading,
});
const PasswordResetRequestManagement = dynamic(() => import("./components/PasswordResetRequestManagement"), {
  loading: AdminTaskLoading,
});
const EventManagement = dynamic(() => import("./components/EventManagement"), {
  loading: AdminTaskLoading,
});
const AdminAnalytics = dynamic(() => import("./components/AdminAnalytics"), {
  loading: AdminTaskLoading,
});

export default function AdminPage() {
  return (
    <AuthGuard requiredAccess={["admin"]}>
      <AdminPageContent />
    </AuthGuard>
  );
}

function AdminPageContent() {
  const router = useRouter();
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
    workspaceFocusRequestId,
  } = useAdminWorkspaceNavigation({
    businessDate,
    hasCurrentVenue: Boolean(currentVenue),
    isRouteTransitionActive,
    isSuperAdmin,
    venueId,
  });
  useEffect(() => {
    if (!isRoleReady || activeTask !== "guest-list" || !currentVenue) return;
    const requested = new URLSearchParams(window.location.search);
    const requestedDate = requested.get("date");
    const hasRequestedScope = requested.get("venue") === venueId && isBusinessDate(requestedDate);
    const target = new URLSearchParams({
      venue: venueId,
      date: hasRequestedScope ? requestedDate! : selectedDate,
    });
    const eventId = hasRequestedScope ? requested.get("eventId") : selectedEventId;
    if (eventId) target.set("eventId", eventId);
    router.replace(`/door?${target}`);
  }, [activeTask, currentVenue, isRoleReady, router, selectedDate, selectedEventId, venueId]);

  const [pendingPasswordResetCount, setPendingPasswordResetCount] = useState(0);
  const workspaceRef = useRef<HTMLElement>(null);
  useRouteLoadingTask(!isRoleReady);

  useLayoutEffect(() => {
    if (workspaceFocusRequestId === 0) return;
    focusAdminWorkspaceAfterTaskChange(workspaceRef.current);
  }, [workspaceFocusRequestId]);

  useEffect(() => {
    if (!isRoleReady || activeTask === "guest-list") return;
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
  }, [activeTask, isRoleReady]);

  const taskOptions = useMemo<AdminTaskOption[]>(
    () =>
      [
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
  const activeGroup = taskOptions.find((option) => option.id === activeTask)?.group;
  const contextTasks = ["links", "users", "venues"].includes(activeGroup ?? "")
    ? taskOptions.filter((option) => option.group === activeGroup && option.id !== "password-requests")
    : [];

  const eventScopeSelector = (controls: ReactNode, disabled = false) => <EventScopeSelector venueId={venueId} businessDate={selectedDate}
    value={selectedEventId} onChange={setSelectedEventId} reloadKey={eventRefreshKey} disabled={disabled}
    renderScope={(selector, label) => <OperationsScope venueName={currentVenue?.brandName || currentVenue?.name}
      date={selectedDate} label={label} disabled={disabled}>{controls}{selector}</OperationsScope>} />;

  return (
    <WorkspaceShell contentClassName="gap-4 pb-8" title={activeTaskLabel}
      adminNavigation={{ activeTask, onTaskChange: changeTask,
        disabled: !isRoleReady, pendingPasswordResetCount }}
      actions={contextTasks.length > 0 && activeTask !== "password-requests" ? contextTasks.map((task) => (
        <WorkspaceAction key={task.id} icon={task.id.endsWith("create") ? "add" : "view"} tone={task.id.endsWith("create") ? "accent" : "muted"}
          aria-pressed={activeTask === task.id} disabled={!isRoleReady || isRouteTransitionActive}
          onClick={() => changeTask(task.id)}>{task.label}</WorkspaceAction>
      )) : undefined}>
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
      {venueLoadError && activeTask !== "venue-list" && (
        <VenueLoadNotice
          onRetry={refreshVenues}
          isLoading={isLoadingVenues}
        />
      )}

        <section
          ref={workspaceRef}
          id="admin-workspace"
          aria-labelledby="admin-active-task-title"
          tabIndex={-1}
          className="min-h-0 outline-none"
        >
        <h2 id="admin-active-task-title" className="sr-only">
          {activeTaskLabel}
        </h2>
        {(!isRoleReady || activeTask === "guest-list") && <AdminTaskLoading />}
        {isRoleReady && <>
        {activeTask === "guest-requests" && (
          <GuestLimitRequestManagement
            scopeSelector={eventScopeSelector}
            eventId={selectedEventId}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            businessDate={businessDate}
          />
        )}
        {activeTask === "event-manage" && (
          <EventManagement scopeSelector={eventScopeSelector}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            businessDate={businessDate}
            selectedEventId={selectedEventId}
            onSelectedEventChange={setSelectedEventId}
            onEventsChanged={() => setEventRefreshKey((value) => value + 1)}
          />
        )}
        {(activeTask === "link-create" || activeTask === "link-manage") && (
          <LinkManagement scopeSelector={eventScopeSelector}
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
        </>}
        </section>
    </WorkspaceShell>
  );
}
