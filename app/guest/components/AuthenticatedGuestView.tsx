"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useLocalStorage,
  useGuestPolling,
  useLatestRequestGuard,
} from "@/lib/hooks";
import AdminHeader from "../../admin/components/AdminHeader";
import Footer from "@/components/Footer";
import StatGrid from "@/components/StatGrid";
import PanelHeader from "@/components/PanelHeader";
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
import { useLocale, useTranslations } from "next-intl";

interface AuthenticatedGuestViewProps {
  user: AuthUser | null;
}

export default function AuthenticatedGuestView({ user }: AuthenticatedGuestViewProps) {
  const t = useTranslations("GuestOperations");
  const locale = useLocale() as "en" | "ko";
  const [selectedDate, setSelectedDate] = useState<string>(getBusinessDate());
  const [guestName, setGuestName] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState<boolean>(false);
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [quota, setQuota] = useState<GuestQuota | null>(null);
  const [registeredByName, setRegisteredByName] = useState("");
  const [requestedExtra, setRequestedExtra] = useState("1");
  const [requestReason, setRequestReason] = useState("");
  const [isRequestingExtra, setIsRequestingExtra] = useState(false);
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guest:sortMode",
    "default",
  );

  // 로딩 중 이전 데이터를 유지하여 화면 깜빡임 방지
  const displayCacheRef = useRef<{ scopeKey: string; guests: Guest[] }>({
    scopeKey: "",
    guests: [],
  });

  // super_admin venue selector
  const {
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    currentVenue,
  } = useVenueSelector();
  
  const effectiveVenueId = isSuperAdmin
    ? selectedVenueId
    : (user?.venue_id ?? "");
  const businessDate = getBusinessDate(currentVenue ?? {});
  const requestScopeKey = `${effectiveVenueId}:${selectedDate}`;
  const requestGuard = useLatestRequestGuard();
  const pollingGuard = useLatestRequestGuard();
  const currentScopeKeyRef = useRef(requestScopeKey);

  useEffect(() => {
    currentScopeKeyRef.current = requestScopeKey;
  }, [requestScopeKey]);

  useEffect(() => {
    if (!isFetching && loadedScopeKey === requestScopeKey) {
      displayCacheRef.current = { scopeKey: requestScopeKey, guests };
    }
  }, [guests, isFetching, loadedScopeKey, requestScopeKey]);

  const hasCurrentScopeData = loadedScopeKey === requestScopeKey;
  const isCurrentScopeFetching = isFetching || !hasCurrentScopeData;
  useSectionLoadingTask(isCurrentScopeFetching);
  const displayDataGuests = !hasCurrentScopeData
    ? []
    : isFetching && displayCacheRef.current.scopeKey === requestScopeKey
      ? displayCacheRef.current.guests
      : guests;
  const displayQuota = hasCurrentScopeData ? quota : null;

  useEffect(() => {
    if (currentVenue) setSelectedDate(businessDate);
  }, [businessDate, currentVenue]);

  useEffect(() => {
    if (user?.account_kind !== "shared") return;
    const stored = window.sessionStorage.getItem(`shared-operator:${user.id}`);
    if (stored) setRegisteredByName(stored);
  }, [user]);

  const loadGuests = useCallback(async (options?: { silent?: boolean }) => {
    pollingGuard.invalidateRequests();
    const isLatestRequest = requestGuard.beginRequest();
    if (!effectiveVenueId) {
      setGuests([]);
      setQuota(null);
      setLoadedScopeKey(requestScopeKey);
      setIsFetching(false);
      return true;
    }
    if (!options?.silent) setIsFetching(true);
    setError(null);

    try {
      const { data, error: fetchError } = await fetchGuestWorkspaceSnapshot(
        selectedDate,
        effectiveVenueId,
      );

      if (!isLatestRequest()) return;

      if (fetchError) {
        console.error("Failed to fetch guests:", fetchError);
        setError(t("loadFailed"));
      }
      setGuests(data?.guests ?? []);
      setQuota(data?.quota ?? null);
      setLoadedScopeKey(requestScopeKey);
      return !fetchError && data !== null;
    } catch (loadError) {
      if (!isLatestRequest()) return;
      console.error("Failed to fetch guests:", loadError);
      setGuests([]);
      setQuota(null);
      setLoadedScopeKey(requestScopeKey);
      setError(t("loadFailed"));
      return false;
    } finally {
      if (isLatestRequest()) setIsFetching(false);
    }
  }, [effectiveVenueId, pollingGuard, requestGuard, requestScopeKey, selectedDate, t]);

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
    );
    if (isLatestRequest() && loadedScopeKey === requestScopeKey) {
      if (data) {
        if (!data.failedSections.includes("guests")) {
          setGuests(data.guests);
        }
        if (!data.failedSections.includes("quota")) {
          setQuota(data.quota);
        }
      }
    }
  }, [effectiveVenueId, loadedScopeKey, pollingGuard, requestScopeKey, selectedDate]);

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
        registeredByName:
          user?.account_kind === "shared" ? registeredByName.trim() : null,
      });

      if (currentScopeKeyRef.current !== operationScopeKey) return;

      if (createError) {
        console.error("Failed to create guest:", createError);
        actionFeedback =
          createError === "GUEST_LIMIT_REACHED"
            ? t("limitReachedServer")
            : createError === "REGISTERED_BY_REQUIRED"
              ? t("registeredByRequired")
              : createError === "DUPLICATE_REQUIRES_CONFIRMATION"
                ? t("duplicateRequiresConfirmation")
                : createError === "INVALID_GUEST_NAME"
                  ? t("registerFailed")
                  : t("registerResultUnknown");
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

  const handleExtraRequest = async () => {
    const operationScopeKey = requestScopeKey;
    pollingGuard.invalidateRequests();
    const extra = Number.parseInt(requestedExtra, 10);
    setIsRequestingExtra(true);
    setError(null);
    const { error: requestError } = await createGuestLimitRequest({
      date: selectedDate,
      requestedExtra: extra,
      reason: requestReason,
    });
    if (currentScopeKeyRef.current !== operationScopeKey) {
      setIsRequestingExtra(false);
      return;
    }
    if (requestError) {
      setError(
        requestError === "PENDING_REQUEST_EXISTS"
          ? t("requestAlreadyPending")
          : t("requestFailed"),
      );
    } else {
      setRequestReason("");
      await loadGuests({ silent: true });
    }
    setIsRequestingExtra(false);
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

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <AdminHeader />
      <div className="flex flex-1 flex-col overflow-x-hidden pt-20 sm:pt-24">
        <div className="page-container">
          <OperationsLayout
            title={t("title")}
            dashboard={
              <>
                <div className="context-bar">
                  <DatePicker
                    value={selectedDate}
                    onChange={setSelectedDate}
                    businessDate={businessDate}
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
                  <div className="px-4 py-4 sm:px-5">
                    <div className="mb-3 flex items-end justify-between gap-4">
                      <div>
                        <h2 id="add-guest-title" className="type-panel-title">
                          {t("addGuest")}
                        </h2>
                        <p className="mt-1 text-sm text-text-muted">
                          {t("addOneAtATime")}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg tabular-nums text-text-heading">
                          {remaining ?? "∞"}
                        </div>
                        <div className="text-xs text-text-muted">{t("remaining")}</div>
                      </div>
                    </div>

                    {user?.account_kind === "shared" && (
                      <div className="mb-3">
                        <label htmlFor="shared-operator-name" className="app-label">
                          {t("registeredBy")}
                        </label>
                        <input
                          id="shared-operator-name"
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

                    {displayQuota?.pendingRequest ? (
                      <div className="mt-3 border border-status-waiting/60 bg-status-waiting/10 p-3 text-xs text-status-waiting">
                        {t("requestPending", {
                          count: displayQuota.pendingRequest.requestedExtra,
                        })}
                      </div>
                    ) : displayQuota?.canRequestExtra ? (
                      <details className="mt-3 border border-border-default bg-canvas p-3">
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text-heading">
                          {t("requestExtra")}
                        </summary>
                        <div className="mt-3 space-y-3">
                          <div>
                            <label htmlFor="extra-guest-count" className="app-label">
                              {t("requestCount")}
                            </label>
                            <input
                              id="extra-guest-count"
                              type="number"
                              min="1"
                              max="10"
                              value={requestedExtra}
                              onChange={(event) => setRequestedExtra(event.target.value)}
                              className="app-field"
                            />
                          </div>
                          <div>
                            <label htmlFor="extra-guest-reason" className="app-label">
                              {t("requestReasonOptional")}
                            </label>
                            <textarea
                              id="extra-guest-reason"
                              value={requestReason}
                              onChange={(event) => setRequestReason(event.target.value)}
                              maxLength={200}
                              rows={2}
                              className="app-field"
                            />
                          </div>
                          <Button
                            type="button"
                            onClick={handleExtraRequest}
                            isLoading={isRequestingExtra}
                            disabled={
                              !Number.isInteger(Number(requestedExtra)) ||
                              Number(requestedExtra) < 1 ||
                              Number(requestedExtra) > 10
                            }
                            fullWidth
                          >
                            {t("submitRequest")}
                          </Button>
                        </div>
                      </details>
                    ) : null}
                  </div>
                </section>

                <section className="app-panel" aria-labelledby="guest-tools-title">
                  <PanelHeader
                    title={t("tools")}
                    headingLevel={2}
                    headingId="guest-tools-title"
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
              />

              {isCurrentScopeFetching && displayDataGuests.length === 0 ? (
                <Skeleton rows={5} />
              ) : displayGuests.length === 0 ? (
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
                  className={`divide-y divide-border-subtle transition-opacity duration-200 ${
                    isCurrentScopeFetching ? "pointer-events-none opacity-50" : ""
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
        </div>
        <Footer />
      </div>
    </div>
  );
}
