"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  useLocalStorage,
  useGuestPolling,
  useLatestRequestGuard,
  useLatestRef,
  useScopedOperationGuard,
} from "../../lib/hooks";
import AuthGuard from "../../components/AuthGuard";
import GuestListCard from "../../components/GuestListCard";
import GuestSearchInput from "../../components/GuestSearchInput";
import VenueSelector, {
  useVenueSelector,
} from "../../components/VenueSelector";
import DatePicker from "../../components/DatePicker";
import StatGrid from "../../components/StatGrid";
import PanelHeader from "../../components/PanelHeader";
import WorkspaceShell from "../../components/WorkspaceShell";
import VenueLoadNotice from "../../components/VenueLoadNotice";
import EmptyState from "../../components/EmptyState";
import Alert from "../../components/Alert";
import Icon from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import OperationsLayout from "../../components/OperationsLayout";
import EventScopeSelector from "../../components/EventScopeSelector";
import AttendanceCounter from "./components/AttendanceCounter";
import { useSectionLoadingTask } from "../../components/RouteTransitionProvider";
import { getBusinessDate } from "../../lib/date";
import { orderGuestDisplayList } from "../../lib/guests/display-order";
import {
  deriveAsyncListState,
  shouldShowEmptyState,
} from "../../lib/ui/async-list-state";
import {
  fetchGuestsByDate,
  updateGuestStatus,
  deleteGuest,
} from "../../lib/api/guests";
import { fetchGuestOperationsSnapshot } from "../../lib/api/guest-snapshots";
import {
  fetchOfflineDoorRoster,
  findDoorGuestByCode,
  syncOfflineDoorMutations,
} from "../../lib/api/offline-door";
import {
  applyQueuedDoorMutation,
  createOfflineDoorRosterSnapshot,
  parseDoorGuestCode,
  type OfflineDoorMutation,
  type OfflineDoorScope,
} from "../../lib/door/offline-domain";
import {
  clearResolvedOfflineDoorMutations,
  enqueueOfflineDoorMutation,
  listOfflineDoorMutations,
  loadOfflineDoorRoster,
  removeOfflineDoorRoster,
  resolveOfflineDoorMutation,
  saveOfflineDoorRoster,
} from "../../lib/door/offline-store";
import {
  groupOfflineDoorMutationsByDevice,
  type OfflineDoorSyncResult,
} from "../../lib/door/offline-sync";
import type {
  ExternalLinkDirectoryEntry,
  Guest,
  UserDirectoryEntry,
} from "../../lib/api/types";
import { useLocale, useTranslations } from "next-intl";

const EMPTY_DISPLAY_DATA = {
  guests: [] as Guest[],
  users: [] as UserDirectoryEntry[],
  externalLinks: [] as ExternalLinkDirectoryEntry[],
};

export default function DoorPage() {
  return (
    <AuthGuard requiredAccess={["door"]}>
      <DoorPageContent />
    </AuthGuard>
  );
}

function DoorPageContent() {
  const t = useTranslations("Door");
  const commonT = useTranslations("Common");
  const tRef = useLatestRef(t);
  const locale = useLocale() as "en" | "ko";
  const {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    currentVenue,
    isLoadingVenues,
    venueLoadError,
    refreshVenues,
  } = useVenueSelector();
  const businessDate = getBusinessDate(currentVenue ?? {});
  const [selectedDate, setSelectedDate] = useLocalStorage(
    "door:selectedDate",
    getBusinessDate(),
  );
  const [selectedDJ, setSelectedDJ] = useState<string>("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [externalLinks, setExternalLinks] =
    useState<ExternalLinkDirectoryEntry[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "door:sortMode",
    "default",
  );
  const [prioritizeWaiting, setPrioritizeWaiting] = useLocalStorage(
    "door:prioritizeWaiting",
    true,
  );
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [offlineMutations, setOfflineMutations] = useState<OfflineDoorMutation[]>([]);
  const [isOfflineSyncing, setIsOfflineSyncing] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<
    "queued" | "syncFailed" | "scopeClosed" | null
  >(null);
  const [doorCode, setDoorCode] = useState("");
  const [isDoorCodeLoading, setIsDoorCodeLoading] = useState(false);
  const [doorCodeFeedback, setDoorCodeFeedback] = useState<
    "found" | "notFound" | "unavailable" | null
  >(null);
  const offlineSyncingRef = useRef(false);

  // 로딩 중 이전 데이터를 유지하여 화면 깜빡임 방지
  const displayCacheRef = useRef<{
    scopeKey: string;
    guests: Guest[];
    users: UserDirectoryEntry[];
    externalLinks: ExternalLinkDirectoryEntry[];
  }>({
    scopeKey: "",
    guests: [],
    users: [],
    externalLinks: [],
  });

  const requestScopeKey = `${venueId}:${selectedDate}:${selectedEventId ?? "general"}`;
  const offlineScope = useMemo<OfflineDoorScope | null>(
    () =>
      venueId && selectedEventId
        ? {
            venueId,
            eventId: selectedEventId,
            businessDate: selectedDate,
          }
        : null,
    [selectedDate, selectedEventId, venueId],
  );
  const attendanceScope = useMemo(
    () =>
      venueId
        ? {
            venueId,
            businessDate: selectedDate,
            eventId: selectedEventId,
          }
        : null,
    [selectedDate, selectedEventId, venueId],
  );
  const requestGuard = useLatestRequestGuard();
  const pollingGuard = useLatestRequestGuard();
  const mutationGuard = useScopedOperationGuard();
  const currentScopeKeyRef = useRef(requestScopeKey);
  currentScopeKeyRef.current = requestScopeKey;

  useEffect(() => {
    if (!isFetching && loadedScopeKey === requestScopeKey) {
      displayCacheRef.current = {
        scopeKey: requestScopeKey,
        guests,
        users,
        externalLinks,
      };
    }
  }, [externalLinks, guests, isFetching, loadedScopeKey, requestScopeKey, users]);

  const hasCurrentScopeData = loadedScopeKey === requestScopeKey;
  const isCurrentScopeFetching = isFetching || !hasCurrentScopeData;
  useSectionLoadingTask(isCurrentScopeFetching);
  const displayData = !hasCurrentScopeData
    ? EMPTY_DISPLAY_DATA
    : isFetching && displayCacheRef.current.scopeKey === requestScopeKey
      ? displayCacheRef.current
      : { guests, users, externalLinks };

  useEffect(() => {
    if (currentVenue) setSelectedDate(businessDate);
  }, [businessDate, currentVenue, setSelectedDate]);

  useEffect(() => {
    setSelectedEventId(null);
  }, [selectedDate, venueId]);

  useEffect(() => {
    setSelectedDJ("all");
    setLoadOutcome("idle");
  }, [requestScopeKey]);

  const refreshOfflineMutations = useCallback(async (
    scope: OfflineDoorScope | null = offlineScope,
  ) => {
    if (!scope) {
      setOfflineMutations([]);
      return [];
    }
    try {
      const mutations = await listOfflineDoorMutations(scope);
      setOfflineMutations(mutations);
      return mutations;
    } catch {
      setOfflineMutations([]);
      return [];
    }
  }, [offlineScope]);

  const loadCachedOfflineRoster = useCallback(async (
    scope: OfflineDoorScope,
  ): Promise<boolean> => {
    try {
      const [snapshot, mutations] = await Promise.all([
        loadOfflineDoorRoster(scope),
        listOfflineDoorMutations(scope),
      ]);
      if (!snapshot) return false;
      const cachedGuests = mutations
        .filter((mutation) =>
          mutation.state === "queued" || mutation.state === "confirmed",
        )
        .reduce(
          (current, mutation) => applyQueuedDoorMutation(current, mutation),
          snapshot.guests,
        );
      setGuests(cachedGuests.map((guest) => ({
        id: guest.id,
        venueId: scope.venueId,
        eventId: scope.eventId,
        name: guest.name,
        status: guest.status,
        checkInTime: guest.checkInTime,
        date: scope.businessDate,
        createdAt: snapshot.cachedAt,
        updatedAt: snapshot.cachedAt,
      })));
      setUsers([]);
      setExternalLinks([]);
      setOfflineMutations(mutations);
      setIsOfflineMode(true);
      setLoadOutcome("success");
      return true;
    } catch {
      return false;
    }
  }, []);

  const syncOfflineQueue = useCallback(async () => {
    if (
      !offlineScope ||
      offlineSyncingRef.current ||
      (typeof navigator !== "undefined" && !navigator.onLine)
    ) return;
    offlineSyncingRef.current = true;
    setIsOfflineSyncing(true);
    try {
      const mutations = await listOfflineDoorMutations(offlineScope);
      const queued = mutations.filter((mutation) => mutation.state === "queued");
      if (queued.length === 0) {
        setOfflineMutations(mutations);
        return;
      }
      const syncResults: OfflineDoorSyncResult[] = [];
      let hasSyncFailure = false;
      for (const group of groupOfflineDoorMutationsByDevice(queued)) {
        const response = await syncOfflineDoorMutations({
          ...offlineScope,
          deviceId: group.deviceId,
          items: group.mutations.map((mutation) => ({
            idempotencyKey: mutation.idempotencyKey,
            sequence: mutation.sequence,
            guestId: mutation.guestId,
            action: mutation.action,
            queuedAt: mutation.queuedAt,
          })),
        });
        if (response.error || !response.data) {
          hasSyncFailure = true;
          continue;
        }
        syncResults.push(...response.data);
      }
      if (syncResults.length === 0 && hasSyncFailure) {
        setOfflineNotice("syncFailed");
        return;
      }
      for (const result of syncResults) {
        await resolveOfflineDoorMutation({
          scope: offlineScope,
          idempotencyKey: result.idempotencyKey,
          state: result.state,
          resolution: result.resolution,
        });
      }
      await loadCachedOfflineRoster(offlineScope);
      setGuests((current) => {
        let next = current;
        for (const result of syncResults) {
          if (result.status === null) {
            continue;
          }
          next = next.map((guest) =>
            guest.id === result.guestId
              ? {
                  ...guest,
                  status: result.status ?? guest.status,
                  checkInTime: result.checkInTime,
                }
              : guest,
          );
        }
        return next;
      });
      try {
        const [authoritative, cacheableRoster] = await Promise.all([
          fetchGuestOperationsSnapshot(
            offlineScope.businessDate,
            offlineScope.venueId,
            offlineScope.eventId,
          ),
          fetchOfflineDoorRoster(offlineScope),
        ]);
        if (authoritative.data) {
          setGuests(authoritative.data.guests);
          setUsers(authoritative.data.users);
          setExternalLinks(authoritative.data.externalLinks);
          setIsOfflineMode(false);
        }
        if (cacheableRoster.data) {
          try {
            await saveOfflineDoorRoster(createOfflineDoorRosterSnapshot({
              scope: offlineScope,
              guests: cacheableRoster.data,
            }));
          } catch {
            // The server result remains authoritative if local persistence is unavailable.
          }
        } else if (cacheableRoster.error === "OFFLINE_DOOR_EVENT_UNAVAILABLE") {
          try {
            await removeOfflineDoorRoster(offlineScope);
          } catch {
            // A stale snapshot will still expire locally and cannot sync into a closed Event.
          }
        }
      } catch {
        // Resolved queue states remain visible until a later authoritative refresh.
      }
      const hasScopeClosedResult = syncResults.some(
        (result) => result.state === "scope_closed",
      );
      setOfflineNotice(
        hasSyncFailure
          ? "syncFailed"
          : hasScopeClosedResult
            ? "scopeClosed"
            : null,
      );
      await refreshOfflineMutations(offlineScope);
    } catch {
      setOfflineNotice("syncFailed");
    } finally {
      offlineSyncingRef.current = false;
      setIsOfflineSyncing(false);
    }
  }, [loadCachedOfflineRoster, offlineScope, refreshOfflineMutations]);

  const loadData = useCallback(async () => {
    pollingGuard.invalidateRequests();
    const isLatestRequest = requestGuard.beginRequest();
    if (!venueId) {
      setGuests([]);
      setUsers([]);
      setExternalLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setLoadOutcome("success");
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    setFeedback(null);
    try {
      const [operationsResponse, offlineRosterResponse] = await Promise.all([
        fetchGuestOperationsSnapshot(
          selectedDate,
          venueId,
          selectedEventId,
        ),
        offlineScope
          ? fetchOfflineDoorRoster(offlineScope)
          : Promise.resolve(null),
      ]);
      const { data, error } = operationsResponse;
      if (!isLatestRequest()) return;
      if (!data) {
        const usedCache = offlineScope
          ? await loadCachedOfflineRoster(offlineScope)
          : false;
        if (!isLatestRequest()) return;
        if (!usedCache) {
          setGuests([]);
          setUsers([]);
          setExternalLinks([]);
          setFeedback(tRef.current("loadFailed"));
          setLoadOutcome("error");
          setIsOfflineMode(false);
        }
      } else {
        if (error) {
          setFeedback(tRef.current("partialLoadFailed"));
          setLoadOutcome("partial");
        } else {
          setLoadOutcome("success");
        }
        setGuests(data.guests);
        setUsers(data.users);
        setExternalLinks(data.externalLinks);
        setIsOfflineMode(false);
        if (offlineScope && offlineRosterResponse?.data) {
          try {
            await saveOfflineDoorRoster(createOfflineDoorRosterSnapshot({
              scope: offlineScope,
              guests: offlineRosterResponse.data,
            }));
            await refreshOfflineMutations(offlineScope);
          } catch {
            setOfflineMutations([]);
          }
        } else if (
          offlineScope &&
          offlineRosterResponse?.error === "OFFLINE_DOOR_EVENT_UNAVAILABLE"
        ) {
          try {
            await removeOfflineDoorRoster(offlineScope);
            await refreshOfflineMutations(offlineScope);
          } catch {
            setOfflineMutations([]);
          }
        }
      }
      setLoadedScopeKey(requestScopeKey);
      if (data && offlineScope) void syncOfflineQueue();
    } catch (error) {
      if (!isLatestRequest()) return;
      console.error("Failed to load data:", error);
      const usedCache = offlineScope
        ? await loadCachedOfflineRoster(offlineScope)
        : false;
      if (!isLatestRequest()) return;
      setLoadedScopeKey(requestScopeKey);
      if (!usedCache) {
        setGuests([]);
        setUsers([]);
        setExternalLinks([]);
        setFeedback(tRef.current("loadFailed"));
        setLoadOutcome("error");
        setIsOfflineMode(false);
      }
    } finally {
      if (isLatestRequest()) setIsFetching(false);
    }
  }, [
    loadCachedOfflineRoster,
    offlineScope,
    pollingGuard,
    refreshOfflineMutations,
    requestGuard,
    requestScopeKey,
    selectedDate,
    selectedEventId,
    syncOfflineQueue,
    tRef,
    venueId,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setOfflineNotice(null);
    setIsOfflineMode(false);
    setDoorCode("");
    setDoorCodeFeedback(null);
    void refreshOfflineMutations(offlineScope);
  }, [offlineScope, refreshOfflineMutations]);

  useEffect(() => {
    const handleOnline = () => {
      void loadData();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [loadData]);

  // 주기적으로 데이터 갱신 (15초)
  const pollData = useCallback(async () => {
    if (!venueId || loadedScopeKey !== requestScopeKey) return;
    const isLatestRequest = pollingGuard.beginRequest();
    const { data } = await fetchGuestsByDate(selectedDate, venueId, selectedEventId);
    if (isLatestRequest() && loadedScopeKey === requestScopeKey && data) {
      setGuests(data);
    }
  }, [loadedScopeKey, pollingGuard, requestScopeKey, selectedDate, selectedEventId, venueId]);

  const pollingCoordinator = useGuestPolling(
    pollData,
    15000,
    !!venueId && !isOfflineMode,
  );

  useEffect(() => {
    mutationGuard.invalidateOperations();
    pollingGuard.invalidateRequests();
    pollingCoordinator.clearSuspensions();
    setLoadingStates({});
    setFeedback(null);
  }, [mutationGuard, pollingCoordinator, pollingGuard, requestScopeKey]);

  const queueOfflineStatusChange = useCallback(async (
    guestId: string,
    status: "pending" | "checked",
  ): Promise<boolean> => {
    if (!offlineScope) return false;
    try {
      const mutation = await enqueueOfflineDoorMutation({
        scope: offlineScope,
        guestId,
        action: status === "pending" ? "cancel_check_in" : "check_in",
      });
      setGuests((current) =>
        current.map((guest) =>
          guest.id === guestId
            ? {
                ...guest,
                status,
                checkInTime: status === "checked" ? mutation.queuedAt : null,
              }
            : guest,
        ),
      );
      await refreshOfflineMutations(offlineScope);
      setIsOfflineMode(true);
      setOfflineNotice("queued");
      setFeedback(null);
      return true;
    } catch {
      setFeedback(t("offlineQueueFailed"));
      return false;
    }
  }, [offlineScope, refreshOfflineMutations, t]);

  const handleStatusChange = async (
    id: string,
    newStatus: Guest["status"],
    action: string,
  ) => {
    const operationScopeKey = requestScopeKey;
    const busyKey = `${id}_${action}`;
    const operation = mutationGuard.beginOperation(
      operationScopeKey,
      busyKey,
    );
    const releasePolling = pollingCoordinator.suspend();
    pollingGuard.invalidateRequests();
    setLoadingStates((prev) => ({ ...prev, [busyKey]: true }));

    try {
      if (
        newStatus !== "deleted" &&
        offlineScope &&
        (isOfflineMode ||
          (typeof navigator !== "undefined" && !navigator.onLine))
      ) {
        await queueOfflineStatusChange(id, newStatus);
        return;
      }
      const { data, error } =
        newStatus === "deleted"
          ? await deleteGuest(id)
          : await updateGuestStatus(id, newStatus, crypto.randomUUID());

      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      if (!error && data) {
        setGuests((prev) => prev.map((guest) => (guest.id === id ? data : guest)));
        setFeedback(null);
        await loadData();
      } else {
        console.error("Failed to update guest status:", error);
        setFeedback(
          error === "ATTENDANCE_SCOPE_CLOSED"
            ? t("attendanceScopeClosed")
            : t("updateFailed"),
        );
      }
    } catch (error) {
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      console.error("Failed to update guest status:", error);
      const queued =
        newStatus !== "deleted" &&
        offlineScope
          ? await queueOfflineStatusChange(id, newStatus)
          : false;
      if (!queued) setFeedback(t("updateFailed"));
    } finally {
      releasePolling();
      if (operation.finish(currentScopeKeyRef.current)) {
        setLoadingStates((prev) => ({ ...prev, [busyKey]: false }));
      }
    }
  };

  const handleClearResolvedOfflineMutations = async () => {
    if (!offlineScope) return;
    try {
      const [snapshot, mutations] = await Promise.all([
        loadOfflineDoorRoster(offlineScope),
        listOfflineDoorMutations(offlineScope),
      ]);
      if (snapshot) {
        const confirmedRoster = mutations
          .filter((mutation) => mutation.state === "confirmed")
          .reduce(
            (current, mutation) => applyQueuedDoorMutation(current, mutation),
            snapshot.guests,
          );
        await saveOfflineDoorRoster(createOfflineDoorRosterSnapshot({
          scope: offlineScope,
          guests: confirmedRoster,
        }));
      }
      await clearResolvedOfflineDoorMutations(offlineScope);
      await refreshOfflineMutations(offlineScope);
    } catch {
      setFeedback(t("offlineStorageFailed"));
    }
  };

  const handleDoorCodeLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!offlineScope || !doorCode.trim() || isDoorCodeLoading) return;
    setIsDoorCodeLoading(true);
    setDoorCodeFeedback(null);
    try {
      if (isOfflineMode || !navigator.onLine) {
        const guestId = parseDoorGuestCode(doorCode);
        const localGuest = guestId
          ? guests.find((guest) => guest.id === guestId)
          : null;
        if (!localGuest) {
          setDoorCodeFeedback("notFound");
          return;
        }
        setSearchQuery(localGuest.name);
        setDoorCodeFeedback("found");
        return;
      }
      const response = await findDoorGuestByCode({
        ...offlineScope,
        code: doorCode,
      });
      if (response.data) {
        setSearchQuery(response.data.name);
        setDoorCodeFeedback("found");
      } else {
        setDoorCodeFeedback(
          response.error === "DOOR_GUEST_CODE_NOT_FOUND" ||
            response.error === "INVALID_DOOR_GUEST_CODE"
            ? "notFound"
            : "unavailable",
        );
      }
    } catch {
      setDoorCodeFeedback("unavailable");
    } finally {
      setIsDoorCodeLoading(false);
    }
  };

  const getContributor = (guest: Guest): {
    name?: string;
    accountKind: "personal" | "shared";
  } => {
    if (guest.createdByUserId) {
      const u = displayData.users.find((u) => u.id === guest.createdByUserId);
      return { name: u?.name, accountKind: u?.accountKind ?? "personal" };
    }
    if (guest.externalLinkId) {
      const link = displayData.externalLinks.find(
        (l) => l.id === guest.externalLinkId,
      );
      return { name: link ? `${link.djName} (EXT)` : undefined, accountKind: "personal" };
    }
    return { accountKind: "personal" };
  };

  const filteredGuests =
    selectedDJ === "all"
      ? displayData.guests
      : selectedDJ.startsWith("ext:")
        ? displayData.guests.filter(
            (guest) => guest.externalLinkId === selectedDJ.replace("ext:", ""),
          )
        : displayData.guests.filter(
            (guest) => guest.createdByUserId === selectedDJ,
          );
  const offlineQueueCounts = offlineMutations.reduce(
    (counts, mutation) => ({
      ...counts,
      [mutation.state]: counts[mutation.state] + 1,
    }),
    { queued: 0, confirmed: 0, conflict: 0, rejected: 0, scope_closed: 0 },
  );
  const hasResolvedOfflineMutations =
    offlineQueueCounts.confirmed +
      offlineQueueCounts.conflict +
      offlineQueueCounts.rejected +
      offlineQueueCounts.scope_closed >
    0;

  const pendingGuests = filteredGuests.filter(
    (guest) => guest.status === "pending",
  );
  const checkedGuests = filteredGuests.filter(
    (guest) => guest.status === "checked",
  );
  const scopeCheckedInGuests = displayData.guests.filter(
    (guest) => guest.status === "checked",
  ).length;
  const sortedGuests = orderGuestDisplayList(filteredGuests, {
    sortMode,
    locale: locale === "ko" ? "ko-KR" : "en-US",
    prioritizeWaiting,
  });
  const displayGuests = searchQuery
    ? sortedGuests.filter((g) =>
        (g.name || "").toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedGuests;
  const listState = deriveAsyncListState({
    hasStarted: isFetching || loadOutcome !== "idle",
    isLoading: isCurrentScopeFetching,
    itemCount: displayGuests.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });

  // Only show users/links who registered guests on the selected date
  const activeUserIds = new Set(
    displayData.guests.map((g) => g.createdByUserId).filter(Boolean),
  );
  const filteredUsers = displayData.users.filter((u) =>
    activeUserIds.has(u.id),
  );
  const activeExtLinkIds = new Set(
    displayData.guests.map((g) => g.externalLinkId).filter(Boolean),
  );
  const filteredExtLinks = displayData.externalLinks.filter((l) =>
    activeExtLinkIds.has(l.id),
  );

  return (
    <WorkspaceShell
      contentClassName="gap-4 md:pb-8 lg:gap-6"
      bottomInsetClassName="pb-[var(--door-mobile-dock-height,calc(6rem+env(safe-area-inset-bottom)))] md:pb-0"
      footerLayer="below-mobile-dock"
    >
      {venueLoadError && (
        <VenueLoadNotice
          onRetry={refreshVenues}
          isLoading={isLoadingVenues}
        />
      )}
      <OperationsLayout
        title={commonT("door")}
        dashboard={
          <>
            <AttendanceCounter
              scope={attendanceScope}
              currentBusinessDate={businessDate}
              checkedInGuests={scopeCheckedInGuests}
              hasPendingGuestMutations={offlineQueueCounts.queued > 0}
            />
            <div className="context-bar">
                  <DatePicker
                    value={selectedDate}
                    onChange={setSelectedDate}
                    businessDate={businessDate}
                  />
                  <div className="context-filter-grid">
                    {isSuperAdmin && (
                      <VenueSelector
                        venues={venues}
                        selectedVenueId={selectedVenueId}
                        onVenueChange={setSelectedVenueId}
                      />
                    )}
                    <EventScopeSelector
                      venueId={venueId}
                      businessDate={selectedDate}
                      value={selectedEventId}
                      onChange={setSelectedEventId}
                    />
                    <div className="min-w-0">
                      <label htmlFor="door-user-filter" className="type-context-title">
                        {t("guestOwner")}
                      </label>
                      <div className="relative">
                        <select
                          id="door-user-filter"
                          name="guest-owner"
                          value={selectedDJ}
                          onChange={(event) => setSelectedDJ(event.target.value)}
                          autoComplete="off"
                          className="app-field appearance-none pr-10"
                        >
                          <option value="all">{t("allOwners")}</option>
                          {filteredUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                          {filteredExtLinks.map((link) => (
                            <option key={`ext:${link.id}`} value={`ext:${link.id}`}>
                              {link.djName} ({t("external")})
                            </option>
                          ))}
                        </select>
                        <Icon
                          name="chevron-down"
                          size={18}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {feedback && <Alert type="error" message={feedback} />}

                {offlineScope && (
                  <div
                    className="app-panel space-y-3 p-4 sm:p-5"
                    aria-label={t("offlineOperations")}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-text-heading">
                          {t("offlineOperations")}
                        </h2>
                        {(isOfflineMode || isOfflineSyncing) && (
                          <p
                            className="mt-1 text-xs leading-relaxed text-text-muted"
                            role="status"
                            aria-live="polite"
                          >
                            {isOfflineMode
                              ? t("offlineCachedRoster")
                              : t("offlineSyncing")}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void syncOfflineQueue()}
                          disabled={isOfflineSyncing || offlineQueueCounts.queued === 0}
                          className="pressable min-h-11 border border-border-default bg-surface-raised px-3 py-2 text-xs font-medium text-text-heading disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t("retryOfflineSync")}
                        </button>
                        {hasResolvedOfflineMutations && (
                          <button
                            type="button"
                            onClick={() => void handleClearResolvedOfflineMutations()}
                            className="pressable min-h-11 border border-border-default bg-canvas px-3 py-2 text-xs font-medium text-text-muted hover:text-text-heading"
                          >
                            {t("clearOfflineResults")}
                          </button>
                        )}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-5">
                      <div><dt className="text-text-dim">{t("offlineQueued")}</dt><dd className="mt-1 text-text-heading">{offlineQueueCounts.queued}</dd></div>
                      <div><dt className="text-text-dim">{t("offlineConfirmed")}</dt><dd className="mt-1 text-status-checked">{offlineQueueCounts.confirmed}</dd></div>
                      <div><dt className="text-text-dim">{t("offlineConflicts")}</dt><dd className="mt-1 text-status-waiting">{offlineQueueCounts.conflict}</dd></div>
                      <div><dt className="text-text-dim">{t("offlineRejected")}</dt><dd className="mt-1 text-status-danger">{offlineQueueCounts.rejected}</dd></div>
                      <div><dt className="text-text-dim">{t("offlineScopeClosed")}</dt><dd className="mt-1 text-status-danger">{offlineQueueCounts.scope_closed}</dd></div>
                    </dl>
                    {offlineNotice && (
                      <p
                        className={`border-l-2 px-3 py-2 text-xs ${
                          offlineNotice === "syncFailed" || offlineNotice === "scopeClosed"
                            ? "border-status-danger bg-status-danger/10 text-status-danger"
                            : "border-status-waiting bg-status-waiting/10 text-text-muted"
                        }`}
                        role={offlineNotice === "syncFailed" || offlineNotice === "scopeClosed" ? "alert" : "status"}
                      >
                        {t(`offlineNotice.${offlineNotice}`)}
                      </p>
                    )}
                  </div>
                )}

          </>
        }
      >
            <section
              className="main-content-panel"
              aria-labelledby="door-guest-list-title"
              aria-busy={isCurrentScopeFetching}
            >
              <PanelHeader
                title={t("guestList")}
                headingLevel={2}
                headingId="door-guest-list-title"
                count={displayGuests.length}
                sortMode={sortMode}
                onSortToggle={() =>
                  setSortMode((prev) =>
                    prev === "default" ? "alpha" : "default",
                  )
                }
                onRefresh={loadData}
                isLoading={isCurrentScopeFetching}
                actions={
                  <button
                    type="button"
                    aria-pressed={prioritizeWaiting}
                    onClick={() => setPrioritizeWaiting((current) => !current)}
                    className={`pressable min-h-11 whitespace-nowrap border px-3 py-2 text-xs font-medium ${
                      prioritizeWaiting
                        ? "border-action-primary bg-surface-active text-text-heading"
                        : "border-border-default bg-surface-raised text-text-muted hover:border-border-strong hover:text-text-heading"
                    }`}
                  >
                    {t("prioritizeWaiting")}
                  </button>
                }
              />
              <GuestSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
              />
              {offlineScope && (
                <form
                  onSubmit={handleDoorCodeLookup}
                  className="border-b border-border-subtle bg-surface px-4 py-3 sm:px-5"
                >
                  <label htmlFor="door-guest-code" className="app-label">
                    {t("guestCode")}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="door-guest-code"
                      name="door-guest-code"
                      value={doorCode}
                      onChange={(event) => {
                        setDoorCode(event.target.value);
                        setDoorCodeFeedback(null);
                      }}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder={t("guestCodePlaceholder")}
                      className="app-field min-h-11 flex-1 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={!doorCode.trim() || isDoorCodeLoading}
                      className="pressable min-h-11 border border-action-primary bg-action-primary px-4 py-2 text-sm font-semibold text-action-text disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDoorCodeLoading ? t("guestCodeLookingUp") : t("guestCodeLookup")}
                    </button>
                  </div>
                  {doorCodeFeedback && (
                    <p
                      className={`mt-2 text-xs ${
                        doorCodeFeedback === "found"
                          ? "text-status-checked"
                          : "text-status-danger"
                      }`}
                      role={doorCodeFeedback === "found" ? "status" : "alert"}
                    >
                      {t(`guestCodeFeedback.${doorCodeFeedback}`)}
                    </p>
                  )}
                </form>
              )}
              <StatGrid
                variant="embedded"
                isLoading={!hasCurrentScopeData}
                items={[
                  {
                    label: t("waiting"),
                    value: pendingGuests.length,
                    color: "waiting",
                  },
                  {
                    label: t("checkedIn"),
                    value: checkedGuests.length,
                    color: "checked",
                  },
                  {
                    label: t("total"),
                    value: pendingGuests.length + checkedGuests.length,
                    color: "default",
                  },
                ]}
              />

              {listState === "loading" ? (
                <Skeleton rows={6} />
              ) : shouldShowEmptyState(listState) ? (
                <EmptyState
                  icon="user"
                  message={
                    searchQuery
                      ? t("noSearchResults")
                      : t("noGuestsForDate")
                  }
                />
              ) : (
                <div
                  className={`divide-y divide-border-subtle ${
                    isCurrentScopeFetching ? "pointer-events-none" : ""
                  }`}
                >
                  {displayGuests.map((guest, index) => {
                    const contributor = getContributor(guest);
                    return <GuestListCard
                      key={guest.id}
                      guest={{
                        id: guest.id,
                        name: guest.name,
                        status: guest.status,
                        checkInTime: guest.checkInTime || undefined,
                        createdAt: guest.createdAt || undefined,
                      }}
                      index={index}
                      mode="operations"
                      djName={contributor.name}
                      accountKind={contributor.accountKind}
                      registeredByName={guest.registeredByName}
                      onCheck={() =>
                        handleStatusChange(guest.id, "checked", "check")
                      }
                      onUndo={() =>
                        handleStatusChange(guest.id, "pending", "undo")
                      }
                      isCheckLoading={loadingStates[`${guest.id}_check`]}
                      isUndoLoading={loadingStates[`${guest.id}_undo`]}
                    />;
                  })}
                </div>
              )}
            </section>
      </OperationsLayout>
    </WorkspaceShell>
  );
}
