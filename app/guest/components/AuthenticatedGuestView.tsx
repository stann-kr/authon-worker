"use client";

import WorkspaceAction from "@/components/workspace/WorkspaceAction";
import OperationsScope from "@/components/operations/OperationsScope";

import Sheet, { requestSheetClose } from "@/components/overlays/Sheet";
import RosterView, { type RosterStatus } from "@/components/guests/RosterView";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useLocalStorage,
  useGuestPolling,
  useLatestRequestGuard,
  useLatestRef,
} from "@/lib/hooks";

import PanelHeader from "@/components/PanelHeader";
import WorkspaceShell from "@/components/WorkspaceShell";
import VenueLoadNotice from "@/components/VenueLoadNotice";
import EmptyState from "@/components/EmptyState";
import Alert from "@/components/Alert";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import DatePicker from "@/components/DatePicker";
import Button from "@/components/Button";
import GuestBulkEntry from "@/components/GuestBulkEntry";
import GuestListCard from "@/components/GuestListCard";

import Skeleton from "@/components/Skeleton";
import OperationsLayout from "@/components/OperationsLayout";
import GuestCapacityIndicator from "@/components/GuestCapacityIndicator";
import EventScopeSelector from "@/components/EventScopeSelector";
import GuestLimitRequestPanel from "./GuestLimitRequestPanel";
import useGuestLimitRequestController, {
  type GuestLimitRequestControllerDependencies,
} from "./useGuestLimitRequestController";
import { getBusinessDate } from "@/lib/date";
import {
  createGuest,
  createGuests,
  deleteGuest,
} from "@/lib/api/guests";
import type { BulkGuestCreateInput, Guest } from "@/lib/guests/types";
import type { GuestQuota } from "@/lib/guest-limits/types";
import { createGuestLimitRequest } from "@/lib/api/guest-limits";
import { fetchGuestWorkspaceSnapshot } from "@/lib/guest-snapshots/client";
import { type User as AuthUser } from "@/lib/auth";
import {
  mergeGuestWorkspaceDisplay,
  selectGuestWorkspaceDisplay,
  type GuestWorkspaceDisplay,
} from "@/lib/guests/request-section-state";
import {
  GUEST_CREATE_ERROR_KEYS,
  selectDomainMessageKey,
} from "@/lib/api/domain-error";
import {
  deriveAsyncListState,
  shouldShowEmptyState,
} from "@/lib/ui/async-list-state";
import { useLocale, useTranslations } from "next-intl";

interface AuthenticatedGuestViewProps {
  user: AuthUser | null;
}

const GUEST_LIMIT_REQUEST_ACTIONS: GuestLimitRequestControllerDependencies =
  Object.freeze({
    createRequest: createGuestLimitRequest,
  });

export default function AuthenticatedGuestView({ user }: AuthenticatedGuestViewProps) {
  const t = useTranslations("GuestOperations");
  const commonT = useTranslations("Common");
  const tRef = useLatestRef(t);
  const locale = useLocale() as "en" | "ko";
  const [selectedDate, setSelectedDate] = useState<string>(getBusinessDate());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [guestName, setGuestName] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState<boolean>(false);
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [quota, setQuota] = useState<GuestQuota | null>(null);
  const [verifiedQuotaScopeKey, setVerifiedQuotaScopeKey] = useState("");
  const [registeredByName, setRegisteredByName] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guest:sortMode",
    "default",
  );

  // 날짜별 화면 데이터를 보존해 날짜 전환 중 다른 날짜의 상태가 섞이지 않게 합니다.
  const displayCacheRef = useRef<Map<string, GuestWorkspaceDisplay>>(new Map());

  // super_admin venue selector
  const {
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    currentVenue,
    isLoadingVenues,
    venueLoadError,
    refreshVenues,
  } = useVenueSelector();

  const effectiveVenueId = isSuperAdmin
    ? selectedVenueId
    : (user?.venue_id ?? "");
  const businessDate = getBusinessDate(currentVenue ?? {});
  const requestScopeKey = `${effectiveVenueId}:${selectedDate}:${selectedEventId ?? "general"}`;
  const requestGuard = useLatestRequestGuard();
  const pollingGuard = useLatestRequestGuard();
  const currentScopeKeyRef = useRef(requestScopeKey);

  useEffect(() => {
    currentScopeKeyRef.current = requestScopeKey;
    setLoadOutcome("idle");
  }, [requestScopeKey]);

  useEffect(() => {
    if (!isFetching && loadedScopeKey === requestScopeKey) {
      displayCacheRef.current.set(requestScopeKey, { guests, quota });
    }
  }, [guests, isFetching, loadedScopeKey, quota, requestScopeKey]);

  const hasLoadedCurrentScope = loadedScopeKey === requestScopeKey;
  const displayWorkspace = selectGuestWorkspaceDisplay({
    scopeKey: requestScopeKey,
    loadedScopeKey,
    liveDisplay: { guests, quota },
    cache: displayCacheRef.current,
    preferCachedDisplay: isFetching,
  });
  const hasCurrentScopeData = displayWorkspace !== null;
  const isCurrentScopeFetching = isFetching || !hasLoadedCurrentScope;
  const displayDataGuests = displayWorkspace?.guests ?? [];
  const displayQuota = displayWorkspace?.quota ?? null;

  useEffect(() => {
    if (currentVenue) setSelectedDate(businessDate);
  }, [businessDate, currentVenue]);

  useEffect(() => {
    setSelectedEventId(null);
  }, [effectiveVenueId, selectedDate]);

  useEffect(() => {
    if (user?.account_kind !== "shared") return;
    const stored = window.sessionStorage.getItem(`shared-operator:${user.id}`);
    if (stored) setRegisteredByName(stored);
  }, [user]);

  const loadGuests = useCallback(async (options?: { silent?: boolean }) => {
    pollingGuard.invalidateRequests();
    const isLatestRequest = requestGuard.beginRequest();
    if (!effectiveVenueId) {
      const emptyDisplay: GuestWorkspaceDisplay = { guests: [], quota: null };
      displayCacheRef.current.set(requestScopeKey, emptyDisplay);
      setGuests(emptyDisplay.guests);
      setQuota(emptyDisplay.quota);
      setVerifiedQuotaScopeKey("");
      setLoadedScopeKey(requestScopeKey);
      setLoadOutcome("success");
      setIsFetching(false);
      return true;
    }
    if (!options?.silent) setIsFetching(true);
    setError(null);

    try {
      const { data, error: fetchError } = await fetchGuestWorkspaceSnapshot(
        selectedDate,
        effectiveVenueId,
        selectedEventId,
      );

      if (!isLatestRequest()) return;

      if (fetchError) {
        console.error("Failed to fetch guests:", fetchError);
        setError(tRef.current("loadFailed"));
      }
      setLoadOutcome(fetchError ? (data ? "partial" : "error") : "success");

      const previousDisplay = displayCacheRef.current.get(requestScopeKey) ?? null;
      const nextDisplay = data
        ? mergeGuestWorkspaceDisplay(previousDisplay, data)
        : (previousDisplay ?? { guests: [], quota: null });

      displayCacheRef.current.set(requestScopeKey, nextDisplay);
      setGuests(nextDisplay.guests);
      setQuota(nextDisplay.quota);
      setVerifiedQuotaScopeKey(
        data && !data.failedSections.includes("quota") ? requestScopeKey : "",
      );
      setLoadedScopeKey(requestScopeKey);
      return !fetchError && data !== null;
    } catch (loadError) {
      if (!isLatestRequest()) return;
      console.error("Failed to fetch guests:", loadError);
      const fallbackDisplay = displayCacheRef.current.get(requestScopeKey) ?? {
        guests: [],
        quota: null,
      };
      displayCacheRef.current.set(requestScopeKey, fallbackDisplay);
      setGuests(fallbackDisplay.guests);
      setQuota(fallbackDisplay.quota);
      setVerifiedQuotaScopeKey("");
      setLoadedScopeKey(requestScopeKey);
      setError(tRef.current("loadFailed"));
      setLoadOutcome(fallbackDisplay.guests.length > 0 ? "partial" : "error");
      return false;
    } finally {
      if (isLatestRequest()) setIsFetching(false);
    }
  }, [effectiveVenueId, pollingGuard, requestGuard, requestScopeKey, selectedDate, selectedEventId, tRef]);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  // 주기적으로 데이터 갱신 (15초)
  const pollGuests = useCallback(async () => {
    if (!effectiveVenueId || loadedScopeKey !== requestScopeKey) return;
    const isLatestRequest = pollingGuard.beginRequest();
    const { data } = await fetchGuestWorkspaceSnapshot(
      selectedDate,
      effectiveVenueId,
      selectedEventId,
    );
    if (isLatestRequest() && loadedScopeKey === requestScopeKey) {
      if (data) {
        if (!data.failedSections.includes("guests")) {
          setGuests(data.guests);
        }
        if (!data.failedSections.includes("quota")) {
          setQuota(data.quota);
          setVerifiedQuotaScopeKey(requestScopeKey);
        } else {
          setVerifiedQuotaScopeKey("");
        }
      } else {
        setVerifiedQuotaScopeKey("");
      }
    }
  }, [effectiveVenueId, loadedScopeKey, pollingGuard, requestScopeKey, selectedDate, selectedEventId]);

  useGuestPolling(pollGuests, 15000, !!effectiveVenueId && !isFetching && !isLoading && !isBulkSubmitting);

  const guestLimitRequestController = useGuestLimitRequestController({
    user,
    requestScopeKey,
    selectedDate,
    selectedEventId,
    quota: displayQuota,
    hasCurrentScopeData,
    hasVerifiedCurrentQuota: verifiedQuotaScopeKey === requestScopeKey,
    isCurrentScopeFetching,
    invalidatePolling: pollingGuard.invalidateRequests,
    loadGuests,
    setError,
    translate: (key, values) => t(key, values),
    commonTranslate: (key, values) => commonT(key, values),
    dependencies: GUEST_LIMIT_REQUEST_ACTIONS,
  });

  const handleSave = async () => {
    if (!guestName.trim() || isLoading || isBulkSubmitting) return;

    const operationScopeKey = requestScopeKey;
    pollingGuard.invalidateRequests();

    if (!effectiveVenueId) {
      console.error("No venue ID available");
      setError(t("selectVenue"));
      return;
    }

    setIsLoading(true);
    setError(null);

    if (user?.account_kind === "shared" && !registeredByName.trim()) {
      setError(t("registeredByRequired"));
      setIsLoading(false);
      return;
    }

    let actionFeedback: string | null = null;
    try {
      const { data, error: createError } = await createGuest({
        venueId: effectiveVenueId,
        name: guestName.trim().toUpperCase(),
        date: selectedDate,
        eventId: selectedEventId,
        registeredByName:
          user?.account_kind === "shared" ? registeredByName.trim() : null,
      });

      if (currentScopeKeyRef.current !== operationScopeKey) return;

      if (createError) {
        console.error("Failed to create guest:", createError);
        actionFeedback = t(
          selectDomainMessageKey(
            createError,
            GUEST_CREATE_ERROR_KEYS,
            "registerResultUnknown",
          ),
        );
      } else if (data) {
        setGuests((prev) => [...prev, data]);
        setGuestName("");
      } else {
        actionFeedback = t("registerResultUnknown");
      }
    } catch (createError) {
      if (currentScopeKeyRef.current === operationScopeKey) {
        console.error("Failed to create guest:", createError);
        actionFeedback = t("registerResultUnknown");
      }
    } finally {
      if (currentScopeKeyRef.current === operationScopeKey) {
        const refreshed = await loadGuests({ silent: true });
        if (refreshed === true && actionFeedback) setError(actionFeedback);
      }
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const operationScopeKey = requestScopeKey;
    pollingGuard.invalidateRequests();
    setIsLoading(true);
    setError(null);

    let actionFeedback: string | null = null;
    try {
      const { data, error: deleteError } = await deleteGuest(id);

      if (currentScopeKeyRef.current !== operationScopeKey) return;

      if (deleteError) {
        console.error("Failed to delete guest:", deleteError);
        actionFeedback = t("deleteFailed");
      } else if (data) {
        setGuests((prev) =>
          prev.map((guest) => (guest.id === id ? data : guest)),
        );
      }
    } catch (deleteError) {
      if (currentScopeKeyRef.current === operationScopeKey) {
        console.error("Failed to delete guest:", deleteError);
        actionFeedback = t("deleteResultUnknown");
      }
    } finally {
      if (currentScopeKeyRef.current === operationScopeKey) {
        const refreshed = await loadGuests({ silent: true });
        if (refreshed === true && actionFeedback) setError(actionFeedback);
      }
      setIsLoading(false);
    }
  };

  const handleBulkSave = async (bulkGuests: BulkGuestCreateInput[]) => {
    const operationScopeKey = requestScopeKey;
    pollingGuard.invalidateRequests();
    setError(null);

    if (!effectiveVenueId) {
      setError(t("selectVenue"));
      return { data: null, error: "VENUE_REQUIRED" };
    }

    if (user?.account_kind === "shared" && !registeredByName.trim()) {
      setError(t("registeredByRequired"));
      return { data: null, error: "REGISTERED_BY_REQUIRED" };
    }

    const response = await createGuests({
      venueId: effectiveVenueId,
      date: selectedDate,
      eventId: selectedEventId,
      registeredByName:
        user?.account_kind === "shared" ? registeredByName.trim() : null,
      items: bulkGuests,
    });

    if (currentScopeKeyRef.current !== operationScopeKey) return response;

    if (response.data) {
      const createdGuests = response.data.items.flatMap((item) =>
        item.status === "created" && item.guest ? [item.guest] : [],
      );
      if (createdGuests.length > 0) {
        setGuests((current) => [...current, ...createdGuests]);
      }
    }

    return response;
  };

  const filteredGuests = displayDataGuests.filter(
    (guest) =>
      guest.date === selectedDate && guest.createdByUserId === user?.id,
  );

  const pendingGuests = filteredGuests.filter((g) => g.status === "pending");
  const checkedGuests = filteredGuests.filter((g) => g.status === "checked");
  const activeGuestsCount = filteredGuests.filter((g) => g.status !== "deleted").length;

  const effectiveLimit = displayQuota?.effectiveLimit ?? user?.guest_limit ?? null;
  const remaining = displayQuota?.remaining ??
    (effectiveLimit === null ? null : Math.max(0, effectiveLimit - activeGuestsCount));
  const isAtLimit = remaining !== null && remaining <= 0;

  const handleOperatorChange = (value: string) => {
    setRegisteredByName(value);
    if (!user) return;
    if (value.trim()) {
      window.sessionStorage.setItem(`shared-operator:${user.id}`, value);
    } else {
      window.sessionStorage.removeItem(`shared-operator:${user.id}`);
    }
  };

  const sortGuestsByName = (list: Guest[]) => {
    return [...list].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", locale === "ko" ? "ko-KR" : "en-US", {
        sensitivity: "base",
      }),
    );
  };

  const sortGuestsByCreatedAt = (list: Guest[]) => {
    return [...list].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
  };

  const sortedGuests =
    sortMode === "alpha"
      ? sortGuestsByName(filteredGuests)
      : sortGuestsByCreatedAt(filteredGuests);

  const displayGuests = sortedGuests.filter((guest) =>
    (rosterStatus === "all" || guest.status === rosterStatus) &&
    [guest.name, guest.registeredByName].some((value) =>
      value?.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())));
  const listState = deriveAsyncListState({
    hasStarted: isFetching || loadOutcome !== "idle",
    isLoading: isCurrentScopeFetching,
    itemCount: displayGuests.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });

  return (
    <WorkspaceShell contentClassName="gap-4 pb-8 lg:gap-6" actions={
      <WorkspaceAction icon="add" onClick={() => entryOpen ? requestSheetClose("guest-entry-panel") : setEntryOpen(true)} aria-expanded={entryOpen} aria-controls={entryOpen ? "guest-entry-panel" : undefined}>{t("addGuest")}</WorkspaceAction>
    }>
      {venueLoadError && (
        <VenueLoadNotice
          onRetry={refreshVenues}
          isLoading={isLoadingVenues}
        />
      )}
      <Sheet id="guest-entry-panel" open={entryOpen} title={t("addGuest")} onClose={() => {
        setEntryOpen(false); setGuestName("");
        guestLimitRequestController.updateRequestDraft({ requestedExtra: "1", requestReason: "" });
      }}
        busy={isLoading || isBulkSubmitting || guestLimitRequestController.isRequestingExtra} protectEdits dirty={Boolean(guestName.trim())}>
                  <div className="relative flex items-center justify-end border-b border-border-subtle pb-3">
                    <GuestCapacityIndicator
                      label={t("remaining")}
                      remaining={remaining}
                      limit={effectiveLimit}
                    />
                  </div>

                  <div className="space-y-4">
                    {error && <Alert type="error" message={error} />}
                    {user?.account_kind === "shared" && (
                      <div className="mb-3">
                        <label htmlFor="shared-operator-name" className="app-label">
                          {t("registeredBy")}
                        </label>
                        <input
                          id="shared-operator-name"
                          name="shared-operator-name"
                          data-preserve-on-close
                          type="text"
                          value={registeredByName}
                          onChange={(event) => handleOperatorChange(event.target.value)}
                          placeholder={t("registeredByPlaceholder")}
                          maxLength={80}
                          autoComplete="off"
                          aria-required="true"
                          aria-describedby="shared-operator-help"
                          disabled={isBulkSubmitting}
                          className="app-field"
                        />
                        <p id="shared-operator-help" className="app-helper">
                          {t("registeredByHelp")}
                        </p>
                      </div>
                    )}

                    {!isAtLimit ? (
                      <form
                        className="flex flex-col gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleSave();
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <label htmlFor="authenticated-guest-name" className="app-label">
                            {t("guestName")}
                          </label>
                          <input
                            id="authenticated-guest-name"
                            name="guest-name"
                            type="text"
                            value={guestName}
                            onChange={(event) => setGuestName(event.target.value)}
                            placeholder={t("enterFullName")}
                            maxLength={100}
                            autoComplete="off"
                            disabled={isLoading || isBulkSubmitting}
                            className="app-field min-h-11"
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={!guestName.trim() || isLoading || isBulkSubmitting}
                          isLoading={isLoading}
                          size="lg"
                          fullWidth
                        >
                          {t("addGuest")}
                        </Button>
                      </form>
                    ) : (
                      <div className="border-l-2 border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
                        {t("limitReached", {
                          used: displayQuota?.used ?? activeGuestsCount,
                          max: effectiveLimit ?? 0,
                        })}
                      </div>
                    )}

                    <GuestBulkEntry
                      key={requestScopeKey}
                      existingNames={filteredGuests.map((guest) => guest.name)}
                      remaining={remaining}
                      disabled={
                        isLoading ||
                        !effectiveVenueId ||
                        (user?.account_kind === "shared" &&
                          !registeredByName.trim())
                      }
                      onSubmitChunk={handleBulkSave}
                      onSubmissionComplete={async () => {
                        if (currentScopeKeyRef.current === requestScopeKey) {
                          await loadGuests({ silent: true });
                        }
                      }}
                      onSubmittingChange={setIsBulkSubmitting}
                    />

                    <GuestLimitRequestPanel
                      requestScopeKey={requestScopeKey}
                      pendingRequest={displayQuota?.pendingRequest ?? null}
                      translate={(key, values) => t(key, values)}
                      controller={guestLimitRequestController}
                    />
                  </div>
      </Sheet>
      <OperationsLayout
        variant="stacked"
        title={commonT("guest")}
        dashboard={
          <>
                <EventScopeSelector venueId={effectiveVenueId} businessDate={selectedDate}
                  value={selectedEventId} onChange={setSelectedEventId} disabled={isBulkSubmitting}
                  renderScope={(selector, label) => <OperationsScope venueName={currentVenue?.brandName || currentVenue?.name} date={selectedDate} label={label} disabled={isBulkSubmitting}>
                    <DatePicker compact value={selectedDate} onChange={setSelectedDate} businessDate={businessDate} disabled={isBulkSubmitting} />
                    {isSuperAdmin && <VenueSelector venues={venues} selectedVenueId={selectedVenueId} onVenueChange={setSelectedVenueId} disabled={isBulkSubmitting} />}
                    {selector}
                  </OperationsScope>} />

                {error && <Alert type="error" message={error} />}

          </>
        }
      >
            <section
              className="min-w-0"
              aria-label={t("todaysGuests")}
              aria-busy={isCurrentScopeFetching}
            >
              <dl className="product-roster-quota">
                <div><dt>{commonT("registered")}</dt><dd>{hasCurrentScopeData ? (displayQuota?.used ?? activeGuestsCount) : "—"}</dd></div>
                <div><dt>{t("remaining")}</dt><dd>{hasCurrentScopeData ? (remaining ?? "∞") : "—"}</dd></div>
              </dl>
              <RosterView filtersActive={sortMode !== "default"} header={<PanelHeader
                title={t("todaysGuests")}
                headingLevel={2}
                headingId="guest-list-title"
                count={displayGuests.length}
                sortMode={sortMode}
                onSortToggle={() =>
                  setSortMode((prev) =>
                    prev === "default" ? "alpha" : "default",
                  )
                }
                onRefresh={loadGuests}
                isLoading={isCurrentScopeFetching}
              />} query={searchQuery} onQueryChange={setSearchQuery}
            status={rosterStatus} onStatusChange={setRosterStatus}
            loading={!hasCurrentScopeData} counts={{ all: filteredGuests.length, pending: pendingGuests.length, checked: checkedGuests.length }}>

              {listState === "loading" ? (
                <Skeleton rows={5} />
              ) : shouldShowEmptyState(listState) ? (
                <EmptyState
                  icon="user-add"
                  message={
                    searchQuery || rosterStatus !== "all"
                      ? t("noSearchResults")
                      : t("noGuestsForDate")
                  }
                />
              ) : (
                <div
                  className={`product-roster-rows ${
                    isCurrentScopeFetching ? "pointer-events-none" : ""
                  }`}
                >
                  {displayGuests.map((guest, index) => (
                    <GuestListCard
                      key={guest.id}
                      guest={guest}
                      index={index}
                      mode="registration"
                      accountKind={user?.account_kind}
                      registeredByName={guest.registeredByName}
                      onDelete={
                        guest.status === "pending"
                          ? () => handleDelete(guest.id)
                          : undefined
                      }
                      isDeleteLoading={isLoading}
                      isDeleteDisabled={isBulkSubmitting}
                    />
                  ))}
                </div>
              )}
          </RosterView>
            </section>
      </OperationsLayout>

    </WorkspaceShell>
  );
}
