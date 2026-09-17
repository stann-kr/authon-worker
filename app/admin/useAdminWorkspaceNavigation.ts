"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "../../lib/hooks";
import { isBusinessDate } from "../../lib/events/domain";
import {
  getAdminShortcutTask,
  getAdminTaskSearch,
  isAdminTaskAvailable,
  parseAdminTask,
  type AdminTask,
} from "../../lib/admin-navigation";

type EventScope = {
  eventId: string;
  businessDate: string;
  venueId: string;
};

type SavedOperatingDate = { venueId: string; date: string };

type AdminWorkspaceNavigationOptions = {
  businessDate: string;
  hasCurrentVenue: boolean;
  isRouteTransitionActive: boolean;
  isSuperAdmin: boolean;
  venueId: string;
};

/** Returns an event scope only when it belongs to the active venue and date. */
export function getAdminEventScope(
  search: Pick<URLSearchParams, "get">,
  venueId: string,
): EventScope | null {
  const eventId = search.get("eventId");
  const businessDate = search.get("date");
  const requestedVenueId = search.get("venue");

  if (
    !eventId ||
    requestedVenueId !== venueId ||
    !businessDate ||
    !isBusinessDate(businessDate)
  ) {
    return null;
  }

  return { eventId, businessDate, venueId };
}

function getCanonicalEventSearch(scope: EventScope): string {
  const search = new URLSearchParams(getAdminTaskSearch("event-manage"));
  search.set("venue", scope.venueId);
  search.set("eventId", scope.eventId);
  search.set("date", scope.businessDate);
  return `?${search.toString()}`;
}

export function focusAdminWorkspaceAfterTaskChange(
  workspace: HTMLElement | null,
): boolean {
  const activeElement = document.activeElement;
  if (
    (activeElement &&
      activeElement !== document.body &&
      activeElement.isConnected) ||
    !workspace?.isConnected ||
    workspace.closest("[inert]")
  ) {
    return false;
  }
  workspace.focus({ preventScroll: true });
  workspace.scrollIntoView({ block: "start" });
  return true;
}

export default function useAdminWorkspaceNavigation({
  businessDate,
  hasCurrentVenue,
  isRouteTransitionActive,
  isSuperAdmin,
  venueId,
}: AdminWorkspaceNavigationOptions) {
  const [savedDate, setSavedDate] = useLocalStorage<SavedOperatingDate | string | null>(
    "admin:selectedDate",
    null,
  );
  const selectedDate = isBusinessDate(savedDate)
    ? savedDate
    : savedDate && typeof savedDate === "object" &&
        savedDate.venueId === venueId && isBusinessDate(savedDate.date)
      ? savedDate.date
      : businessDate;
  const setSelectedDate = useCallback((date: string) => {
    setSavedDate({ venueId, date });
  }, [setSavedDate, venueId]);
  const [activeTask, setActiveTask] = useState<AdminTask>("guest-list");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const pendingEventScopeRef = useRef<EventScope | null>(null);
  const [isRoleReady, setIsRoleReady] = useState(false);
  const [workspaceFocusRequestId, setWorkspaceFocusRequestId] = useState(0);

  const requestWorkspaceFocusIfOwned = useCallback(() => {
    const workspace = document.getElementById("admin-workspace");
    const activeElement = document.activeElement;
    if (
      workspace &&
      activeElement instanceof HTMLElement &&
      workspace !== activeElement &&
      workspace.contains(activeElement)
    ) {
      setWorkspaceFocusRequestId((current) => current + 1);
    }
  }, []);

  const applyEventScope = useCallback(
    (scope: EventScope) => {
      pendingEventScopeRef.current = scope;
      setSelectedDate(scope.businessDate);
      setSelectedEventId(scope.eventId);
    },
    [setSelectedDate],
  );

  useEffect(() => {
    if (!hasCurrentVenue) return;
    // Preserve legacy selections and keep future restores within their venue.
    if (isBusinessDate(savedDate)) {
      setSavedDate({ venueId, date: savedDate });
    } else if (savedDate && typeof savedDate === "object" && savedDate.venueId !== venueId) {
      setSavedDate(null);
    }
  }, [hasCurrentVenue, savedDate, setSavedDate, venueId]);

  useEffect(() => {
    const pendingScope = pendingEventScopeRef.current;
    if (
      pendingScope &&
      pendingScope.businessDate === selectedDate &&
      pendingScope.venueId === venueId
    ) {
      setSelectedEventId(pendingScope.eventId);
      pendingEventScopeRef.current = null;
      return;
    }
    setSelectedEventId(null);
  }, [selectedDate, venueId]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const requestedTask = parseAdminTask(search);
    const nextTask =
      requestedTask && isAdminTaskAvailable(requestedTask, isSuperAdmin)
        ? requestedTask
        : "guest-list";
    const eventScope =
      nextTask === "event-manage" ? getAdminEventScope(search, venueId) : null;

    setActiveTask(nextTask);
    if (eventScope) applyEventScope(eventScope);

    const nextSearch =
      (nextTask === "analytics" || nextTask === "guest-list")
        ? window.location.search
        : eventScope
          ? getCanonicalEventSearch(eventScope)
          : getAdminTaskSearch(nextTask);
    if (window.location.search !== nextSearch) {
      window.history.replaceState(null, "", `/admin${nextSearch}`);
    }
    setIsRoleReady(true);
  }, [applyEventScope, isSuperAdmin, venueId]);

  const changeTask = useCallback(
    (task: AdminTask, historyMode: "push" | "replace" = "push") => {
      if (task === activeTask || !isAdminTaskAvailable(task, isSuperAdmin)) {
        return;
      }
      requestWorkspaceFocusIfOwned();
      setActiveTask(task);
      const nextUrl = `/admin${getAdminTaskSearch(task)}`;
      if (historyMode === "replace") {
        window.history.replaceState(null, "", nextUrl);
      } else {
        window.history.pushState(null, "", nextUrl);
      }
    },
    [activeTask, isSuperAdmin, requestWorkspaceFocusIfOwned],
  );

  useEffect(() => {
    if (!isRoleReady || isAdminTaskAvailable(activeTask, isSuperAdmin)) return;
    changeTask("guest-list", "replace");
  }, [activeTask, changeTask, isRoleReady, isSuperAdmin]);

  useEffect(() => {
    if (!isRoleReady) return;
    const handlePopState = () => {
      const search = new URLSearchParams(window.location.search);
      const requestedTask = parseAdminTask(search);
      if (!requestedTask || !isAdminTaskAvailable(requestedTask, isSuperAdmin)) {
        requestWorkspaceFocusIfOwned();
        setActiveTask("guest-list");
        return;
      }

      if (requestedTask === "event-manage") {
        const eventScope = getAdminEventScope(search, venueId);
        if (eventScope) {
          applyEventScope(eventScope);
        } else {
          setSelectedEventId(null);
        }
      }
      requestWorkspaceFocusIfOwned();
      setActiveTask(requestedTask);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [
    applyEventScope,
    isRoleReady,
    isSuperAdmin,
    requestWorkspaceFocusIfOwned,
    venueId,
  ]);

  useEffect(() => {
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

      const shortcutTask = getAdminShortcutTask(event.key, isSuperAdmin);
      if (shortcutTask) changeTask(shortcutTask);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeTask, isRouteTransitionActive, isSuperAdmin]);

  const openAnalyticsEvent = useCallback(
    (eventId: string, eventBusinessDate: string) => {
      if (!eventId || !venueId || !isBusinessDate(eventBusinessDate)) return;
      if (
        activeTask === "event-manage" &&
        selectedEventId === eventId &&
        selectedDate === eventBusinessDate
      ) {
        return;
      }

      const scope = { eventId, businessDate: eventBusinessDate, venueId };
      requestWorkspaceFocusIfOwned();
      applyEventScope(scope);
      setActiveTask("event-manage");
      window.history.pushState(null, "", `/admin${getCanonicalEventSearch(scope)}`);
    },
    [
      activeTask,
      applyEventScope,
      requestWorkspaceFocusIfOwned,
      selectedDate,
      selectedEventId,
      venueId,
    ],
  );

  return {
    activeTask,
    changeTask,
    isRoleReady,
    onAnalyticsEventOpen: openAnalyticsEvent,
    selectedDate,
    selectedEventId,
    setSelectedDate,
    setSelectedEventId,
    workspaceFocusRequestId,
  };
}
