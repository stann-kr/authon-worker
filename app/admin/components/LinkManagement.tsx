"use client";

import { confirmWorkspaceNavigation } from "@/components/overlays/navigation-guard";

import Sheet from "@/components/overlays/Sheet";
import { useToast } from "@/components/feedback/ToastProvider";
import { RecordStatus, type RecordStatusTone } from "@/components/records/RecordList";
import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import PanelHeader from "../../../components/PanelHeader";
import EmptyState from "../../../components/EmptyState";
import Alert from "../../../components/Alert";
import Icon from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import DatePicker from "../../../components/DatePicker";
import DateField from "@/components/dates/DateField";
import OperationsLayout from "../../../components/OperationsLayout";
import OperationalSectionNav from "../../../components/OperationalSectionNav";
import ConfirmDialog from "../../../components/ConfirmDialog";
import Button from "../../../components/Button";
import { getButtonClassName } from "../../../components/buttonStyles";
import { formatDateDisplay } from "../../../lib/date";
import { shouldShowEmptyState } from "../../../lib/ui/async-list-state";
import {
  fetchExternalLinkPage,
  fetchExternalLinkCreateSuggestions,
  createExternalLink,
  deleteExternalLink,
  deactivateExternalLink,
  activateExternalLink,
} from "../../../lib/api/external-links";
import type { ExternalDJLink } from "@/lib/external-links/types";
import {
  shareExternalLink,
  toExternalLinkTemplateDraft,
} from "../../../lib/external-links/domain";
import { useLocale, useTranslations } from "next-intl";
import {
  deriveLinkStatus,
  formatRelativeExpiry,
  formatTimestamp,
  type ManageFilter,
  type ManageSort,
} from "./linkStatus";
import LinkRegisteredGuests from "./LinkRegisteredGuests";
import ExternalDjCombobox from "./ExternalDjCombobox";
import ExternalEventCombobox from "./ExternalEventCombobox";
import {
  useLinkCreateController,
  type LinkCreateControllerActions,
} from "./useLinkCreateController";
import {
  useLinkManageController,
  type LinkManageControllerActions,
} from "./useLinkManageController";

const LINK_CREATE_ACTIONS: LinkCreateControllerActions = Object.freeze({
  fetchSuggestions: fetchExternalLinkCreateSuggestions,
  createLink: createExternalLink,
  shareLink: shareExternalLink,
});
const LINK_MANAGE_ACTIONS: LinkManageControllerActions = Object.freeze({
  fetchPage: fetchExternalLinkPage,
  deleteLink: deleteExternalLink,
  deactivateLink: deactivateExternalLink,
  activateLink: activateExternalLink,
  shareLink: shareExternalLink,
});

export type LinkManagementSection = "create" | "manage";

interface LinkManagementProps {
  scopeSelector?: (controls: ReactNode, disabled?: boolean, inline?: boolean) => ReactNode;
  selectedDate: string;
  onDateChange: (date: string) => void;
  businessDate: string;
  activeSection?: LinkManagementSection;
  onActiveSectionChange?: (section: LinkManagementSection) => void;
  showSectionNavigation?: boolean;
  eventId?: string | null;
}

export default function LinkManagement({
  scopeSelector,
  selectedDate,
  onDateChange,
  businessDate,
  activeSection,
  onActiveSectionChange,
  showSectionNavigation = true,
  eventId = null,
}: LinkManagementProps) {
  const t = useTranslations("LinkAdmin");
  const commonT = useTranslations("Common");
  const locale = useLocale() as "en" | "ko";
  const showToast = useToast();
  const localeModeLabel = (mode: "auto" | "en" | "ko") =>
    mode === "auto" ? t("auto") : mode === "ko" ? commonT("korean") : commonT("english");
  const [internalActiveSection, setInternalActiveSection] =
    useState<LinkManagementSection>("create");
  const activeTab = activeSection ?? internalActiveSection;
  const setActiveTab = useCallback(
    (section: LinkManagementSection) => {
      if (onActiveSectionChange) {
        onActiveSectionChange(section);
        return;
      }
      if (confirmWorkspaceNavigation()) setInternalActiveSection(section);
    },
    [onActiveSectionChange],
  );
  const {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    currentVenue,
  } = useVenueSelector();

  const create = useLinkCreateController({
    selectedDate,
    onDateChange,
    venueId,
    eventId,
    isActive: activeTab === "create",
    actions: LINK_CREATE_ACTIONS,
  });
  const manage = useLinkManageController({
    selectedDate,
    venueId,
    eventId,
    isActive: activeTab === "manage",
    locale,
    actions: LINK_MANAGE_ACTIONS,
  });
  const {
    formData,
    setFormData,
    isGenerating,
    nativeShareAvailable,
    currentDjSuggestions,
    currentEventSuggestions,
    isSuggestionsLoading,
    suggestionsError,
    formValidationError,
    scopedCreateError: scopedError,
    templateNotice,
    scopedGeneratedLink,
    isGeneratedLinkActionPending,
    linkDateInputRef,
    linkDjInputRef,
    linkEventInputRef,
    linkMaxGuestsInputRef,
    linkLocaleInputRef,
    linkKindInputRef,
    generatedLinkPanelRef,
    clearFormFieldError,
    handleDateChange,
    handleDjChange,
    handleSubmit,
  } = create;
  const {
    manageScope,
    setManageScope,
    manageFilter,
    setManageFilter,
    manageSort,
    setManageSort,
    now,
    dashboardStats,
    sortedLinks,
    listState,
    isCurrentScopeFetching,
    isLoadingMore, hasMore, loadMoreError, loadMore,
    scopedManageError,
    scopedSuccess,
    linkActionFeedback,
    visibleLinkId,
    setVisibleLinkId,
    loadingStates,
    lifecycleBusyIds,
    linkActionToast: manageLinkActionToast,
    pendingDeleteLink,
    setPendingDeleteLink,
    loadLinks,
    handleDeleteLink,
    requestDeleteLink,
    handleDeactivateLink,
    handleActivateLink,
    shareOrCopyManagedLink,
    clearFeedbackForTemplateHandoff,
    getGuestPageUrl,
  } = manage;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const lifecycleBusy = Object.values(lifecycleBusyIds).some(Boolean);
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || activeTab !== "manage" || !hasMore || isCurrentScopeFetching || isLoadingMore || loadMoreError || lifecycleBusy || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "240px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, hasMore, isCurrentScopeFetching, isLoadingMore, loadMoreError, loadMore, lifecycleBusy]);
  const linkActionToast = create.linkActionToast ?? manageLinkActionToast;
  // Transient results use the app-wide toast; failures stay inline beside the list or open record.
  useEffect(() => {
    if (linkActionToast) showToast({ message: linkActionToast });
  }, [linkActionToast, showToast]);
  useEffect(() => {
    if (scopedSuccess) showToast({ message: scopedSuccess });
  }, [scopedSuccess, showToast]);
  const [pendingDeactivateId, setPendingDeactivateId] = useState<string | null>(null);

  const handleUseAsTemplate = (link: ExternalDJLink) => {
    const draft = toExternalLinkTemplateDraft(link, selectedDate);
    clearFeedbackForTemplateHandoff();
    create.applyTemplate(draft);
    setActiveTab("create");
  };

  const scopeControls = <>
    {activeTab === "manage" && manageScope === "date" && <DatePicker compact
      value={selectedDate} onChange={onDateChange} businessDate={businessDate} disabled={isGenerating} />}
    {isSuperAdmin && venues.length > 0 && <VenueSelector venues={venues} selectedVenueId={selectedVenueId}
      onVenueChange={setSelectedVenueId} disabled={isGenerating} className="scope-venue" />}
  </>;

  return (
    <>
      <OperationsLayout
        variant="stacked"
        width={activeTab === "create" ? "form" : "full"}
        title={t("title")}
        headingLevel={null}
        dashboard={
          <>
        {activeTab === "manage" && manageScope === "date" && (
          scopeSelector ? scopeSelector(scopeControls, isGenerating) : <div className="operations-scope">{scopeControls}</div>
        )}
        {(showSectionNavigation || activeTab === "manage") && (
          <div>
            {showSectionNavigation && (
              <OperationalSectionNav
                label={t("section")}
                items={[
                  { id: "create", label: t("create"), icon: "add" },
                  { id: "manage", label: t("manage"), icon: "link" },
                ]}
                activeId={activeTab}
                onChange={setActiveTab}
                disabled={isGenerating}
              />
            )}
            {activeTab === "manage" && (
              <div
                className={`flex flex-wrap items-end gap-4 ${showSectionNavigation ? "mt-4" : ""}`}
              >
                {manageScope === "recent" && isSuperAdmin && venues.length > 0 && (
                  <VenueSelector venues={venues} selectedVenueId={selectedVenueId}
                    onVenueChange={setSelectedVenueId} className="w-full sm:w-60" />
                )}
                <div>
                <p className="app-label">{t("view")}</p>
                <div className="flex gap-2">
                  {(["recent", "date"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      aria-pressed={manageScope === scope}
                      onClick={() => {
                        setManageScope(scope);
                        setManageFilter("all");
                      }}
                      className={`min-h-11 border px-3 py-2 text-xs font-medium ${
                        manageScope === scope
                          ? "border-border-strong bg-surface-active text-text-heading"
                          : "border-border-default bg-surface-raised text-text-muted"
                      }`}
                    >
                      {scope === "date" ? t("byDate") : t("recent")}
                    </button>
                  ))}
                </div>
                </div>

              </div>
            )}
          </div>
        )}

          </>
        }
      >

      <div className="min-w-0">
        {activeTab === "create" && (
          <Sheet id="link-create-panel" presentation="page" headingLevel={2} title={t("createAccessLink")}
            busy={isGenerating || isGeneratedLinkActionPending} dirty={create.hasDraft}
            onClose={() => { create.resetDraft(); setActiveTab("manage"); }}>
          {scopeSelector ? scopeSelector(scopeControls, isGenerating, true) : isSuperAdmin && <div className="operations-scope">{scopeControls}</div>}
          <div className="record-form space-y-6">
            <div className="app-panel record-form-panel">

              {templateNotice && (
                <Alert
                  type="success"
                  message={templateNotice}
                  className="mb-4"
                />
              )}
              {scopedError && <Alert type="error" message={scopedError} className="mb-4" />}

              <form
                onSubmit={handleSubmit}
                className="record-form-fields"
                aria-busy={isGenerating}
              >
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="link-date" className="app-label">
                      {commonT("operationalDate")}
                    </label>
                    <DateField id="link-date" name="link-date" ref={linkDateInputRef}
                      value={formData.date} onChange={handleDateChange} businessDate={businessDate}
                      disabled={isGenerating} required
                      invalid={formValidationError?.field === "date"}
                      describedBy={formValidationError?.field === "date" ? "link-date-error" : undefined} />
                    {formValidationError?.field === "date" && (
                      <p
                        id="link-date-error"
                        className="mt-1 text-xs text-status-danger"
                        role="alert"
                      >
                        {formValidationError.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="link-dj-name" className="app-label">
                      {t("djName")}
                    </label>
                    <ExternalDjCombobox
                      ref={linkDjInputRef}
                      value={formData.dj}
                      contributorId={formData.contributorId}
                      suggestions={currentDjSuggestions}
                      isDirectoryEnabled={formData.kind === "contributor"}
                      isDirectoryLoading={isSuggestionsLoading}
                      directoryError={suggestionsError}
                      disabled={isGenerating}
                      hasError={formValidationError?.field === "dj"}
                      errorId={
                        formValidationError?.field === "dj"
                          ? "link-dj-name-error"
                          : undefined
                      }
                      onChange={handleDjChange}
                    />
                    {formValidationError?.field === "dj" && (
                      <p
                        id="link-dj-name-error"
                        className="mt-1 text-xs text-status-danger"
                        role="alert"
                      >
                        {formValidationError.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="link-event-name" className="app-label">
                    {t("eventName")}
                  </label>
                  <ExternalEventCombobox
                    ref={linkEventInputRef}
                    value={formData.event}
                    suggestions={currentEventSuggestions}
                    isLoading={isSuggestionsLoading}
                    directoryError={suggestionsError}
                    disabled={isGenerating}
                    hasError={formValidationError?.field === "event"}
                    errorId={
                      formValidationError?.field === "event"
                        ? "link-event-name-error"
                        : undefined
                    }
                    onChange={(value) => {
                      clearFormFieldError("event");
                      setFormData({
                        ...formData,
                        event: value,
                      });
                    }}
                  />
                  {formValidationError?.field === "event" && (
                    <p
                      id="link-event-name-error"
                      className="mt-1 text-xs text-status-danger"
                      role="alert"
                    >
                      {formValidationError.message}
                    </p>
                  )}
                </div>

                <fieldset
                  aria-invalid={
                    formValidationError?.field === "kind" || undefined
                  }
                  aria-describedby={
                    formValidationError?.field === "kind" ? "link-kind-error" : undefined
                  }
                >
                  <legend className="app-label">{t("accessType")}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([
                      {
                        value: "contributor",
                        label: t("contributorLink"),
                        help: t("contributorLinkHelp"),
                      },
                      {
                        value: "self_rsvp",
                        label: t("selfRsvpLink"),
                        help: t("selfRsvpLinkHelp"),
                      },
                    ] as const).map((option, index) => (
                      <label
                        key={option.value}
                        className={`min-h-20 cursor-pointer rounded-control border p-3 transition-colors ${
                          formData.kind === option.value
                            ? "border-border-strong bg-surface-active"
                            : "border-border-default bg-canvas hover:border-border-strong"
                        }`}
                      >
                        <span className="flex items-start gap-2">
                          <input
                            ref={index === 0 ? linkKindInputRef : undefined}
                            type="radio"
                            name="link-kind"
                            value={option.value}
                            checked={formData.kind === option.value}
                            disabled={isGenerating}
                            onChange={() => {
                              clearFormFieldError("kind");
                              setFormData({
                                ...formData,
                                kind: option.value,
                                contributorId:
                                  option.value === "self_rsvp"
                                    ? null
                                    : formData.contributorId,
                              });
                            }}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-action-primary"
                          />
                          <span>
                            <span className="block text-sm font-semibold text-text-heading">
                              {option.label}
                            </span>
                            <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                              {option.help}
                            </span>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {formValidationError?.field === "kind" && (
                    <p id="link-kind-error" className="mt-1 text-xs text-status-danger" role="alert">
                      {formValidationError.message}
                    </p>
                  )}
                </fieldset>

                <div>
                  <label htmlFor="link-max-guests" className="app-label">
                    {t("maxGuests")}
                  </label>
                  <input
                    id="link-max-guests"
                    name="max-guests"
                    ref={linkMaxGuestsInputRef}
                    type="number"
                    autoComplete="off"
                    min="1"
                    max="999"
                    step="1"
                    value={formData.maxGuests}
                    disabled={isGenerating}
                    aria-invalid={
                      formValidationError?.field === "maxGuests" || undefined
                    }
                    aria-describedby={
                      formValidationError?.field === "maxGuests"
                        ? "link-max-guests-error"
                        : undefined
                    }
                    onChange={(e) => {
                      clearFormFieldError("maxGuests");
                      setFormData({
                        ...formData,
                        maxGuests:
                          e.target.value === "" ? "" : Number(e.target.value),
                      });
                    }}
                    className={`app-field ${
                      formValidationError?.field === "maxGuests"
                        ? "border-status-danger"
                        : "border-border-strong"
                    }`}
                    required
                  />
                  {formValidationError?.field === "maxGuests" && (
                    <p
                      id="link-max-guests-error"
                      className="mt-1 text-xs text-status-danger"
                      role="alert"
                    >
                      {formValidationError.message}
                    </p>
                  )}
                </div>

                <fieldset
                  aria-invalid={
                    formValidationError?.field === "localeMode" || undefined
                  }
                  aria-describedby={
                    formValidationError?.field === "localeMode"
                      ? "link-locale-error"
                      : undefined
                  }
                >
                  <legend className="app-label">{t("guestPageLanguage")}</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: "auto", label: t("auto") },
                      { value: "en", label: commonT("english") },
                      { value: "ko", label: commonT("korean") },
                    ] as const).map((option) => (
                      <button
                        key={option.value}
                        ref={
                          option.value === "auto"
                            ? linkLocaleInputRef
                            : undefined
                        }
                        type="button"
                        disabled={isGenerating}
                        aria-pressed={formData.localeMode === option.value}
                        onClick={() => {
                          clearFormFieldError("localeMode");
                          setFormData({ ...formData, localeMode: option.value });
                        }}
                        className={`min-h-11 border px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                          formData.localeMode === option.value
                            ? "border-border-strong bg-surface-active text-text-heading"
                            : "border-border-default bg-canvas text-text-muted hover:border-border-strong hover:text-text-heading"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="app-helper">
                    {t("autoHelp")}
                  </p>
                  {formValidationError?.field === "localeMode" && (
                    <p
                      id="link-locale-error"
                      className="mt-1 text-xs text-status-danger"
                      role="alert"
                    >
                      {formValidationError.message}
                    </p>
                  )}
                </fieldset>

                <Button
                  type="submit"
                  isLoading={isGenerating}
                  fullWidth
                  size="lg"
                >
                  {isGenerating ? t("generating") : t("generateLink")}
                </Button>
              </form>
            </div>

            {scopedGeneratedLink && (
              <div
                ref={generatedLinkPanelRef}
                className="app-panel p-4 outline-none sm:p-6"
                role="region"
                aria-labelledby="generated-link-title"
                aria-describedby="generated-link-summary"
                tabIndex={-1}
              >
                <div className="mb-4">
                  <h3 id="generated-link-title" className="type-panel-title mb-2">
                    {t("generatedAccessLink")}
                  </h3>
                  <p
                    id="generated-link-summary"
                    className="break-words font-mono text-xs text-text-muted"
                  >
                    {scopedGeneratedLink.djName} / {scopedGeneratedLink.event} | {t("max")}:{" "}
                    {scopedGeneratedLink.maxGuests}
                  </p>
                  <p className="mt-1 font-mono text-xs text-text-dim">
                    {t("language")}: {localeModeLabel(scopedGeneratedLink.localeMode)}
                  </p>
                  <p className="mt-1 text-xs text-text-dim">
                    {t("accessType")}: {scopedGeneratedLink.kind === "self_rsvp" ? t("selfRsvpLink") : t("contributorLink")}
                  </p>
                </div>

                <div className="mb-4">
                  <label htmlFor="generated-guest-url" className="app-label">
                    {t("guestUrl")}
                  </label>
                  <input
                    id="generated-guest-url"
                    type="text"
                    autoComplete="off"
                    readOnly
                    value={getGuestPageUrl(scopedGeneratedLink.token, scopedGeneratedLink.guestUrl)}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    className="app-field min-w-0 text-sm"
                  />
                </div>

                <Button
                  type="button"
                  onClick={() =>
                    create.shareOrCopyGeneratedLink(
                      getGuestPageUrl(
                        scopedGeneratedLink.token,
                        scopedGeneratedLink.guestUrl,
                      ),
                    )
                  }
                  isLoading={isGeneratedLinkActionPending}
                  fullWidth
                >
                  {isGeneratedLinkActionPending
                    ? nativeShareAvailable
                      ? t("sharing")
                      : t("copying")
                    : nativeShareAvailable
                      ? t("shareLink")
                      : t("copyLink")}
                </Button>
              </div>
            )}
          </div>
          </Sheet>
        )}

        {activeTab === "manage" && (
          <div className="space-y-4">
            {scopedManageError && !visibleLinkId && <Alert type="error" message={scopedManageError} />}

            <div className="record-collection">
              <PanelHeader
                title={t("linkList")}
                count={isCurrentScopeFetching ? undefined : sortedLinks.length}
                onRefresh={loadLinks}
                isLoading={isCurrentScopeFetching}
              />

              <div className="border-b border-border-subtle py-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: "all", label: t("all"), count: dashboardStats.total },
                      { key: "active", label: t("active"), count: dashboardStats.active },
                      { key: "attention", label: t("attention"), count: dashboardStats.attention },
                    ].map((filter) => (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setManageFilter(filter.key as ManageFilter)}
                        aria-pressed={manageFilter === filter.key}
                        className={`min-h-11 border px-3 py-2 text-xs font-medium transition-colors ${
                          manageFilter === filter.key
                            ? "border-border-strong bg-surface-active text-text-heading"
                            : "border-border-default bg-canvas text-text-muted hover:border-border-strong hover:text-text-heading"
                        }`}
                      >
                        {filter.label} {isCurrentScopeFetching ? "—" : filter.count}
                      </button>
                    ))}
                  </div>

                  {manageScope === "date" && (
                    <div className="min-w-[190px]">
                      <label htmlFor="link-sort" className="app-label">
                        {t("sort")}
                      </label>
                      <div className="relative">
                        <select
                          id="link-sort"
                          name="link-sort"
                          value={manageSort}
                          autoComplete="off"
                          onChange={(event) =>
                            setManageSort(event.target.value as ManageSort)
                          }
                          className="app-field min-h-11 appearance-none py-2.5 pl-4 pr-12 text-xs"
                        >
                          <option value="newest">{t("newestCreated")}</option>
                          <option value="expiresSoonest">{t("expiresSoonest")}</option>
                          <option value="djName">{t("djName")}</option>
                        </select>
                        <Icon
                          name="chevron-down"
                          size={16}
                          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-muted"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <p className="mt-3 text-xs text-text-dim">
                  {manageScope === "recent"
                    ? t("latestCreated", { count: sortedLinks.length })
                    : formatDateDisplay(selectedDate, locale)}
                </p>
              </div>

              {listState === "loading" ? (
                <Skeleton rows={10} />
              ) : listState === "error" ? null : (
                <div
                  aria-busy={isCurrentScopeFetching}
                  className={`record-list ${
                    isCurrentScopeFetching ? "pointer-events-none" : ""
                  }`}
                >
                  {shouldShowEmptyState(listState) ? (
                    <EmptyState
                      icon="link"
                      message={t("noLinks")}
                    />
                  ) : (
                    sortedLinks.map((link) => {
                      const status = deriveLinkStatus(link, now);
                      const guestPageUrl = getGuestPageUrl(link.token, link.guestUrl);
                      const isLinkVisible = visibleLinkId === link.id;
                      const completedLinkAction =
                        linkActionFeedback?.id === link.id
                          ? linkActionFeedback.result
                          : null;
                      const usageTone = status.full
                        ? "bg-status-danger"
                        : status.usagePercent >= 80
                          ? "bg-text-muted"
                          : "bg-text-heading";

                      const primaryStatus: { label: string; tone: RecordStatusTone } = status.expired
                        ? { label: t("expired"), tone: "danger" }
                        : status.inactive
                          ? { label: t("inactive"), tone: "inactive" }
                          : status.full
                            ? { label: t("full"), tone: "danger" }
                            : status.expiringSoon
                              ? { label: t("expiring"), tone: "waiting" }
                              : { label: t("active"), tone: "ok" };

                      return (
                      <article key={link.id} className="record-row">
                        <div className="record-summary">
                          <button type="button" className="record-open" onClick={() => { setPendingDeleteLink(null); setPendingDeactivateId(null); setVisibleLinkId(isLinkVisible ? null : link.id); }} disabled={lifecycleBusy} aria-expanded={isLinkVisible} aria-controls={isLinkVisible ? `link-detail-${link.id}` : undefined}>
                            <span className="record-identity"><strong id={`link-label-${link.id}`}>{link.djName}</strong><small>{link.event || t("untitledEvent")} · {link.date ? formatDateDisplay(link.date, locale) : t("noDate")}</small></span>
                            <span className="record-value">{link.usedGuests}/{link.maxGuests}</span>
                            <RecordStatus tone={primaryStatus.tone}>{primaryStatus.label}</RecordStatus>
                          </button>
                          {/* Expired or disabled links cannot register guests, so the list does not offer them for sharing. */}
                          {!status.expired && !status.inactive && <div hidden={pendingDeleteLink?.id === link.id || pendingDeactivateId === link.id}><Button variant="secondary" size="sm" onClick={() => shareOrCopyManagedLink(guestPageUrl, link.id)} isLoading={loadingStates[`share_${link.id}`]}>
                            {completedLinkAction === "shared" ? t("shared") : completedLinkAction === "copied" ? t("copied") : nativeShareAvailable ? t("shareLink") : t("copyLink")}
                          </Button></div>}
                        </div>
                        {isLinkVisible && <Sheet labelledBy={`link-label-${link.id}`} id={`link-detail-${link.id}`} title={link.djName} presentation="detail" onClose={() => { setPendingDeleteLink(null); setPendingDeactivateId(null); setVisibleLinkId(null); }} busy={Boolean(lifecycleBusyIds[link.id])}>
                          {scopedManageError && <Alert type="error" message={scopedManageError} />}
                          <div className="flex flex-wrap items-center gap-2">
                            <RecordStatus tone={primaryStatus.tone}>{primaryStatus.label}</RecordStatus>
                            <p className="text-sm text-text-muted">{link.event || t("untitledEvent")} · {link.kind === "self_rsvp" ? t("selfRsvpLink") : t("contributorLink")}</p>
                          </div>
                        <dl className="record-detail-grid">
                          <div>
                            <dt className="text-xs text-text-dim">{t("eventDate")}</dt>
                            <dd className="mt-0.5 font-mono text-xs text-text-muted">
                              {link.date ? formatDateDisplay(link.date, locale) : t("noDate")}
                            </dd>
                          </div>
                          {manageScope === "recent" && (
                            <div>
                              <dt className="text-xs text-text-dim">{t("created")}</dt>
                              <dd className="mt-0.5 font-mono text-xs text-text-muted">
                                {formatTimestamp(
                                  link.createdAt,
                                  t("unknownTime"),
                                  t("invalidTime"),
                                  locale === "ko" ? "ko-KR" : "en-US",
                                  currentVenue?.timezone,
                                )}
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt className="text-xs text-text-dim">{t("usage")}</dt>
                            <dd className="mt-0.5 font-mono text-xs text-text-heading">
                              {link.usedGuests}/{link.maxGuests}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-text-dim">{t("expiry")}</dt>
                            <dd className={`mt-0.5 font-mono text-xs ${status.expired ? "text-status-danger" : "text-text-muted"}`}>
                              {formatRelativeExpiry(link.expiresAt, now, {
                                noExpiry: t("noExpiry"),
                                invalidExpiry: t("invalidExpiry"),
                                expiredAgo: (duration) => t("expiredAgo", { duration }),
                                expiresIn: (duration) => t("expiresIn", { duration }),
                                formatDuration: ({ days, hours, minutes }) =>
                                  days > 0
                                    ? t("durationDaysHours", { days, hours })
                                    : hours > 0
                                      ? t("durationHoursMinutes", { hours, minutes })
                                      : t("durationMinutes", { minutes }),
                              })}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-text-dim">{t("language")}</dt>
                            <dd className="mt-0.5 text-xs text-text-muted">
                              {localeModeLabel(link.localeMode)}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-3">
                          <div className="h-1 w-full bg-surface-active">
                            <div
                              className={`h-1 ${usageTone}`}
                              style={{ width: `${status.usagePercent}%` }}
                            />
                          </div>
                        </div>

                        {isLinkVisible && (
                          <div
                            id={`link-url-panel-${link.id}`}
                            className="mt-4"
                          >
                            <label
                              htmlFor={`link-url-${link.id}`}
                              className="app-label"
                            >
                              {t("guestUrl")}
                            </label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                id={`link-url-${link.id}`}
                                name={`link-url-${link.id}`}
                                type="text"
                                autoComplete="off"
                                readOnly
                                value={guestPageUrl}
                                onFocus={(event) => event.currentTarget.select()}
                                onClick={(event) => event.currentTarget.select()}
                                className="app-field min-h-11 min-w-0 flex-1 font-mono text-xs"
                              />
                              <a
                                href={guestPageUrl}
                                target="_blank"
                                rel="noreferrer"
                                data-variant="secondary"
                                className={getButtonClassName({ variant: "secondary", size: "sm" })}
                              >
                                {t("open")}
                              </a>
                            </div>
                          </div>
                        )}

                        <LinkRegisteredGuests key={`${venueId}:${link.id}`} venueId={venueId} linkId={link.id}
                          registeredCount={link.usedGuests} timeZone={currentVenue?.timezone} />

                        <div hidden={pendingDeleteLink?.id === link.id || pendingDeactivateId === link.id}><div className="mt-3 flex flex-wrap justify-end gap-3">
                          <Button
                            type="button"
                            onClick={() => handleUseAsTemplate(link)}
                            variant="ghost"
                            size="sm"
                            className="border border-border-default bg-surface"
                          >
                            {t("useAsTemplate")}
                          </Button>

                          <Button
                            type="button"
                            onClick={() =>
                              shareOrCopyManagedLink(guestPageUrl, link.id)
                            }
                            isLoading={loadingStates[`share_${link.id}`]}
                            size="sm"
                          >
                            {loadingStates[`share_${link.id}`]
                              ? nativeShareAvailable
                                ? t("sharing")
                                : t("copying")
                              : completedLinkAction === "shared"
                                ? t("shared")
                                : completedLinkAction === "copied"
                                  ? t("copied")
                                  : nativeShareAvailable
                                    ? t("shareLink")
                                    : t("copyLink")}
                          </Button>
                          {status.expired ? (
                            <RecordStatus tone="danger" className="inline-flex min-h-11 items-center px-3">
                              {t("expired")}
                            </RecordStatus>
                          ) : link.active ? (
                            <Button
                              type="button"
                              onClick={() => { setPendingDeleteLink(null); setPendingDeactivateId(link.id); }}
                              variant="secondary"
                              size="sm"
                              disabled={Boolean(lifecycleBusyIds[link.id])}
                              isLoading={loadingStates[`deactivate_${link.id}`]}
                            >
                              {t("deactivate")}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              onClick={() => handleActivateLink(link.id)}
                              variant="secondary"
                              size="sm"
                              disabled={Boolean(lifecycleBusyIds[link.id])}
                              isLoading={loadingStates[`activate_${link.id}`]}
                            >
                              {t("activate")}
                            </Button>
                          )}
                          <Button
                            type="button"
                            onClick={() => { setPendingDeactivateId(null); requestDeleteLink(link); }}
                            variant="danger"
                            size="sm"
                            disabled={Boolean(lifecycleBusyIds[link.id])}
                            isLoading={loadingStates[`delete_${link.id}`]}
                          >
                            {t("delete")}
                          </Button>
                        </div>
                        </div>
                        <ConfirmDialog
                          open={pendingDeactivateId === link.id}
                          title={t("deactivateTitle")}
                          description={t("deactivateDescription")}
                          confirmLabel={t("deactivate")}
                          cancelLabel={commonT("cancel")}
                          onConfirm={async () => {
                            await handleDeactivateLink(link.id);
                            setPendingDeactivateId((current) => current === link.id ? null : current);
                          }}
                          onCancel={() => setPendingDeactivateId(null)}
                          isLoading={loadingStates[`deactivate_${link.id}`]}
                        />
                        {pendingDeleteLink?.id === link.id && (
                          <ConfirmDialog
                            open
                            title={t("deleteTitle")}
                            description={t("deleteDescription")}
                            confirmLabel={t("deleteLink")}
                            cancelLabel={commonT("cancel")}
                            onConfirm={() => handleDeleteLink(pendingDeleteLink.id)}
                            onCancel={() => setPendingDeleteLink(null)}
                            isLoading={loadingStates[`delete_${pendingDeleteLink.id}`]}
                          >
                            <div className="rounded-control border border-border-subtle bg-surface-raised p-3">
                              <p className="break-words text-sm font-medium text-text-heading">
                                {pendingDeleteLink.djName} / {pendingDeleteLink.event}
                              </p>
                              <p className="mt-2 text-xs text-text-muted">
                                {t("usage")} {pendingDeleteLink.usedGuests}/{pendingDeleteLink.maxGuests}
                              </p>
                            </div>
                          </ConfirmDialog>
                        )}
                        </Sheet>}
                      </article>
                    )})
                  )}
                </div>
              )}
              <div ref={loadMoreRef} className="py-4">
                {isLoadingMore && <Skeleton rows={10} />}
                {loadMoreError && <Alert type="error" message={loadMoreError} />}
                {hasMore && <Button variant="outline" onClick={() => void loadMore()} disabled={isLoadingMore || isCurrentScopeFetching || lifecycleBusy}>
                  {loadMoreError ? commonT("retry") : t("loadMore")}
                </Button>}
                {!isCurrentScopeFetching && listState === "success-data" && <p role="status" className="mt-3 text-xs text-text-muted">
                  {t(hasMore ? "loadedCount" : "allLoaded", { count: sortedLinks.length })}
                </p>}
              </div>
            </div>
          </div>
        )}
      </div>
      </OperationsLayout>

    </>
  );
}
