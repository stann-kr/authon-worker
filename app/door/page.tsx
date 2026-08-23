"use client";

import { useState, useEffect, useMemo } from "react";
import { useLocalStorage } from "../../lib/hooks";
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
import useDoorRosterController, {
  type DoorRosterDependencies,
} from "./useDoorRosterController";
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
import { parseDoorGuestCode } from "../../lib/door/offline-domain";
import {
  clearResolvedOfflineDoorMutations,
  enqueueOfflineDoorMutation,
  listOfflineDoorMutations,
  loadOfflineDoorRoster,
  removeOfflineDoorRoster,
  resolveOfflineDoorMutation,
  saveOfflineDoorRoster,
} from "../../lib/door/offline-store";
import type { Guest } from "@/lib/guests/types";
import { useLocale, useTranslations } from "next-intl";

const DOOR_ROSTER_DEPENDENCIES: DoorRosterDependencies = Object.freeze({
  fetchGuestsByDate,
  updateGuestStatus,
  deleteGuest,
  fetchGuestOperationsSnapshot,
  fetchOfflineDoorRoster,
  syncOfflineDoorMutations,
  clearResolvedOfflineDoorMutations,
  enqueueOfflineDoorMutation,
  listOfflineDoorMutations,
  loadOfflineDoorRoster,
  removeOfflineDoorRoster,
  resolveOfflineDoorMutation,
  saveOfflineDoorRoster,
  randomUUID: () => crypto.randomUUID(),
});

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
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "door:sortMode",
    "default",
  );
  const [prioritizeWaiting, setPrioritizeWaiting] = useLocalStorage(
    "door:prioritizeWaiting",
    true,
  );
  const [doorCode, setDoorCode] = useState("");
  const [isDoorCodeLoading, setIsDoorCodeLoading] = useState(false);
  const [doorCodeFeedback, setDoorCodeFeedback] = useState<
    "found" | "notFound" | "unavailable" | null
  >(null);
  const {
    displayData,
    feedback,
    guests,
    handleClearResolvedOfflineMutations,
    handleStatusChange,
    hasCurrentScopeData,
    hasResolvedOfflineMutations,
    isCurrentScopeFetching,
    isFetching,
    isOfflineMode,
    isOfflineSyncing,
    loadData,
    loadOutcome,
    loadingStates,
    offlineNotice,
    offlineQueueCounts,
    offlineScope,
    requestScopeKey,
    syncOfflineQueue,
  } = useDoorRosterController({
    venueId,
    selectedDate,
    selectedEventId,
    translate: t,
    dependencies: DOOR_ROSTER_DEPENDENCIES,
  });
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
  useSectionLoadingTask(isCurrentScopeFetching);

  useEffect(() => {
    if (currentVenue) setSelectedDate(businessDate);
  }, [businessDate, currentVenue, setSelectedDate]);

  useEffect(() => {
    setSelectedEventId(null);
  }, [selectedDate, venueId]);

  useEffect(() => {
    setSelectedDJ("all");
  }, [requestScopeKey]);

  useEffect(() => {
    setDoorCode("");
    setDoorCodeFeedback(null);
  }, [offlineScope]);

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
