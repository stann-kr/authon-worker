"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useLocalStorage,
  useGuestPolling,
  useLatestRequestGuard,
  useLatestRef,
} from "@/lib/hooks";
import StatGrid from "@/components/StatGrid";
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
import GuestSearchInput from "@/components/GuestSearchInput";
import Skeleton from "@/components/Skeleton";
import OperationsLayout from "@/components/OperationsLayout";
import DisclosureSection from "@/components/DisclosureSection";
import GuestCapacityIndicator from "@/components/GuestCapacityIndicator";
import EventScopeSelector from "@/components/EventScopeSelector";
import { useSectionLoadingTask } from "@/components/RouteTransitionProvider";
import { getBusinessDate } from "@/lib/date";
import {
  createGuest,
  createGuests,
  deleteGuest,
} from "@/lib/api/guests";
import type { BulkGuestCreateInput, Guest } from "@/lib/api/types";
import type { GuestQuota } from "@/lib/api/types";
import {
  createGuestLimitRequest,
} from "@/lib/api/guest-limits";
import { fetchGuestWorkspaceSnapshot } from "@/lib/api/guest-snapshots";
import { type User as AuthUser } from "@/lib/auth";
import {
  canEditGuestLimitRequestDraft,
  canSubmitGuestLimitRequest,
  DEFAULT_GUEST_LIMIT_REQUEST_DRAFT,
  getScopedGuestLimitRequestDraft,
  getGuestLimitRequestSectionState,
  mergeGuestWorkspaceDisplay,
  resetScopedGuestLimitRequestDraft,
  selectGuestWorkspaceDisplay,
  type GuestLimitRequestDraft,
  type GuestWorkspaceDisplay,
} from "@/lib/guests/request-section-state";
import { canRequestGuestLimit } from "@/lib/users/policy";
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

export default function AuthenticatedGuestView({ user }: AuthenticatedGuestViewProps) {
  const t = useTranslations("GuestOperations");
  const commonT = useTranslations("Common");
  const tRef = useLatestRef(t);
  const locale = useLocale() as "en" | "ko";
  const [selectedDate, setSelectedDate] = useState<string>(getBusinessDate());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
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
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [quota, setQuota] = useState<GuestQuota | null>(null);
  const [verifiedQuotaScopeKey, setVerifiedQuotaScopeKey] = useState("");
  const [registeredByName, setRegisteredByName] = useState("");
  const [requestDrafts, setRequestDrafts] = useState<
    Record<string, GuestLimitRequestDraft>
  >({});
  const [requestingScopeKeys, setRequestingScopeKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guest:sortMode",
    "default",
  );

  // 날짜별 화면 데이터를 보존해 날짜 전환 중 다른 날짜의 상태가 섞이지 않게 합니다.
  const displayCacheRef = useRef<Map<string, GuestWorkspaceDisplay>>(new Map());
  const requestSummaryRef = useRef<HTMLElement>(null);
  const pendingRequestStatusRef = useRef<HTMLDivElement>(null);

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
  const requestDraft = getScopedGuestLimitRequestDraft(
    requestDrafts,
    requestScopeKey,
  );
  const isRequestingExtra = requestingScopeKeys.has(requestScopeKey);
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
  useSectionLoadingTask(isCurrentScopeFetching);
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

  useGuestPolling(pollGuests, 15000, !!effectiveVenueId);

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
  const isGuestLimitRequestEligible = Boolean(
    user &&
      canRequestGuestLimit({
        role: user.role,
        accountKind: user.account_kind,
        doorAccessEnabled: user.door_access_enabled,
      }),
  );
  const requestSectionState = getGuestLimitRequestSectionState({
    isEligible: isGuestLimitRequestEligible,
    hasCurrentScopeData,
    canRequestExtra: displayQuota?.canRequestExtra === true,
    hasPendingRequest: Boolean(displayQuota?.pendingRequest),
  });
  const hasVerifiedCurrentQuota = verifiedQuotaScopeKey === requestScopeKey;
  const isRequestDisclosureDisabled = !canEditGuestLimitRequestDraft(
    requestSectionState,
  );
  const isRequestSubmissionDisabled = !canSubmitGuestLimitRequest({
    sectionState: requestSectionState,
    hasVerifiedQuota: hasVerifiedCurrentQuota,
    isScopeFetching: isCurrentScopeFetching,
  });
  const requestSectionMeta =
    requestSectionState === "loading" || isCurrentScopeFetching
      ? commonT("loading")
      : !hasVerifiedCurrentQuota
        ? t("requestUnavailable")
        : requestSectionState === "unavailable"
          ? displayQuota?.baseLimit === null
            ? t("requestNotNeeded")
            : t("requestUnavailable")
          : undefined;

  const updateRequestDraft = (patch: Partial<GuestLimitRequestDraft>) => {
    setRequestDrafts((current) => ({
      ...current,
      [requestScopeKey]: {
        ...(current[requestScopeKey] ?? DEFAULT_GUEST_LIMIT_REQUEST_DRAFT),
        ...patch,
      },
    }));
  };

  const handleOperatorChange = (value: string) => {
    setRegisteredByName(value);
    if (!user) return;
    if (value.trim()) {
      window.sessionStorage.setItem(`shared-operator:${user.id}`, value);
    } else {
      window.sessionStorage.removeItem(`shared-operator:${user.id}`);
    }
  };

  const handleExtraRequest = async () => {
    if (isRequestingExtra || isRequestSubmissionDisabled) return;

    const operationScopeKey = requestScopeKey;
    const shouldRestoreRequestFocus = Boolean(
      requestSummaryRef.current?.parentElement?.contains(document.activeElement),
    );
    pollingGuard.invalidateRequests();
    const extra = Number.parseInt(requestDraft.requestedExtra, 10);
    setRequestingScopeKeys((current) => {
      const next = new Set(current);
      next.add(operationScopeKey);
      return next;
    });
    setError(null);
    try {
      const { error: requestError } = await createGuestLimitRequest({
        date: selectedDate,
        eventId: selectedEventId,
        requestedExtra: extra,
        reason: requestDraft.requestReason,
      });
      if (!requestError) {
        setRequestDrafts((current) =>
          resetScopedGuestLimitRequestDraft(current, operationScopeKey),
        );
      }
      if (currentScopeKeyRef.current !== operationScopeKey) return;
      if (requestError) {
        setError(
          requestError === "PENDING_REQUEST_EXISTS"
            ? t("requestAlreadyPending")
            : t("requestFailed"),
        );
      } else {
        await loadGuests({ silent: true });
      }
    } catch (requestError) {
      if (currentScopeKeyRef.current === operationScopeKey) {
        console.error("Failed to request additional guests:", requestError);
        setError(t("requestFailed"));
      }
    } finally {
      setRequestingScopeKeys((current) => {
        const next = new Set(current);
        next.delete(operationScopeKey);
        return next;
      });
      if (shouldRestoreRequestFocus) {
        requestAnimationFrame(() => {
          if (currentScopeKeyRef.current !== operationScopeKey) return;
          if (
            document.activeElement &&
            document.activeElement !== document.body
          ) {
            return;
          }
          (pendingRequestStatusRef.current ?? requestSummaryRef.current)?.focus();
        });
      }
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
      
  const displayGuests = searchQuery
    ? sortedGuests.filter((g) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedGuests;
  const listState = deriveAsyncListState({
    hasStarted: isFetching || loadOutcome !== "idle",
    isLoading: isCurrentScopeFetching,
    itemCount: displayGuests.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });

  return (
    <WorkspaceShell contentClassName="gap-4 pb-8 lg:gap-6">
      {venueLoadError && (
        <VenueLoadNotice
          onRetry={refreshVenues}
          isLoading={isLoadingVenues}
        />
      )}
      <OperationsLayout
        title={commonT("guest")}
        dashboard={
          <>
                <div className="context-bar">
                  <DatePicker
                    value={selectedDate}
                    onChange={setSelectedDate}
                    businessDate={businessDate}
                    disabled={isBulkSubmitting}
                  />
                  <EventScopeSelector
                    venueId={effectiveVenueId}
                    businessDate={selectedDate}
                    value={selectedEventId}
                    onChange={setSelectedEventId}
                    disabled={isBulkSubmitting}
                  />
                  {isSuperAdmin && (
                    <div className="context-filter-grid">
                      <VenueSelector
                        venues={venues}
                        selectedVenueId={selectedVenueId}
                        onVenueChange={setSelectedVenueId}
                        disabled={isBulkSubmitting}
                      />
                    </div>
                  )}
                </div>

                {error && <Alert type="error" message={error} />}

                <section className="app-panel" aria-labelledby="add-guest-title">
                  <div className="relative flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-3 sm:px-5">
                    <h2 id="add-guest-title" className="type-panel-title">
                      {t("addGuest")}
                    </h2>
                    <GuestCapacityIndicator
                      label={t("remaining")}
                      remaining={remaining}
                      limit={effectiveLimit}
                    />
                  </div>

                  <div className="px-4 py-4 sm:px-5">
                    {user?.account_kind === "shared" && (
                      <div className="mb-3">
                        <label htmlFor="shared-operator-name" className="app-label">
                          {t("registeredBy")}
                        </label>
                        <input
                          id="shared-operator-name"
                          name="shared-operator-name"
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

                    {requestSectionState !== "hidden" ? (
                      <>
                        <DisclosureSection
                          key={requestScopeKey}
                          title={t("requestExtra")}
                          summaryElementRef={requestSummaryRef}
                          meta={
                            requestSectionMeta ? (
                              <span role="status" aria-live="polite">
                                {requestSectionMeta}
                              </span>
                            ) : undefined
                          }
                          disabled={isRequestDisclosureDisabled}
                          isLoading={
                            requestSectionState === "loading" || isCurrentScopeFetching
                          }
                        >
                          <div className="space-y-3">
                            <div>
                              <label htmlFor="extra-guest-count" className="app-label">
                                {t("requestCount")}
                              </label>
                              <input
                                id="extra-guest-count"
                                name="extra-guest-count"
                                type="number"
                                min="1"
                                max="10"
                                value={requestDraft.requestedExtra}
                                onChange={(event) =>
                                  updateRequestDraft({ requestedExtra: event.target.value })
                                }
                                disabled={isRequestDisclosureDisabled}
                                autoComplete="off"
                                className="app-field"
                              />
                            </div>
                            <div>
                              <label htmlFor="extra-guest-reason" className="app-label">
                                {t("requestReasonOptional")}
                              </label>
                              <textarea
                                id="extra-guest-reason"
                                name="extra-guest-reason"
                                value={requestDraft.requestReason}
                                onChange={(event) =>
                                  updateRequestDraft({ requestReason: event.target.value })
                                }
                                maxLength={200}
                                rows={2}
                                disabled={isRequestDisclosureDisabled}
                                autoComplete="off"
                                className="app-field"
                              />
                            </div>
                            <Button
                              type="button"
                              onClick={handleExtraRequest}
                              isLoading={isRequestingExtra}
                              disabled={
                                isRequestSubmissionDisabled ||
                                !Number.isInteger(Number(requestDraft.requestedExtra)) ||
                                Number(requestDraft.requestedExtra) < 1 ||
                                Number(requestDraft.requestedExtra) > 10
                              }
                              fullWidth
                            >
                              {t("submitRequest")}
                            </Button>
                          </div>
                        </DisclosureSection>

                        {requestSectionState === "pending" &&
                        displayQuota?.pendingRequest ? (
                          <div
                            ref={pendingRequestStatusRef}
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                            tabIndex={-1}
                            className="mt-2 bg-status-waiting/10 px-3 py-3 text-xs leading-relaxed text-status-waiting"
                          >
                            {t("requestPending", {
                              count: displayQuota.pendingRequest.requestedExtra,
                            })}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </section>

          </>
        }
      >
            <section
              className="main-content-panel"
              aria-labelledby="guest-list-title"
              aria-busy={isCurrentScopeFetching}
            >
              <PanelHeader
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
                    value: activeGuestsCount,
                    color: "default",
                  },
                ]}
              />

              {listState === "loading" ? (
                <Skeleton rows={5} />
              ) : shouldShowEmptyState(listState) ? (
                <EmptyState
                  icon="user-add"
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
                  {displayGuests.map((guest, index) => (
                    <GuestListCard
                      key={guest.id}
                      guest={guest}
                      index={index}
                      mode="registration"
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
            </section>
      </OperationsLayout>
    </WorkspaceShell>
  );
}
