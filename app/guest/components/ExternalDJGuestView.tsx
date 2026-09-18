"use client";

import { useState } from "react";
import { useLocalStorage } from "@/lib/hooks";
import Footer from "@/components/Footer";
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
import GuestQrCode from "@/components/GuestQrCode";
import Icon from "@/components/Icon";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLocale, useTranslations } from "next-intl";
import { formatDateDisplay } from "@/lib/date";
import {
  validateExternalToken,
  createGuestViaExternalLink,
  createGuestsViaExternalLink,
  deleteGuestViaExternalLink,
  updateGuestViaExternalLink,
} from "@/lib/api/external-links";
import type { ExternalLinkPublicGuest } from "@/lib/external-links/types";
import useExternalGuestController, {
  type ExternalGuestControllerDependencies,
} from "./useExternalGuestController";

interface ExternalDJGuestViewProps {
  token: string;
}

const EXTERNAL_GUEST_ACTIONS: ExternalGuestControllerDependencies =
  Object.freeze({
    validateExternalToken,
    createGuestViaExternalLink,
    createGuestsViaExternalLink,
    deleteGuestViaExternalLink,
    updateGuestViaExternalLink,
  });

export default function ExternalDJGuestView({ token }: ExternalDJGuestViewProps) {
  const t = useTranslations("ExternalGuest");
  const commonT = useTranslations("Common");
  const locale = useLocale() as "en" | "ko";
  const { brand } = useVenueBrand();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guest:sortMode",
    "default",
  );
  const {
    contentHeadingRef,
    deletingId,
    error,
    externalViewRootRef,
    guests,
    guestName,
    handleBulkSave,
    handleDelete,
    handleInitialRetry,
    handleReconciliationRetry,
    handleSave,
    hasValidationError,
    invalidHeadingRef,
    isBulkSubmitting,
    isLoading,
    isReconciling,
    isSelfRsvp,
    isSelfRsvpLocked,
    isValidating,
    linkInfo,
    ownedGuest,
    ownerKey,
    reconciliationHeadingRef,
    requiresReconciliation,
    retryHeadingRef,
    handleGuestNameChange,
    showReconciliationBanner,
    showRetryPanel,
    venueInfo,
  } = useExternalGuestController({ token, dependencies: EXTERNAL_GUEST_ACTIONS });

  const sortGuestsByName = (list: ExternalLinkPublicGuest[]) => {
    return [...list].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", locale === "ko" ? "ko-KR" : "en-US", {
        sensitivity: "base",
      }),
    );
  };

  const sortGuestsByCreatedAt = (list: ExternalLinkPublicGuest[]) => {
    return [...list].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
  };

  const externalHeader = (
    <header className="external-guest-header">
      <div className="external-guest-header-inner">
        <div className="flex min-w-0 items-center gap-3">
          <span className="external-guest-brand">{brand.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="operational-label hidden sm:inline">
            {t("guestAccess")}
          </span>
          <LanguageSwitcher compact />
        </div>
      </div>
    </header>
  );

  if (isValidating) {
    return (
      <div ref={externalViewRootRef} className="external-guest-workspace" data-rsvp={isSelfRsvp}>
        {externalHeader}
        <div className="external-guest-body">
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
      <div ref={externalViewRootRef} className="external-guest-workspace" data-rsvp={isSelfRsvp}>
        {externalHeader}
        <main id="main-content" tabIndex={-1} className="external-guest-state">
          <div className="app-panel max-w-sm p-7 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-status-danger/70 bg-status-danger/10">
              <Icon name="warning" size={24} className="text-status-danger" />
            </div>
            <h1
              ref={invalidHeadingRef}
              tabIndex={-1}
              className="mb-2 text-xl font-semibold text-text-heading outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t("invalidTitle")}
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-text-muted">
              {t("invalidDescription")}
            </p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (showRetryPanel) {
    return (
      <div ref={externalViewRootRef} className="external-guest-workspace" data-rsvp={isSelfRsvp}>
        {externalHeader}
        <main id="main-content" tabIndex={-1} className="external-guest-state">
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
        <Footer />
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
    <div ref={externalViewRootRef} className="external-guest-workspace" data-rsvp={isSelfRsvp}>
      {externalHeader}
      <div className="external-guest-body">
        <main id="main-content" tabIndex={-1} className="page-container">
          <dl className="external-guest-context">
            <div className="flex flex-col">
              <dt>
                {t("guestOwner")}
              </dt>
              <dd>
                {linkInfo?.djName ?? "-"}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt>
                {t("event")}
              </dt>
              <dd>
                {linkInfo?.event ?? "-"}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt>
                {t("venue")}
              </dt>
              <dd>
                {venueInfo?.name ?? "-"}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt>
                {t("operationalDate")}
              </dt>
              <dd className="tabular-nums">
                {linkInfo ? formatDateDisplay(linkInfo.date || "", locale) : "-"}
              </dd>
            </div>
          </dl>

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
            <div className="external-guest-entry-heading">
              <h1
                ref={contentHeadingRef}
                tabIndex={-1}
                className="type-panel-title outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {isSelfRsvp ? t("yourRsvp") : t("addGuest")}
              </h1>
              {!isSelfRsvp && (
                <GuestCapacityIndicator
                  label={t("remaining")}
                  remaining={remaining}
                  limit={linkInfo?.maxGuests ?? null}
                />
              )}
            </div>

            <div className="external-guest-entry">
              {isSelfRsvp && (
                <>
                  {!ownerKey && (
                    <Alert
                      type="error"
                      message={t("selfRsvpStorageRequired")}
                      className="mb-3"
                    />
                  )}
                  {(isSelfRsvpLocked || !ownedGuest) && (
                    <p className="mb-3 text-sm leading-relaxed text-text-muted">
                      {isSelfRsvpLocked
                        ? t("selfRsvpCheckedHelp")
                        : t("selfRsvpCreateHelp")}
                    </p>
                  )}
                </>
              )}
              {!isAtLimit || Boolean(ownedGuest) ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="external-guest-name" className="app-label">
                      {isSelfRsvp ? t("yourName") : t("guestName")}
                    </label>
                    <input
                      id="external-guest-name"
                      name="external-guest-name"
                      type="text"
                      value={guestName}
                      onChange={(event) => handleGuestNameChange(event.target.value)}
                      placeholder={t("enterFullName")}
                      maxLength={100}
                      autoComplete="off"
                      disabled={
                        requiresReconciliation ||
                        isReconciling ||
                        isLoading ||
                        isBulkSubmitting ||
                        deletingId !== null ||
                        (isSelfRsvp && !ownerKey) ||
                        isSelfRsvpLocked
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
                      deletingId !== null ||
                      (isSelfRsvp && !ownerKey) ||
                      isSelfRsvpLocked
                    }
                    isLoading={isLoading}
                    size="lg"
                    className="sm:min-w-32"
                  >
                    {isSelfRsvp
                      ? ownedGuest
                        ? t("updateRsvp")
                        : t("registerRsvp")
                      : t("addGuest")}
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

              {!isSelfRsvp && (
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
                />
              )}
            </div>


            {isSelfRsvp && ownedGuest && (
              <GuestQrCode
                guestId={ownedGuest.id}
                label={t("doorQrCode")}
                codeLabel={t("doorQrCodeHelp")}
                unavailableLabel={t("doorQrCodeUnavailable")}
              />
            )}

            <PanelHeader
              headingLevel={2}
              title={isSelfRsvp ? t("yourRegistration") : t("guestList")}
              count={displayGuests.length}
              sortMode={isSelfRsvp ? undefined : sortMode}
              onSortToggle={isSelfRsvp ? undefined : () =>
                  setSortMode((prev) =>
                    prev === "default" ? "alpha" : "default",
                  )
              }
            />

            {!isSelfRsvp && (
              <GuestSearchInput
                className="external-guest-search"
                value={searchQuery}
                onChange={setSearchQuery}
              />
            )}

            {displayGuests.length === 0 ? (
              <EmptyState
                icon="user-add"
                message={
                  searchQuery
                    ? t("noSearchResults")
                    : isSelfRsvp
                      ? t("noOwnRsvp")
                      : t("noGuests")
                }
              />
            ) : (
              <div className="product-roster-rows">
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
