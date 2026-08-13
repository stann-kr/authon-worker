"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  useLocalStorage,
  useGuestPolling,
  useLatestRequestGuard,
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
      const { data, error } = await fetchGuestOperationsSnapshot(
        selectedDate,
        venueId,
        selectedEventId,
      );
      if (!isLatestRequest()) return;
      if (!data) {
        setGuests([]);
        setUsers([]);
        setExternalLinks([]);
        setFeedback(t("loadFailed"));
        setLoadOutcome("error");
      } else {
        if (error) {
          setFeedback(t("partialLoadFailed"));
          setLoadOutcome("partial");
        } else {
          setLoadOutcome("success");
        }
        setGuests(data.guests);
        setUsers(data.users);
        setExternalLinks(data.externalLinks);
      }
      setLoadedScopeKey(requestScopeKey);
    } catch (error) {
      if (!isLatestRequest()) return;
      console.error("Failed to load data:", error);
      setGuests([]);
      setUsers([]);
      setExternalLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setFeedback(t("loadFailed"));
      setLoadOutcome("error");
    } finally {
      if (isLatestRequest()) setIsFetching(false);
    }
  }, [pollingGuard, requestGuard, requestScopeKey, selectedDate, selectedEventId, t, venueId]);

  useEffect(() => {
    loadData();
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

  const pollingCoordinator = useGuestPolling(pollData, 15000, !!venueId);

  useEffect(() => {
    mutationGuard.invalidateOperations();
    pollingGuard.invalidateRequests();
    pollingCoordinator.clearSuspensions();
    setLoadingStates({});
    setFeedback(null);
  }, [mutationGuard, pollingCoordinator, pollingGuard, requestScopeKey]);

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
        setFeedback(t("updateFailed"));
      }
    } catch (error) {
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      console.error("Failed to update guest status:", error);
      setFeedback(t("updateFailed"));
    } finally {
      releasePolling();
      if (operation.finish(currentScopeKeyRef.current)) {
        setLoadingStates((prev) => ({ ...prev, [busyKey]: false }));
      }
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

  const pendingGuests = filteredGuests.filter(
    (guest) => guest.status === "pending",
  );
  const checkedGuests = filteredGuests.filter(
    (guest) => guest.status === "checked",
  );
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
    <WorkspaceShell contentClassName="gap-4 pb-8 lg:gap-6">
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
                    title={t("prioritizeWaitingHelp")}
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
