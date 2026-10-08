"use client";

import WorkspaceAction from "@/components/workspace/WorkspaceAction";
import OperationsScope from "@/components/operations/OperationsScope";

import Sheet, { requestSheetClose } from "@/components/overlays/Sheet";
import { confirmWorkspaceNavigation } from "@/components/overlays/navigation-guard";
import "./guest-entry.css";
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
import { formatDateDisplay, getBusinessDate } from "@/lib/date";
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
  const eventScopeT = useTranslations("EventScope");
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
  const [operatorError, setOperatorError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [lastAddedName, setLastAddedName] = useState<string | null>(null);
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  const guestNameInputRef = useRef<HTMLInputElement>(null);
  const operatorInputRef = useRef<HTMLInputElement>(null);
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

  const isSharedAccount = user?.account_kind === "shared";

  /** 공용 계정은 단건·여러 이름 등록 모두 현재 입력자 이름이 있어야 합니다. */
  const requireOperatorName = () => {
    if (!isSharedAccount || registeredByName.trim()) return true;
    setOperatorError(true);
    operatorInputRef.current?.focus();
    return false;
  };

  const createSingleGuest = async (
    name: string,
    allowDuplicate: boolean,
  ): Promise<{ data: Guest | null; error: string | null }> => {
    const params = {
      venueId: effectiveVenueId,
      name,
      date: selectedDate,
      eventId: selectedEventId,
      registeredByName: isSharedAccount ? registeredByName.trim() : null,
    };
    if (!allowDuplicate) return createGuest(params);

    // 사용자가 중복을 확인한 단건은 여러 이름 등록과 같은 명시적 중복 허용 경로를 씁니다.
    const response = await createGuests({
      venueId: params.venueId,
      date: params.date,
      eventId: params.eventId,
      registeredByName: params.registeredByName,
      items: [{ name, allowDuplicate: true }],
    });
    if (response.error || !response.data) {
      return { data: null, error: response.error };
    }
    const [result] = response.data.items;
    if (result?.status === "created" && result.guest) {
      return { data: result.guest, error: null };
    }
    if (result?.status === "limit_reached") {
      return { data: null, error: "GUEST_LIMIT_REACHED" };
    }
    if (result?.status === "invalid_name") {
      return { data: null, error: "INVALID_GUEST_NAME" };
    }
    return { data: null, error: "Unable to create guest right now." };
  };

  const handleSave = async (allowDuplicate = false) => {
    if (!guestName.trim() || isLoading || isBulkSubmitting) return;

    const operationScopeKey = requestScopeKey;
    pollingGuard.invalidateRequests();

    if (!effectiveVenueId) {
      console.error("No venue ID available");
      setError(t("selectVenue"));
      return;
    }

    if (!requireOperatorName()) return;

    setIsLoading(true);
    setError(null);
    setDuplicateName(null);
    setLastAddedName(null);

    const submittedName = guestName.trim().toUpperCase();
    let actionFeedback: string | null = null;
    let duplicateCandidate: string | null = null;
    try {
      const { data, error: createError } = await createSingleGuest(
        submittedName,
        allowDuplicate,
      );

      if (currentScopeKeyRef.current !== operationScopeKey) return;

      if (createError === "DUPLICATE_REQUIRES_CONFIRMATION") {
        duplicateCandidate = submittedName;
      } else if (createError) {
        const feedbackKey = selectDomainMessageKey(
          createError,
          GUEST_CREATE_ERROR_KEYS,
          "registerResultUnknown",
        );
        // Known domain answers such as a reached limit are explained on screen, not logged as failures.
        if (feedbackKey === "registerResultUnknown") {
          console.error("Failed to create guest:", createError);
        }
        actionFeedback = t(feedbackKey);
      } else if (data) {
        setGuests((prev) => [...prev, data]);
        setGuestName("");
        setLastAddedName(data.name);
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
        if (refreshed === true && duplicateCandidate) {
          setDuplicateName(duplicateCandidate);
        }
      }
      setIsLoading(false);
      if (currentScopeKeyRef.current === operationScopeKey) {
        // 추가 버튼이 잠시 비활성화되어 focus를 잃으므로 다음 이름 입력으로 되돌립니다.
        window.requestAnimationFrame(() => guestNameInputRef.current?.focus());
      }
    }
  };

  const handleDelete = async (id: string) => {
    const operationScopeKey = requestScopeKey;
    pollingGuard.invalidateRequests();
    setIsLoading(true);
    setDeletingId(id);
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
      setDeletingId(null);
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

    if (!requireOperatorName()) {
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
    if (value.trim()) setOperatorError(false);
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

  const resetEntryFeedback = () => {
    setDuplicateName(null);
    setLastAddedName(null);
    setOperatorError(false);
  };

  const handleGuestNameChange = (value: string) => {
    setGuestName(value);
    // 중복 확인은 확인한 이름에만 적용되므로 이름이 바뀌면 해제합니다.
    setDuplicateName(null);
  };

  const changeRegistrationScope = (change: () => void) => {
    if (!confirmWorkspaceNavigation()) return;
    setEntryOpen(false);
    setGuestName("");
    resetEntryFeedback();
    guestLimitRequestController.updateRequestDraft({ requestedExtra: "1", requestReason: "" });
    change();
  };

  const renderGuestEntry = (scopeLabel: string) => (
      <Sheet id="guest-entry-panel" presentation="inline" size="form" revealOnOpen open={entryOpen} title={t("addGuest")} onClose={() => {
        setEntryOpen(false); setGuestName(""); resetEntryFeedback();
        guestLimitRequestController.updateRequestDraft({ requestedExtra: "1", requestReason: "" });
      }}
        busy={isLoading || isBulkSubmitting || guestLimitRequestController.isRequestingExtra} protectEdits dirty={Boolean(guestName.trim())}>
                  <div className="guest-entry-context">
                  <dl className="guest-entry-scope" aria-label={t("registrationContext")}>
                    <div><dt>{t("date")}</dt><dd><time dateTime={selectedDate}>{formatDateDisplay(selectedDate, locale)}</time></dd></div>
                    <div><dt>{commonT("venue")}</dt><dd>{currentVenue?.brandName || currentVenue?.name || "—"}</dd></div>
                    <div><dt>{eventScopeT("label")}</dt><dd>{scopeLabel}</dd></div>
                  </dl>

                    <GuestCapacityIndicator
                      label={t("remaining")}
                      remaining={remaining}
                      limit={effectiveLimit}
                    />
                  </div>

                  <div className="space-y-4">
                    {error && <Alert type="error" message={error} />}
                    {isSharedAccount && (
                      <div className="mb-3">
                        <label htmlFor="shared-operator-name" className="app-label">
                          {t("registeredBy")}
                        </label>
                        <input
                          ref={operatorInputRef}
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
                          aria-invalid={operatorError || undefined}
                          aria-describedby={
                            operatorError
                              ? "shared-operator-error shared-operator-help"
                              : "shared-operator-help"
                          }
                          disabled={isBulkSubmitting}
                          className="app-field"
                        />
                        {operatorError && (
                          <p
                            id="shared-operator-error"
                            role="alert"
                            className="mt-2 text-xs leading-relaxed text-status-danger"
                          >
                            {t("registeredByRequired")}
                          </p>
                        )}
                        <p id="shared-operator-help" className="app-helper">
                          {t("registeredByHelp")}
                        </p>
                      </div>
                    )}

                    {!isAtLimit ? (
                      <>
                      <form
                        className="guest-entry-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleSave();
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <label htmlFor="authenticated-guest-name" className="app-label">
                            {t("guestName")}
                          </label>
                          <input
                            ref={guestNameInputRef}
                            id="authenticated-guest-name"
                            name="guest-name"
                            type="text"
                            value={guestName}
                            onChange={(event) => handleGuestNameChange(event.target.value)}
                            placeholder={t("enterFullName")}
                            maxLength={100}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            enterKeyHint="done"
                            // 저장 중에도 focus를 유지하도록 disabled 대신 readOnly로 잠급니다.
                            readOnly={isLoading || isBulkSubmitting}
                            aria-describedby={
                              duplicateName ? "authenticated-guest-duplicate" : undefined
                            }
                            className="app-field min-h-11 read-only:opacity-70"
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
                      {duplicateName && (
                        <div
                          id="authenticated-guest-duplicate"
                          role="alert"
                          className="flex flex-col gap-2 border-l-2 border-status-waiting bg-status-waiting/10 px-3 py-2 text-sm text-status-waiting sm:flex-row sm:items-center sm:justify-between"
                        >
                          <p className="leading-relaxed">{t("duplicateRequiresConfirmation")}</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            disabled={isLoading || isBulkSubmitting}
                            onClick={() => void handleSave(true)}
                          >
                            {t("addDuplicateAnyway")}
                          </Button>
                        </div>
                      )}
                      </>
                    ) : (
                      <div className="border-l-2 border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
                        {t("limitReached", {
                          used: displayQuota?.used ?? activeGuestsCount,
                          max: effectiveLimit ?? 0,
                        })}
                      </div>
                    )}
                    {/* 한도에 도달해 입력란이 사라져도 마지막 등록 결과를 안내합니다. */}
                    <p role="status" aria-live="polite" aria-atomic="true" className="app-helper text-status-checked">
                      {lastAddedName ? t("guestAdded", { name: lastAddedName }) : ""}
                    </p>

                    <GuestBulkEntry
                      key={requestScopeKey}
                      existingNames={filteredGuests.map((guest) => guest.name)}
                      remaining={remaining}
                      disabled={isLoading || !effectiveVenueId}
                      validateBeforeSubmit={requireOperatorName}
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
  );

  return (
    <WorkspaceShell contentClassName="gap-4 pb-8 lg:gap-6" actions={
      <WorkspaceAction icon={entryOpen ? "close" : "add"} tone={entryOpen ? "muted" : "accent"} onClick={() => entryOpen ? requestSheetClose("guest-entry-panel") : setEntryOpen(true)} aria-expanded={entryOpen} aria-controls={entryOpen ? "guest-entry-panel" : undefined}>{entryOpen ? t("hideEntry") : t("addGuest")}</WorkspaceAction>
    }>
      {venueLoadError && (
        <VenueLoadNotice
          onRetry={refreshVenues}
          isLoading={isLoadingVenues}
        />
      )}

      <OperationsLayout
        variant="stacked"
        title={commonT("guest")}
        dashboard={
          <>
                <EventScopeSelector venueId={effectiveVenueId} businessDate={selectedDate}
                  value={selectedEventId} onChange={(value) => { if (value !== selectedEventId) changeRegistrationScope(() => setSelectedEventId(value)); }} disabled={isLoading || isBulkSubmitting}
                  renderScope={(selector, label) => <><OperationsScope venueName={currentVenue?.brandName || currentVenue?.name} date={selectedDate} label={label} disabled={isBulkSubmitting}>
                    <DatePicker compact value={selectedDate} onChange={(value) => { if (value !== selectedDate) changeRegistrationScope(() => setSelectedDate(value)); }} businessDate={businessDate} disabled={isLoading || isBulkSubmitting} />
                    {isSuperAdmin && <VenueSelector venues={venues} selectedVenueId={selectedVenueId} onVenueChange={(value) => { if (value !== selectedVenueId) changeRegistrationScope(() => setSelectedVenueId(value)); }} disabled={isLoading || isBulkSubmitting} />}
                    {selector}
                  </OperationsScope>{renderGuestEntry(label)}</>} />

                {/* 입력 패널이 열려 있으면 오류를 패널 안에서만 한 번 표시합니다. */}
                {error && !entryOpen && <Alert type="error" message={error} />}

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
                // Name the narrowest active filter and offer its way back, as the Door roster does.
                <EmptyState
                  icon="user-add"
                  message={
                    searchQuery.trim()
                      ? t("noSearchResults")
                      : rosterStatus !== "all"
                        ? t(rosterStatus === "pending" ? "noWaitingGuests" : "noCheckedGuests")
                        : t("noGuestsForDate")
                  }
                  action={searchQuery.trim()
                    ? <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>{commonT("clearSearch")}</Button>
                    : rosterStatus !== "all"
                      ? <Button variant="outline" size="sm" onClick={() => setRosterStatus("all")}>{t("showAllGuests")}</Button>
                      : undefined}
                />
              ) : (
                <div
                  className={`product-roster-rows ${
                    isCurrentScopeFetching ? "pointer-events-none" : ""
                  }`}
                >
                  {displayGuests.map((guest, index) => (
                    <GuestListCard
                      timeZone={currentVenue?.timezone}
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
                      isDeleteLoading={deletingId === guest.id}
                      isDeleteDisabled={isBulkSubmitting || isLoading}
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
