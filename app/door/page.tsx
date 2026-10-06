"use client";

import WorkspaceAction from "@/components/workspace/WorkspaceAction";
import OperationsScope from "@/components/operations/OperationsScope";

import Sheet from "@/components/overlays/Sheet";
import RosterView, { type RosterStatus } from "@/components/guests/RosterView";

import { fetchGuestsByDate } from "@/lib/guests/client";
import { fetchOfflineDoorRoster } from "@/lib/door/client";

import { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } from "react";
import { useLocalStorage } from "../../lib/hooks";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { hasAccess } from "@/lib/auth";
import { isBusinessDate } from "@/lib/events/domain";
import AuthGuard from "../../components/AuthGuard";
import GuestListCard from "../../components/GuestListCard";

import VenueSelector, {
  useVenueSelector,
} from "../../components/VenueSelector";
import DatePicker from "../../components/DatePicker";

import PanelHeader from "../../components/PanelHeader";
import WorkspaceShell from "../../components/WorkspaceShell";
import VenueLoadNotice from "../../components/VenueLoadNotice";
import EmptyState from "../../components/EmptyState";
import Alert from "../../components/Alert";
import Icon from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import Button from "../../components/Button";
import OperationsLayout from "../../components/OperationsLayout";
import EventScopeSelector from "../../components/EventScopeSelector";
import AttendanceCounter from "./components/AttendanceCounter";
import useDoorRosterController, {
  type DoorRosterDependencies,
  type DoorStatusChangeResult,
} from "./useDoorRosterController";
import useDoorCodeLookup, {
  type DoorCodeLookupDependencies,
  type DoorCodeLookupGuest,
} from "./useDoorCodeLookup";
import { getBusinessDate } from "../../lib/date";
import { orderGuestDisplayList } from "../../lib/guests/display-order";
import { deriveAsyncListState } from "../../lib/ui/async-list-state";
import {
  updateGuestStatus,
  deleteGuest,
} from "../../lib/api/guests";
import { fetchGuestOperationsSnapshot } from "@/lib/guest-snapshots/client";
import {
  findDoorGuestByCode,
  syncOfflineDoorMutations,
} from "../../lib/api/offline-door";
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
import { useToast, type ToastOptions } from "@/components/feedback/ToastProvider";

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

const DOOR_CODE_LOOKUP_DEPENDENCIES: DoorCodeLookupDependencies = Object.freeze({
  findDoorGuestByCode,
});

function subscribeToConnectivity(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export default function DoorPage() {
  return (
    <AuthGuard requiredAccess={["door"]}>
      <DoorPageContent />
    </AuthGuard>
  );
}

function DoorPageContent() {
  const { user } = useAuthSession();
  const canManageGuests = Boolean(user && hasAccess(user, ["admin"]));
  const initializedVenue = useRef<string | null>(null);
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
  const [savedDate, setSavedDate] = useLocalStorage<{ venueId: string; date: string } | string | null>(
    "door:selectedDate", null,
  );
  const selectedDate = isBusinessDate(savedDate) ? savedDate
    : savedDate && typeof savedDate === "object" && savedDate.venueId === venueId && isBusinessDate(savedDate.date)
      ? savedDate.date : businessDate;
  const setSelectedDate = useCallback((date: string) => setSavedDate({ venueId, date }), [setSavedDate, venueId]);
  const [tool, setTool] = useState<"code" | "offline" | null>(null);
  const [selectedDJ, setSelectedDJ] = useState<string>("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "door:sortMode",
    "default",
  );
  const [prioritizeWaiting, setPrioritizeWaiting] = useLocalStorage(
    "door:prioritizeWaiting",
    true,
  );
  const showToast = useToast();
  const isOnline = useSyncExternalStore(subscribeToConnectivity, () => navigator.onLine, () => true);
  // Recently checked-in guests keep their row and tab until the last Door toast leaves,
  // so consecutive check-ins never move rows under the operator's finger.
  const [heldGuestIds, setHeldGuestIds] = useState<ReadonlySet<string>>(() => new Set());
  const holdTokenRef = useRef(0);
  const [highlightedGuestId, setHighlightedGuestId] = useState<string | null>(null);
  const revealGuestIdRef = useRef<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const {
    displayData,
    feedback,
    deleteFailure,
    guests,
    handleClearResolvedOfflineMutations,
    handleStatusChange,
    hasCurrentScopeData,
    hasPendingGuestMutations,
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
    canDeleteGuests: canManageGuests,
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

  useEffect(() => {
    if (!currentVenue || initializedVenue.current === venueId) return;
    initializedVenue.current = venueId;
    const search = new URLSearchParams(window.location.search);
    const date = search.get("date");
    const matchesVenue = search.get("venue") === venueId && isBusinessDate(date);
    if (matchesVenue) setSelectedDate(date!);
    setSelectedEventId(matchesVenue ? search.get("eventId") : null);
  }, [currentVenue, setSelectedDate, venueId]);

  useEffect(() => {
    if (!currentVenue || !isBusinessDate(savedDate)) return;
    const search = new URLSearchParams(window.location.search);
    const requestedDate = search.get("date");
    const hasRequestedDate = search.get("venue") === venueId && isBusinessDate(requestedDate);
    setSelectedDate(hasRequestedDate ? requestedDate! : savedDate);
  }, [currentVenue, savedDate, setSelectedDate, venueId]);

  useEffect(() => {
    setSelectedDJ("all");
    setHighlightedGuestId(null);
    revealGuestIdRef.current = null;
  }, [requestScopeKey]);

  useEffect(() => {
    if (tool === "code") codeInputRef.current?.focus({ preventScroll: true });
  }, [tool]);

  // A guest-code match is revealed once its row has rendered and the lookup sheet has closed.
  useEffect(() => {
    const guestId = revealGuestIdRef.current;
    if (!guestId || tool) return;
    const row = [...document.querySelectorAll<HTMLElement>(".product-guest-row")]
      .find((element) => element.dataset.guestId === guestId);
    if (!row) return;
    revealGuestIdRef.current = null;
    row.scrollIntoView?.({ block: "center" });
    row.focus({ preventScroll: true });
  });

  const claimHold = () => ++holdTokenRef.current;
  const releaseHeldGuestsIfLatest = (token: number) => {
    if (holdTokenRef.current !== token) return;
    setHeldGuestIds((current) => current.size === 0 ? current : new Set());
  };
  const showDoorToast = (options: ToastOptions) => {
    const token = claimHold();
    showToast({ ...options, onClose: () => releaseHeldGuestsIfLatest(token) });
  };
  const changeSearch = (value: string) => {
    setSearchQuery(value);
    setHighlightedGuestId(null);
  };
  const revealFoundGuest = (guest: DoorCodeLookupGuest) => {
    setSearchQuery(guest.name);
    setSelectedDJ("all");
    setRosterStatus("all");
    setTool(null);
    setHighlightedGuestId(guest.id);
    revealGuestIdRef.current = guest.id;
    if (guest.status === "checked") {
      showDoorToast({ message: t("guestCodeAlreadyCheckedIn", { name: guest.name }), tone: "warning" });
    }
  };

  const {
    code: doorCode,
    feedback: doorCodeFeedback,
    busy: isDoorCodeLoading,
    change: handleDoorCodeChange,
    submit: handleDoorCodeLookup,
  } = useDoorCodeLookup({
    scope: offlineScope,
    guests,
    isOfflineMode,
    onGuestFound: revealFoundGuest,
    dependencies: DOOR_CODE_LOOKUP_DEPENDENCIES,
  });

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
      return { name: link ? `${link.djName} (${t("external")})` : undefined, accountKind: "personal" };
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
  const isHeld = (guest: Guest) => guest.status === "checked" && heldGuestIds.has(guest.id);
  const guestsById = new Map(filteredGuests.map((guest) => [guest.id, guest]));
  const sortedGuests = orderGuestDisplayList(
    filteredGuests.map((guest) => isHeld(guest) ? { ...guest, status: "pending" as const } : guest), {
      sortMode,
      locale: locale === "ko" ? "ko-KR" : "en-US",
      prioritizeWaiting,
    }).map((guest) => guestsById.get(guest.id) ?? guest);
  const displayGuests = sortedGuests.filter((guest) =>
    (rosterStatus === "all" || guest.status === rosterStatus || (rosterStatus === "pending" && isHeld(guest))) &&
    [guest.name, guest.registeredByName, getContributor(guest).name].some((value) =>
      value?.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())));
  const listState = deriveAsyncListState({
    hasStarted: isFetching || loadOutcome !== "idle",
    isLoading: isCurrentScopeFetching,
    itemCount: displayGuests.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });
  // Explain the narrowest active cause of an empty list and offer the matching way out.
  const emptyRoster: { message: string; action?: { label: string; run: () => void } } =
    searchQuery.trim()
      ? { message: t("noSearchResults"), action: { label: commonT("clearSearch"), run: () => changeSearch("") } }
      : rosterStatus !== "all"
        ? {
            message: t(rosterStatus === "pending" ? "noWaitingGuests" : "noCheckedGuests"),
            action: { label: t("showAllGuests"), run: () => { setRosterStatus("all"); setSelectedDJ("all"); } },
          }
        : selectedDJ !== "all"
          ? { message: t("noOwnerGuests"), action: { label: t("clearOwnerFilter"), run: () => setSelectedDJ("all") } }
          : { message: t("noGuestsForDate") };

  const showStatusFailure = (
    result: Extract<DoorStatusChangeResult, { status: "failed" }>,
    retry: () => void,
  ) => showDoorToast({
    message: result.message,
    tone: "error",
    durationMs: 10_000,
    ...(result.retryable ? { actionLabel: commonT("retry"), onAction: retry } : {}),
  });
  const checkInGuest = async (guest: Guest) => {
    const result = await handleStatusChange(guest.id, "checked", "check");
    if (result.status === "skipped") return;
    if (result.status === "failed") {
      showStatusFailure(result, () => void checkInGuest(guest));
      return;
    }
    const queued = result.status === "queued";
    setHeldGuestIds((current) => new Set(current).add(guest.id));
    setHighlightedGuestId((current) => current === guest.id ? null : current);
    showDoorToast({
      message: t(queued ? "checkedInQueuedToast" : "checkedInToast", { name: guest.name }),
      tone: queued ? "pending" : "success",
      actionLabel: commonT("undo"),
      // The undo claims the hold so rows stay put until its own result toast closes.
      onAction: () => void undoCheckIn(guest, claimHold()),
    });
  };
  const undoCheckIn = async (guest: Guest, holdToken?: number) => {
    const result = await handleStatusChange(guest.id, "pending", "undo");
    if (result.status === "failed") showStatusFailure(result, () => void undoCheckIn(guest));
    else if (result.status !== "skipped") {
      const queued = result.status === "queued";
      showDoorToast({
        message: t(queued ? "checkInUndoneQueued" : "checkInUndone", { name: guest.name }),
        tone: queued ? "pending" : "neutral",
      });
    } else if (holdToken !== undefined) releaseHeldGuestsIfLatest(holdToken);
  };

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
    <AttendanceCounter
              scope={attendanceScope}
              currentBusinessDate={businessDate}
              checkedInGuests={scopeCheckedInGuests}
              hasPendingGuestMutations={hasPendingGuestMutations}
            >
      {(attendanceActions, attendanceDetails, entryLocked, deletionLocked) => <WorkspaceShell
      contentClassName="gap-4 md:pb-8 lg:gap-6"
      footerLayer="below-mobile-dock"
      actions={<>
        {offlineScope && <WorkspaceAction icon="search" onClick={() => setTool(tool === "code" ? null : "code")} disabled={isDoorCodeLoading || isOfflineSyncing} aria-expanded={tool === "code"} aria-controls={tool === "code" ? "door-code-panel" : undefined}>{t("guestCodeLookup")}</WorkspaceAction>}
        {attendanceActions}
        {offlineScope && <WorkspaceAction icon="refresh" tone="muted" onClick={() => setTool(tool === "offline" ? null : "offline")} disabled={isDoorCodeLoading || isOfflineSyncing} aria-expanded={tool === "offline"} aria-controls={tool === "offline" ? "door-offline-panel" : undefined}>{t("offlineOperations")} {offlineQueueCounts.queued > 0 ? offlineQueueCounts.queued : ""}</WorkspaceAction>}
      </>}
    >
      {venueLoadError && (
        <VenueLoadNotice
          onRetry={refreshVenues}
          isLoading={isLoadingVenues}
        />
      )}
      <Sheet id="door-code-panel" open={tool === "code"} title={t("guestCodeLookup")} onClose={() => setTool(null)} busy={isDoorCodeLoading}>
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
                      ref={codeInputRef}
                      id="door-guest-code"
                      name="door-guest-code"
                      value={doorCode}
                      onChange={(event) => handleDoorCodeChange(event.target.value)}
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
      </Sheet>
      <Sheet id="door-offline-panel" open={tool === "offline"} title={t("offlineOperations")} onClose={() => setTool(null)} busy={isOfflineSyncing}>
                {offlineScope && (
                  <div
                    className="app-panel space-y-3 p-4 sm:p-5"
                    aria-label={t("offlineOperations")}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
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

      </Sheet>
      <OperationsLayout
        variant="stacked"
        title={commonT("door")}
        dashboard={
          <>

            <EventScopeSelector venueId={venueId} businessDate={selectedDate}
              value={selectedEventId} onChange={setSelectedEventId}
              renderScope={(selector, label) => <OperationsScope venueName={currentVenue?.brandName || currentVenue?.name} date={selectedDate} label={label}>
                <DatePicker compact value={selectedDate} onChange={(date) => { setSelectedDate(date); setSelectedEventId(null); }} businessDate={businessDate} />
                {isSuperAdmin && <VenueSelector venues={venues} selectedVenueId={selectedVenueId} onVenueChange={setSelectedVenueId} />}
                {selector}
              </OperationsScope>} />

                {!isOnline && (
                  <p className="border-l-2 border-status-waiting bg-status-waiting/10 px-3 py-2 text-xs leading-relaxed text-text-muted" role="status">
                    {t(offlineScope ? "offlineEventScope" : "offlineGeneralScope")}
                  </p>
                )}
                {/* A full load failure is explained in the list itself, next to its retry action. */}
                {feedback && loadOutcome !== "error" && <Alert type="error" message={feedback} />}

                {attendanceDetails}
                {(isOfflineMode || offlineQueueCounts.queued > 0 || hasResolvedOfflineMutations || offlineNotice) &&
                  <button type="button" className="text-left text-xs text-status-waiting" onClick={() => setTool(tool === "offline" ? null : "offline")} disabled={isDoorCodeLoading || isOfflineSyncing} aria-expanded={tool === "offline"} aria-controls={tool === "offline" ? "door-offline-panel" : undefined}>
                    {isOfflineMode ? t("offlineCachedRoster") : t("offlineOperations")} · {t("offlineQueued")} {offlineQueueCounts.queued}
                    {offlineNotice ? ` · ${t(`offlineNotice.${offlineNotice}`)}` : ""}
                  </button>}

          </>
        }
      >
            <section
              className="min-w-0"
              aria-label={t("guestList")}
              aria-busy={isCurrentScopeFetching}
            >
              <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {searchQuery.trim() && listState !== "loading" && listState !== "error"
                  ? t("searchResultCount", { count: displayGuests.length }) : ""}
              </p>
              <RosterView variant="operations" filtersActive={selectedDJ !== "all" || sortMode !== "default" || !prioritizeWaiting} filters={
                    <div className="min-w-0">
                      <label htmlFor="door-user-filter" className="sr-only">
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
              } header={<PanelHeader
                title={t("guestList")}
                headingLevel={2}
                headingId="door-guest-list-title"
                count={loadOutcome === "error" ? undefined : displayGuests.length}
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
                    className="collection-toggle-button pressable min-h-11 whitespace-nowrap border border-border-default bg-surface-raised px-3 py-2 text-xs font-medium text-text-muted"
                  >
                    <Icon name="check" size={14} className={prioritizeWaiting ? "" : "invisible"} />
                    {t("prioritizeWaiting")}
                  </button>
                }
              />} query={searchQuery} onQueryChange={changeSearch}
            status={rosterStatus} onStatusChange={setRosterStatus}
            loading={!hasCurrentScopeData || loadOutcome === "error"} counts={{ all: filteredGuests.length, pending: pendingGuests.length, checked: checkedGuests.length }}>

              {listState === "loading" ? (
                <Skeleton rows={6} />
              ) : listState === "error" ? (
                <EmptyState
                  icon="warning"
                  message={t("loadFailed")}
                  action={<Button variant="outline" size="sm" onClick={() => void loadData()}>{commonT("retry")}</Button>}
                />
              ) : displayGuests.length === 0 ? (
                <EmptyState
                  icon="user"
                  message={emptyRoster.message}
                  action={emptyRoster.action && <Button variant="outline" size="sm" onClick={emptyRoster.action.run}>{emptyRoster.action.label}</Button>}
                />
              ) : (
                // Existing rows stay visible but dimmed and inert while a foreground refresh settles.
                <div className="product-roster-rows" aria-busy={isCurrentScopeFetching}>
                  {displayGuests.map((guest, index) => {
                    const contributor = getContributor(guest);
                    return <GuestListCard
                      timeZone={currentVenue?.timezone}
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
                      showRegisteredAt
                      onDelete={canManageGuests ? () => void handleStatusChange(guest.id, "deleted", "remove") : undefined}
                      isDeleteLoading={loadingStates[`${guest.id}_remove`]}
                      deleteError={deleteFailure?.guestId === guest.id ? deleteFailure.message : undefined}
                      deleteDisabledReason={isOfflineMode || isOfflineSyncing || offlineQueueCounts.queued > 0 ? t("deleteRequiresOnline") : undefined}
                      isDeleteDisabled={deletionLocked || isCurrentScopeFetching || isOfflineMode || isOfflineSyncing || hasPendingGuestMutations}
                      onCheck={() => void checkInGuest(guest)}
                      onUndo={() => void undoCheckIn(guest)}
                      isCheckLoading={loadingStates[`${guest.id}_check`]}
                      isUndoLoading={loadingStates[`${guest.id}_undo`]}
                      isEntryDisabled={entryLocked}
                      highlighted={guest.id === highlightedGuestId}
                    />;
                  })}
                </div>
              )}
          </RosterView>
            </section>
      </OperationsLayout>

    </WorkspaceShell>}
    </AttendanceCounter>
  );
}
