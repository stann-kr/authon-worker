"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLatestRequestGuard, useLocalStorage } from "@/lib/hooks";
import Footer from "@/components/Footer";
import StatGrid from "@/components/StatGrid";
import PanelHeader from "@/components/PanelHeader";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import GuestBulkEntry from "@/components/GuestBulkEntry";
import GuestCapacityIndicator from "@/components/GuestCapacityIndicator";
import { useVenueBrand } from "@/components/VenueBrandProvider";
import GuestListCard from "@/components/GuestListCard";
import GuestSearchInput from "@/components/GuestSearchInput";
import Icon from "@/components/Icon";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useRouteLoadingTask } from "@/components/RouteTransitionProvider";
import { useLocale, useTranslations } from "next-intl";
import { formatDateDisplay } from "@/lib/date";
import { getExternalLinkValidationDisposition } from "@/lib/external-links/domain";
import {
  validateExternalToken,
  createGuestViaExternalLink,
  createGuestsViaExternalLink,
  deleteGuestViaExternalLink,
} from "@/lib/api/external-links";
import type {
  BulkGuestCreateInput,
  Guest,
  ExternalDJLink,
  Venue,
} from "@/lib/api/types";

interface ExternalDJGuestViewProps {
  token: string;
}

type ExternalGuestFeedbackKey =
  | "refreshFailed"
  | "registerResultUnknown"
  | "duplicateRequiresConfirmation"
  | "rateLimited"
  | "deleteFailed"
  | "deleteResultUnknown";

export default function ExternalDJGuestView({ token }: ExternalDJGuestViewProps) {
  const t = useTranslations("ExternalGuest");
  const commonT = useTranslations("Common");
  const locale = useLocale() as "en" | "ko";
  const { brand } = useVenueBrand();
  const [linkInfo, setLinkInfo] = useState<ExternalDJLink | null>(null);
  const [venueInfo, setVenueInfo] = useState<Venue | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [hasValidationError, setHasValidationError] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<ExternalGuestFeedbackKey | null>(null);
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guest:sortMode",
    "default",
  );
  const retryHeadingRef = useRef<HTMLHeadingElement>(null);
  const reconciliationHeadingRef = useRef<HTMLHeadingElement>(null);
  const contentHeadingRef = useRef<HTMLHeadingElement>(null);
  const validationGuard = useLatestRequestGuard();
  useRouteLoadingTask(isValidating);
  const showRetryPanel =
    !isValidating &&
    !hasValidationError &&
    (!linkInfo || !venueInfo);
  const showReconciliationBanner =
    !isValidating &&
    !hasValidationError &&
    requiresReconciliation &&
    Boolean(linkInfo && venueInfo);

  const loadExternalData = useCallback(async (showInitialLoading = false) => {
    const isLatestRequest = validationGuard.beginRequest();
    if (showInitialLoading) {
      setIsValidating(true);
      setHasValidationError(false);
      setError(null);
      setLinkInfo(null);
      setVenueInfo(null);
      setGuests([]);
    }
    try {
      const { data, error: validationError } = await validateExternalToken(token);
      if (!isLatestRequest()) return;
      if (validationError) {
        console.error("Invalid external guest link:", validationError);
        if (getExternalLinkValidationDisposition(validationError) === "invalid") {
          setHasValidationError(true);
          setLinkInfo(null);
          setVenueInfo(null);
          setGuests([]);
        } else {
          setHasValidationError(false);
          setError("refreshFailed");
        }
        return false;
      } else if (data) {
        setHasValidationError(false);
        setRequiresReconciliation(false);
        setError(null);
        setLinkInfo(data.link);
        setVenueInfo(data.venue);
        setGuests(data.guests ?? []);
        return true;
      }
      setError("refreshFailed");
      return false;
    } catch (validationError) {
      if (!isLatestRequest()) return;
      console.error("Invalid external guest link:", validationError);
      setHasValidationError(false);
      setError("refreshFailed");
      return false;
    } finally {
      if (showInitialLoading && isLatestRequest()) setIsValidating(false);
    }
  }, [token, validationGuard]);

  useEffect(() => {
    loadExternalData(true);
    // 번역 함수 변경은 이미 검증된 token과 무관하다. locale 전환 때
    // token 검증과 전체 route loading을 다시 시작하지 않는다.
  }, [loadExternalData]);

  useEffect(() => {
    if (isReconciling || (!showRetryPanel && !showReconciliationBanner)) return;
    const frame = window.requestAnimationFrame(() => {
      if (showRetryPanel) {
        retryHeadingRef.current?.focus();
      } else {
        reconciliationHeadingRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isReconciling, showReconciliationBanner, showRetryPanel]);

  const handleReconciliationRetry = async () => {
    if (isReconciling) return;
    setIsReconciling(true);
    try {
      const refreshed = await loadExternalData(false);
      if (refreshed === false) {
        setRequiresReconciliation(true);
      } else if (refreshed === true) {
        window.requestAnimationFrame(() => contentHeadingRef.current?.focus());
      }
    } finally {
      setIsReconciling(false);
    }
  };

  const handleInitialRetry = async () => {
    const refreshed = await loadExternalData(true);
    if (refreshed === true) {
      window.requestAnimationFrame(() => contentHeadingRef.current?.focus());
    }
  };

  const handleSave = async () => {
    if (
      !guestName.trim() ||
      !linkInfo ||
      requiresReconciliation ||
      isLoading ||
      isBulkSubmitting ||
      deletingId !== null
    ) return;
    setIsLoading(true);
    setError(null);
    let actionFeedback: ExternalGuestFeedbackKey | null = null;

    try {
      const { data, error: createError } = await createGuestViaExternalLink({
        token,
        guestName: guestName.trim().toUpperCase(),
        date: linkInfo.date || "",
      });

      if (createError) {
        console.error("Failed to register guest:", createError);
        actionFeedback =
          createError === "RATE_LIMITED"
            ? "rateLimited"
            : createError === "DUPLICATE_REQUIRES_CONFIRMATION"
              ? "duplicateRequiresConfirmation"
              : "registerResultUnknown";
      } else if (data) {
        setGuests((prev) => [...prev, data]);
        setGuestName("");
        setLinkInfo((prev) =>
          prev ? { ...prev, usedGuests: prev.usedGuests + 1 } : prev,
        );
      } else {
        actionFeedback = "registerResultUnknown";
      }
    } catch (createError) {
      console.error("Failed to register guest:", createError);
      actionFeedback = "registerResultUnknown";
    } finally {
      // A write can commit before its response is lost. Always reconcile from
      // the server; a refresh failure intentionally supersedes the action
      // message because the visible roster is then not authoritative.
      try {
        const refreshed = await loadExternalData(false);
        if (refreshed === false) {
          setRequiresReconciliation(true);
        } else if (refreshed === true && actionFeedback) {
          setError(actionFeedback);
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDelete = async (guestId: string) => {
    if (requiresReconciliation || isReconciling) return;
    setDeletingId(guestId);
    setError(null);
    let actionFeedback: ExternalGuestFeedbackKey | null = null;

    try {
      const { error: deleteError } = await deleteGuestViaExternalLink({
        token,
        guestId,
      });

      if (deleteError) {
        console.error("Failed to delete guest:", deleteError);
        actionFeedback = "deleteFailed";
      } else {
        setGuests((prev) => prev.filter((g) => g.id !== guestId));
        setLinkInfo((prev) =>
          prev ? { ...prev, usedGuests: Math.max(0, prev.usedGuests - 1) } : prev,
        );
      }
    } catch (deleteError) {
      console.error("Failed to delete guest:", deleteError);
      actionFeedback = "deleteResultUnknown";
    } finally {
      try {
        const refreshed = await loadExternalData(false);
        if (refreshed === false) {
          setRequiresReconciliation(true);
        } else if (refreshed === true && actionFeedback) {
          setError(actionFeedback);
        }
      } finally {
        setDeletingId(null);
      }
    }
  };

  const handleBulkSave = async (bulkGuests: BulkGuestCreateInput[]) => {
    if (!linkInfo) return { data: null, error: "INVALID_LINK" };
    setError(null);

    const response = await createGuestsViaExternalLink({
      token,
      date: linkInfo.date || "",
      items: bulkGuests,
    });

    if (response.data) {
      const createdGuests = response.data.items.flatMap((item) =>
        item.status === "created" && item.guest ? [item.guest] : [],
      );
      if (createdGuests.length > 0) {
        setGuests((current) => [...current, ...createdGuests]);
        setLinkInfo((current) =>
          current
            ? { ...current, usedGuests: current.usedGuests + createdGuests.length }
            : current,
        );
      }
    }

    return response;
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

  const externalHeader = (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-border-default bg-canvas pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 place-items-center border border-border-strong bg-surface font-mono text-xs font-semibold text-text-heading">{brand.name.charAt(0).toUpperCase()}</div>
          <span className="truncate text-sm font-semibold text-text-heading">
            {brand.name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="operational-label hidden sm:inline">
            {t("guestAccess")}
          </span>
          <LanguageSwitcher compact />
        </div>
      </div>
    </div>
  );

  if (isValidating) {
    return (
      <div className="min-h-[100dvh] bg-canvas flex flex-col">
        {externalHeader}
        <div className="flex-1 overflow-x-hidden pt-[calc(5rem+env(safe-area-inset-top))] sm:pt-[calc(5.5rem+env(safe-area-inset-top))] flex flex-col">
          <main id="main-content" tabIndex={-1} className="page-container">
            <div className="main-content-panel">
              <Spinner mode="inline" text={commonT("loading")} />
            </div>
          </main>
          <Footer />
        </div>
      </div>
    );
  }

  if (hasValidationError) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-[100dvh] bg-canvas flex items-center justify-center px-4">
        <div className="app-panel max-w-sm p-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-status-danger/70 bg-status-danger/10">
            <Icon name="warning" size={24} className="text-status-danger" />
          </div>
          <h1 className="mb-2 text-xl font-semibold text-text-heading">
            {t("invalidTitle")}
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-text-muted">
            {t("invalidDescription")}
          </p>
          <Footer compact />
        </div>
      </main>
    );
  }

  if (showRetryPanel) {
    return (
      <div className="min-h-[100dvh] bg-canvas flex flex-col">
        {externalHeader}
        <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center px-4 pt-[calc(5rem+env(safe-area-inset-top))]">
          <div
            className="app-panel max-w-sm p-7 text-center"
            aria-labelledby="external-load-error-title"
            aria-describedby="external-load-error-description"
            aria-live="assertive"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-status-waiting/70 bg-status-waiting/10">
              <Icon name="warning" size={24} className="text-status-waiting" />
            </div>
            <h1
              id="external-load-error-title"
              ref={retryHeadingRef}
              tabIndex={-1}
              className="mb-2 text-xl font-semibold text-text-heading outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t("loadFailedTitle")}
            </h1>
            <p
              id="external-load-error-description"
              className="mb-6 text-sm leading-relaxed text-text-muted"
            >
              {t("refreshFailed")}
            </p>
            <Button onClick={() => void handleInitialRetry()}>
              {commonT("refresh")}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const remaining = linkInfo ? linkInfo.maxGuests - linkInfo.usedGuests : 0;
  const isAtLimit = remaining <= 0;
  const sortedGuests =
    sortMode === "alpha"
      ? sortGuestsByName(guests)
      : sortGuestsByCreatedAt(guests);
  const displayGuests = searchQuery
    ? sortedGuests.filter((g) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedGuests;

  return (
    <div className="min-h-[100dvh] bg-canvas flex flex-col">
      {externalHeader}
      <div className="flex-1 overflow-x-hidden pt-[calc(5rem+env(safe-area-inset-top))] sm:pt-[calc(5.5rem+env(safe-area-inset-top))] flex flex-col">
        <main id="main-content" tabIndex={-1} className="page-container">
          <div className="context-bar mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 p-4 sm:p-5">
            <div className="flex flex-col">
              <span className="text-xs font-mono uppercase tracking-wider text-text-dim">
                {t("guestOwner")}
              </span>
              <span className="mt-1 text-sm font-semibold text-text-heading">
                {linkInfo?.djName ?? "-"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-mono uppercase tracking-wider text-text-dim">
                {t("event")}
              </span>
              <span className="mt-1 text-sm font-semibold text-text-heading">
                {linkInfo?.event ?? "-"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-mono uppercase tracking-wider text-text-dim">
                {t("venue")}
              </span>
              <span className="mt-1 text-sm font-semibold text-text-heading">
                {venueInfo?.name ?? "-"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-mono uppercase tracking-wider text-text-dim">
                {t("operationalDate")}
              </span>
              <span className="mt-1 font-mono text-sm font-semibold text-text-heading">
                {linkInfo ? formatDateDisplay(linkInfo.date || "", locale) : "-"}
              </span>
            </div>
          </div>

          {showReconciliationBanner && (
            <div
              className="mb-4 border border-status-waiting/70 bg-status-waiting/10 p-4"
              aria-labelledby="external-reconciliation-title"
              aria-describedby="external-reconciliation-description"
              aria-live="assertive"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2
                    id="external-reconciliation-title"
                    ref={reconciliationHeadingRef}
                    tabIndex={-1}
                    className="text-sm font-semibold text-text-heading outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    {t("reconciliationRequiredTitle")}
                  </h2>
                  <p
                    id="external-reconciliation-description"
                    className="mt-1 text-sm leading-relaxed text-text-muted"
                  >
                    {t("reconciliationRequiredDescription")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  isLoading={isReconciling}
                  onClick={() => void handleReconciliationRetry()}
                  className="shrink-0"
                >
                  {commonT("refresh")}
                </Button>
              </div>
            </div>
          )}

          {error && !requiresReconciliation && (
            <Alert type="error" message={t(error)} className="mb-4" />
          )}

          <section className="main-content-panel">
            <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h1
                    ref={contentHeadingRef}
                    tabIndex={-1}
                    className="type-panel-title outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    {t("addGuest")}
                  </h1>
                </div>
                <GuestCapacityIndicator
                  label={t("remaining")}
                  value={remaining}
                />
              </div>

              {!isAtLimit ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="external-guest-name" className="app-label">
                      {t("guestName")}
                    </label>
                    <input
                      id="external-guest-name"
                      type="text"
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      placeholder={t("enterFullName")}
                      maxLength={100}
                      disabled={
                        requiresReconciliation ||
                        isReconciling ||
                        isLoading ||
                        isBulkSubmitting ||
                        deletingId !== null
                      }
                      className="app-field min-h-11"
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          void handleSave();
                        }
                      }}
                    />
                  </div>
                  <Button
                    onClick={handleSave}
                    disabled={
                      !guestName.trim() ||
                      requiresReconciliation ||
                      isReconciling ||
                      isLoading ||
                      isBulkSubmitting ||
                      deletingId !== null
                    }
                    isLoading={isLoading}
                    size="lg"
                    className="sm:min-w-32"
                  >
                    {t("addGuest")}
                  </Button>
                </div>
              ) : (
                <div className="border-l-2 border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
                  {t("guestLimitReached", {
                    used: linkInfo?.maxGuests ?? 0,
                    max: linkInfo?.maxGuests ?? 0,
                  })}
                </div>
              )}

              <GuestBulkEntry
                key={`${token}:${linkInfo?.id ?? "link"}`}
                existingNames={guests.map((guest) => guest.name)}
                remaining={remaining}
                disabled={
                  requiresReconciliation ||
                  isReconciling ||
                  isLoading ||
                  deletingId !== null
                }
                onSubmitChunk={handleBulkSave}
                onSubmissionComplete={async () => {
                  const refreshed = await loadExternalData(false);
                  if (!refreshed) {
                    setRequiresReconciliation(true);
                    throw new Error("External guest list refresh failed");
                  }
                }}
                onSubmittingChange={setIsBulkSubmitting}
              />
            </div>

            <StatGrid
              variant="embedded"
              items={[
                { label: t("registered"), value: guests.length, color: "checked" },
                {
                  label: t("remaining"),
                  value: remaining,
                  color: remaining > 0 ? "waiting" : "danger",
                },
                {
                  label: t("max"),
                  value: linkInfo?.maxGuests ?? 0,
                  color: "default",
                },
              ]}
            />

            <PanelHeader
              title={t("guestList")}
              count={displayGuests.length}
              sortMode={sortMode}
              onSortToggle={() =>
                setSortMode((prev) =>
                  prev === "default" ? "alpha" : "default",
                )
              }
            />

            <GuestSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
            />

            {displayGuests.length === 0 ? (
              <EmptyState
                icon="user-add"
                message={
                  searchQuery
                    ? t("noSearchResults")
                    : t("noGuests")
                }
              />
            ) : (
              <div className="divide-y divide-border-subtle overflow-y-auto">
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
                    isDeleteLoading={deletingId === guest.id}
                    isDeleteDisabled={
                      requiresReconciliation ||
                      isReconciling ||
                      isBulkSubmitting
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </main>
        <Footer />
      </div>
    </div>
  );
}
