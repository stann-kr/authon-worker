"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalStorage, useGuestPolling } from "@/lib/hooks";
import AdminHeader from "../../admin/components/AdminHeader";
import Footer from "@/components/Footer";
import StatGrid from "@/components/StatGrid";
import PanelHeader from "@/components/PanelHeader";
import EmptyState from "@/components/EmptyState";
import Alert from "@/components/Alert";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import DatePicker from "@/components/DatePicker";
import Button from "@/components/Button";
import GuestListCard from "@/components/GuestListCard";
import GuestSearchInput from "@/components/GuestSearchInput";
import Skeleton from "@/components/Skeleton";
import OperationsLayout from "@/components/OperationsLayout";
import { getBusinessDate } from "@/lib/date";
import {
  fetchGuestsByDate,
  createGuest,
  deleteGuest,
} from "@/lib/api/guests";
import type { Guest } from "@/lib/api/types";
import type { GuestQuota } from "@/lib/api/types";
import {
  createGuestLimitRequest,
  fetchMyGuestQuota,
} from "@/lib/api/guest-limits";
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
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
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
  const displayCacheRef = useRef<Guest[]>([]);

  useEffect(() => {
    if (!isFetching) {
      displayCacheRef.current = guests;
    }
  }, [isFetching, guests]);

  const displayDataGuests = isFetching ? displayCacheRef.current : guests;

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

  useEffect(() => {
    if (currentVenue) setSelectedDate(businessDate);
  }, [businessDate, currentVenue]);

  useEffect(() => {
    if (user?.account_kind !== "shared") return;
    const stored = window.sessionStorage.getItem(`shared-operator:${user.id}`);
    if (stored) setRegisteredByName(stored);
  }, [user]);

  const refreshQuota = useCallback(async () => {
    const { data } = await fetchMyGuestQuota(selectedDate);
    if (data) setQuota(data);
  }, [selectedDate]);

  const loadGuests = useCallback(async () => {
    if (!effectiveVenueId) return;
    setIsFetching(true);
    setError(null);

    const [{ data, error: fetchError }, quotaResult] = await Promise.all([
      fetchGuestsByDate(selectedDate, effectiveVenueId),
      fetchMyGuestQuota(selectedDate),
    ]);

    if (fetchError) {
      console.error("Failed to fetch guests:", fetchError);
      setError(t("loadFailed"));
    } else if (data) {
      setGuests(data);
    }
    if (quotaResult.data) setQuota(quotaResult.data);

    setIsFetching(false);
  }, [selectedDate, effectiveVenueId, t]);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  // 주기적으로 데이터 갱신 (15초)
  useGuestPolling(async () => {
    if (!effectiveVenueId) return;
    const [{ data }, quotaResult] = await Promise.all([
      fetchGuestsByDate(selectedDate, effectiveVenueId),
      fetchMyGuestQuota(selectedDate),
    ]);
    if (data) setGuests(data);
    if (quotaResult.data) setQuota(quotaResult.data);
  }, 15000, !!effectiveVenueId);

  const handleSave = async () => {
    if (!guestName.trim()) return;

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

    const { data, error: createError } = await createGuest({
      venueId: effectiveVenueId,
      name: guestName.trim().toUpperCase(),
      date: selectedDate,
      registeredByName:
        user?.account_kind === "shared" ? registeredByName.trim() : null,
    });

    if (createError) {
      console.error("Failed to create guest:", createError);
      setError(
        createError === "GUEST_LIMIT_REACHED"
          ? t("limitReachedServer")
          : createError === "REGISTERED_BY_REQUIRED"
            ? t("registeredByRequired")
            : t("registerFailed"),
      );
      setIsLoading(false);
      return;
    }

    if (data) {
      setGuests((prev) => [...prev, data]);
      setGuestName("");
      await refreshQuota();
    }

    setIsLoading(false);
  };

  const handleDelete = async (id: string) => {
    setIsLoading(true);
    setError(null);

    const { data, error: deleteError } = await deleteGuest(id);

    if (deleteError) {
      console.error("Failed to delete guest:", deleteError);
      setError(t("deleteFailed"));
      setIsLoading(false);
      return;
    }

    if (data) {
      setGuests((prev) =>
        prev.map((guest) => (guest.id === id ? data : guest)),
      );
      await refreshQuota();
    }

    setIsLoading(false);
  };

  const filteredGuests = displayDataGuests.filter(
    (guest) =>
      guest.date === selectedDate && guest.createdByUserId === user?.id,
  );
  
  const pendingGuests = filteredGuests.filter((g) => g.status === "pending");
  const checkedGuests = filteredGuests.filter((g) => g.status === "checked");
  const activeGuestsCount = filteredGuests.filter((g) => g.status !== "deleted").length;
  
  const effectiveLimit = quota?.effectiveLimit ?? user?.guest_limit ?? null;
  const remaining = quota?.remaining ??
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
    const extra = Number.parseInt(requestedExtra, 10);
    setIsRequestingExtra(true);
    setError(null);
    const { error: requestError } = await createGuestLimitRequest({
      date: selectedDate,
      requestedExtra: extra,
      reason: requestReason,
    });
    if (requestError) {
      setError(
        requestError === "PENDING_REQUEST_EXISTS"
          ? t("requestAlreadyPending")
          : t("requestFailed"),
      );
    } else {
      setRequestReason("");
      await refreshQuota();
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
                  />
                  {isSuperAdmin && (
                    <div className="context-filter-grid">
                      <VenueSelector
                        venues={venues}
                        selectedVenueId={selectedVenueId}
                        onVenueChange={setSelectedVenueId}
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
                          className="app-field"
                        />
                        <p className="app-helper">{t("registeredByHelp")}</p>
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
                            autoComplete="off"
                            className="app-field min-h-11"
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={!guestName.trim()}
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
                          used: quota?.used ?? activeGuestsCount,
                          max: effectiveLimit ?? 0,
                        })}
                      </div>
                    )}

                    {quota?.pendingRequest ? (
                      <div className="mt-3 border border-status-waiting/60 bg-status-waiting/10 p-3 text-xs text-status-waiting">
                        {t("requestPending", {
                          count: quota.pendingRequest.requestedExtra,
                        })}
                      </div>
                    ) : quota?.canRequestExtra ? (
                      <details className="mt-3 border border-border-default bg-canvas p-3">
                        <summary className="cursor-pointer text-sm font-medium text-text-heading">
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
                    isLoading={isFetching}
                  />
                  <GuestSearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                  />
                  <StatGrid
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
              aria-busy={isFetching}
            >
              <PanelHeader
                title={t("todaysGuests")}
                headingLevel={2}
                headingId="guest-list-title"
                count={displayGuests.length}
              />

              {isFetching && displayDataGuests.length === 0 ? (
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
                    isFetching ? "pointer-events-none opacity-50" : ""
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
