"use client";

import Sheet, { requestSheetClose } from "@/components/overlays/Sheet";
import RecordList, { useRecordDetail } from "@/components/records/RecordList";

import { fetchVenues } from "@/lib/venues/client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createVenue,
  updateVenue,
} from "../../../lib/api/venues";
import type { Venue } from "@/lib/venues/types";
import StatGrid from "../../../components/StatGrid";
import PanelHeader from "../../../components/PanelHeader";
import Alert from "../../../components/Alert";
import EmptyState from "../../../components/EmptyState";
import Skeleton from "../../../components/Skeleton";
import OperationsLayout from "../../../components/OperationsLayout";
import OperationalSectionNav from "../../../components/OperationalSectionNav";
import ConfirmDialog from "../../../components/ConfirmDialog";
import Button from "../../../components/Button";
import { captureImmutableDraft } from "../../../lib/forms/immutable-draft";
import { shouldShowEmptyState } from "../../../lib/ui/async-list-state";
import { getVenueTypeColor } from "../../../lib/colors";
import { useTranslations } from "next-intl";
import { useVenueSelector } from "../../../components/VenueSelector";
import {
  VENUE_MUTATION_ERROR_KEYS,
  selectDomainMessageKey,
} from "../../../lib/api/domain-error";
import useVenueDirectoryController, {
  type VenueDirectoryControllerDependencies,
  type VenueDirectoryMutationResult,
  type VenueMutationMessageResolver,
  type VenueUpdateInput,
} from "./useVenueDirectoryController";
import useVenueCreateController, {
  type VenueCreateControllerDependencies,
} from "./useVenueCreateController";

const VENUE_TYPES = [
  { value: "club", label: "CLUB" },
  { value: "bar", label: "BAR" },
  { value: "lounge", label: "LOUNGE" },
  { value: "festival", label: "FESTIVAL" },
  { value: "private", label: "PRIVATE" },
] as const;

const TIMEZONE_OPTIONS = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
] as const;

export type VenueManagementSection = "list" | "create";

interface VenueManagementProps {
  activeSection?: VenueManagementSection;
  onActiveSectionChange?: (section: VenueManagementSection) => void;
  showSectionNavigation?: boolean;
}

const VENUE_MANAGEMENT_ACTIONS: VenueDirectoryControllerDependencies &
  VenueCreateControllerDependencies = Object.freeze({
  fetchVenues,
  createVenue,
  updateVenue,
});

export default function VenueManagement({
  activeSection,
  onActiveSectionChange,
  showSectionNavigation = true,
}: VenueManagementProps = {}) {
  const t = useTranslations("VenueAdmin");
  const commonT = useTranslations("Common");
  const venueTypeLabels: Record<Venue["type"], string> = {
    club: t("typeClub"),
    bar: t("typeBar"),
    lounge: t("typeLounge"),
    festival: t("typeFestival"),
    private: t("typePrivate"),
  };
  const [internalActiveSection, setInternalActiveSection] =
    useState<VenueManagementSection>("list");
  const activeTab = activeSection ?? internalActiveSection;
  const setActiveTab = useCallback(
    (section: VenueManagementSection) => {
      if (onActiveSectionChange) {
        onActiveSectionChange(section);
        return;
      }
      setInternalActiveSection(section);
    },
    [onActiveSectionChange],
  );
  const { refreshVenues: refreshActiveVenues, venueLoadError, isLoadingVenues } = useVenueSelector();
  const resolveMutationMessage = useCallback<VenueMutationMessageResolver>(
    (error, fallback) =>
      t(selectDomainMessageKey(error, VENUE_MUTATION_ERROR_KEYS, fallback)),
    [t],
  );
  const directory = useVenueDirectoryController({
    dependencies: VENUE_MANAGEMENT_ACTIONS,
    refreshActiveVenues,
    resolveMutationMessage,
  });
  const create = useVenueCreateController({
    dependencies: VENUE_MANAGEMENT_ACTIONS,
    onCreated: directory.refreshAfterMutation,
    resolveMutationMessage,
  });
  const {
    venues,
    isLoading,
    isMutating,
    listError,
    listState,
    refreshAfterMutation: refreshVenues,
    handleToggleActive,
    handleSave,
  } = directory;
  const {
    formData,
    setFormData,
    formError,
    formSuccess,
    isSubmitting,
    hasNameValidationError,
    nameInputRef,
    handleCreate,
  } = create;
  const directoryError = listError || (venueLoadError ? t("loadFailed") : "");
  const isRefreshing = isLoading || isLoadingVenues;
  const countsUnavailable = listState === "error";

  return (
    <OperationsLayout
      variant="stacked"
      width={activeTab === "create" ? "form" : "full"}
      title={t("title")}
      headingLevel={null}
      dashboard={
        <>
        {showSectionNavigation && (
          <OperationalSectionNav
            label={t("section")}
            items={[
              { id: "create", label: t("create"), icon: "add" },
              { id: "list", label: t("venues"), icon: "store" },
            ]}
            activeId={activeTab}
            onChange={setActiveTab}
          />
        )}

        {activeTab === "list" && (
          <div>
            <StatGrid
              variant="inline"
              isLoading={isLoading}
              items={[
                {
                  label: t("totalVenues"),
                  value: countsUnavailable ? "—" : venues.length,
                  color: "default",
                },
                {
                  label: t("active"),
                  value: countsUnavailable ? "—" : venues.filter((v) => v.active).length,
                  color: "default",
                },
                {
                  label: t("inactive"),
                  value: countsUnavailable ? "—" : venues.filter((v) => !v.active).length,
                  color: "danger",
                },
              ]}
            />
          </div>
        )}
        </>
      }
    >

      {/* Main content */}
      <div className="min-w-0">
        {activeTab === "create" && (
          <div className="record-form space-y-6">
            <div className="app-panel record-form-panel">
              <h3 className="record-form-title">
                {t("createNew")}
              </h3>

              <form onSubmit={handleCreate} aria-busy={isSubmitting}>
                <fieldset disabled={isSubmitting} className="record-form-fields">
                <div>
                  <label htmlFor="venue-create-name" className="app-label">
                    {t("venueName")}
                  </label>
                  <input
                    ref={nameInputRef}
                    id="venue-create-name"
                    name="venue-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="app-field"
                    placeholder={t("namePlaceholder")}
                    autoComplete="off"
                    required
                    aria-invalid={hasNameValidationError}
                    aria-describedby={
                      hasNameValidationError
                        ? "venue-create-name-error"
                        : undefined
                    }
                  />
                </div>

                <fieldset>
                  <legend className="app-label">
                    {t("type")}
                  </legend>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                    {VENUE_TYPES.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={formData.type === opt.value}
                        onClick={() =>
                          setFormData({
                            ...formData,
                            type: opt.value as Venue["type"],
                          })
                        }
                      className={`min-h-11 border p-3 text-xs font-medium transition-colors ${
                          formData.type === opt.value
                            ? "border-border-strong bg-surface-active text-text-heading"
                            : "bg-canvas text-text-muted border-border-default hover:text-text-heading hover:border-border-strong"
                        }`}
                      >
                        {venueTypeLabels[opt.value]}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="venue-create-address" className="app-label">
                    {t("address")} <span className="text-text-dim">({t("optional")})</span>
                  </label>
                  <input
                    id="venue-create-address"
                    name="venue-address"
                    type="text"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="app-field"
                    placeholder={t("addressPlaceholder")}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label htmlFor="venue-create-timezone" className="app-label">
                    {t("timezone")}
                  </label>
                  <input
                    id="venue-create-timezone"
                    name="venue-timezone"
                    type="text"
                    list="venue-timezones"
                    value={formData.timezone}
                    onChange={(event) =>
                      setFormData({ ...formData, timezone: event.target.value })
                    }
                    className="app-field"
                    placeholder="Asia/Seoul"
                    autoComplete="off"
                    required
                  />
                  <datalist id="venue-timezones">
                    {TIMEZONE_OPTIONS.map((timezone) => (
                      <option key={timezone} value={timezone} />
                    ))}
                  </datalist>
                  <p className="app-helper">{t("timezoneHelp")}</p>
                </div>

                <fieldset>
                  <legend className="app-label">{t("operatingHours")}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="venue-create-opening-time" className="app-label">
                        {t("openingTime")}
                      </label>
                      <input
                        id="venue-create-opening-time"
                        name="venue-opening-time"
                        type="time"
                        value={formData.openingTime}
                        onChange={(event) =>
                          setFormData({ ...formData, openingTime: event.target.value })
                        }
                        className="app-field"
                        autoComplete="off"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="venue-create-closing-time" className="app-label">
                        {t("closingTime")}
                      </label>
                      <input
                        id="venue-create-closing-time"
                        name="venue-closing-time"
                        type="time"
                        value={formData.closingTime}
                        onChange={(event) =>
                          setFormData({ ...formData, closingTime: event.target.value })
                        }
                        className="app-field"
                        autoComplete="off"
                        required
                      />
                    </div>
                  </div>
                  <p className="app-helper">{t("operatingHoursHelp")}</p>
                </fieldset>

                <div>
                  <label htmlFor="venue-create-description" className="app-label">
                    {t("description")}{" "}
                    <span className="text-text-dim">({t("optional")})</span>
                  </label>
                  <textarea
                    id="venue-create-description"
                    name="venue-description"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="app-field resize-none"
                    rows={3}
                    placeholder={t("descriptionPlaceholder")}
                    autoComplete="off"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="venue-create-brand-name" className="app-label">
                      {t("displayName")} <span className="text-text-dim">({t("optional")})</span>
                    </label>
                    <input
                      id="venue-create-brand-name"
                      name="venue-brand-name"
                      type="text"
                      value={formData.brandName}
                      onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                      className="app-field"
                      placeholder={t("displayNamePlaceholder")}
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label htmlFor="venue-create-brand-tagline" className="app-label">
                      {t("tagline")} <span className="text-text-dim">({t("optional")})</span>
                    </label>
                    <input
                      id="venue-create-brand-tagline"
                      name="venue-brand-tagline"
                      type="text"
                      value={formData.brandTagline}
                      onChange={(e) => setFormData({ ...formData, brandTagline: e.target.value })}
                      className="app-field"
                      placeholder={t("taglinePlaceholder")}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="venue-create-domain" className="app-label">
                    {t("primaryDomain")} <span className="text-text-dim">({t("optional")})</span>
                  </label>
                  <input
                    id="venue-create-domain"
                    name="venue-primary-domain"
                    type="text"
                    inputMode="url"
                    value={formData.primaryDomain}
                    onChange={(e) => setFormData({ ...formData, primaryDomain: e.target.value })}
                    className="app-field"
                    placeholder="guest.example.com"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="app-helper">{t("domainHelp")}</p>
                </div>

                <div>
                  <label htmlFor="venue-create-default-locale" className="app-label">
                    {t("domainDefaultLanguage")}
                  </label>
                  <select
                    id="venue-create-default-locale"
                    name="venue-default-locale"
                    value={formData.defaultLocale}
                    autoComplete="off"
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        defaultLocale: event.target.value as "en" | "ko",
                      })
                    }
                    className="app-field"
                  >
                    <option value="en">{commonT("english")}</option>
                    <option value="ko">{commonT("korean")}</option>
                  </select>
                  <p className="app-helper">
                    {t("domainLanguageHelp")}
                  </p>
                </div>

                {formError && (
                  <div
                    id={
                      hasNameValidationError
                        ? "venue-create-name-error"
                        : undefined
                    }
                  >
                    <Alert type="error" message={formError} />
                  </div>
                )}

                {formSuccess && <Alert type="success" message={formSuccess} />}

                <Button
                  type="submit"
                  isLoading={isSubmitting}
                  fullWidth
                  size="lg"
                >
                  {isSubmitting ? t("creating") : t("createVenue")}
                </Button>
                </fieldset>
              </form>
            </div>
          </div>
        )}

        {activeTab === "list" && (
          <div className="record-collection">
            <PanelHeader
              title={t("venueList")}
              count={countsUnavailable ? undefined : venues.length}
              onRefresh={() => void refreshVenues()}
              isLoading={isRefreshing}
            />
            <div className="record-collection-body">
              {directoryError && <Alert type="error" message={directoryError} className="mb-4" />}
              {listState === "loading" ? (
                <Skeleton rows={4} />
              ) : shouldShowEmptyState(listState) ? (
                <EmptyState icon="store" message={t("noVenues")} />
              ) : (
                <RecordList
                  aria-busy={isLoading}
                  className={`${
                    isLoading ? "pointer-events-none" : ""
                  }`}
                >
                  {venues.map((venue) => (
                    <VenueCard
                      key={venue.id}
                      venue={venue}
                      error={listError}
                      actionsDisabled={isLoading || isMutating}
                      onToggleActive={handleToggleActive}
                      onSave={handleSave}
                    />
                  ))}
                </RecordList>
              )}
            </div>
          </div>
        )}
      </div>
    </OperationsLayout>
  );
}

// ============================================================
// VenueCard sub-component
// ============================================================

type VenueEditData = {
  name: Venue["name"];
  type: Venue["type"];
  address: string;
  description: string;
  brandName: string;
  brandTagline: string;
  primaryDomain: string;
  defaultLocale: NonNullable<Venue["defaultLocale"]>;
  timezone: Venue["timezone"];
  openingTime: Venue["openingTime"];
  closingTime: Venue["closingTime"];
};

function createVenueEditData(venue: Venue): VenueEditData {
  return {
    name: venue.name,
    type: venue.type,
    address: venue.address || "",
    description: venue.description || "",
    brandName: venue.brandName || "",
    brandTagline: venue.brandTagline || "",
    primaryDomain: venue.primaryDomain || "",
    defaultLocale: venue.defaultLocale || "en",
    timezone: venue.timezone,
    openingTime: venue.openingTime,
    closingTime: venue.closingTime,
  };
}

export function VenueCard({
  venue,
  error,
  actionsDisabled,
  onToggleActive,
  onSave,
}: {
  venue: Venue;
  error?: string | null;
  actionsDisabled: boolean;
  onToggleActive: (venue: Venue) => Promise<VenueDirectoryMutationResult>;
  onSave: (
    id: string,
    updates: VenueUpdateInput,
  ) => Promise<VenueDirectoryMutationResult>;
}) {
  const t = useTranslations("VenueAdmin");
  const commonT = useTranslations("Common");
  const venueTypeLabels: Record<Venue["type"], string> = {
    club: t("typeClub"),
    bar: t("typeBar"),
    lounge: t("typeLounge"),
    festival: t("typeFestival"),
    private: t("typePrivate"),
  };
  const detail = useRecordDetail(venue.id);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(() => createVenueEditData(venue));
  const [editNameError, setEditNameError] = useState("");
  const [isDeactivateConfirmOpen, setIsDeactivateConfirmOpen] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editNameInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusEditNameRef = useRef(false);
  const shouldRestoreEditButtonFocusRef = useRef(false);
  const saveOperationOwnerRef = useRef<symbol | null>(null);
  const toggleOperationOwnerRef = useRef<symbol | null>(null);

  useEffect(() => {
    if (
      isEditing &&
      !actionsDisabled &&
      shouldFocusEditNameRef.current
    ) {
      shouldFocusEditNameRef.current = false;
      editNameInputRef.current?.focus();
      return;
    }
    if (
      !isEditing &&
      !actionsDisabled &&
      shouldRestoreEditButtonFocusRef.current
    ) {
      shouldRestoreEditButtonFocusRef.current = false;
      editButtonRef.current?.focus();
    }
  }, [actionsDisabled, isEditing]);

  const handleEdit = () => {
    if (actionsDisabled) return;
    setEditData(createVenueEditData(venue));
    setEditNameError("");
    shouldFocusEditNameRef.current = true;
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditData(createVenueEditData(venue));
    setEditNameError("");
    shouldRestoreEditButtonFocusRef.current = true;
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (actionsDisabled || saveOperationOwnerRef.current) return;
    const draft = captureImmutableDraft(editData);
    if (!draft.name.trim()) {
      setEditNameError(t("nameRequired"));
      editNameInputRef.current?.focus();
      return;
    }
    const owner = Symbol("venue-card-save");
    saveOperationOwnerRef.current = owner;
    setEditNameError("");
    setIsSaving(true);
    try {
      const result = await onSave(venue.id, {
        name: draft.name,
        type: draft.type,
        address: draft.address || undefined,
        description: draft.description || undefined,
        brandName: draft.brandName,
        brandTagline: draft.brandTagline,
        primaryDomain: draft.primaryDomain,
        defaultLocale: draft.defaultLocale,
        timezone: draft.timezone,
        openingTime: draft.openingTime,
        closingTime: draft.closingTime,
      });
      if (result.status === "applied") {
        shouldRestoreEditButtonFocusRef.current = true;
        setIsEditing(false);
      }
    } finally {
      if (saveOperationOwnerRef.current === owner) {
        saveOperationOwnerRef.current = null;
        setIsSaving(false);
      }
    }
  };

  const handleToggleActive = async () => {
    if (actionsDisabled || toggleOperationOwnerRef.current) return;
    const owner = Symbol("venue-card-toggle");
    toggleOperationOwnerRef.current = owner;
    setIsTogglingActive(true);
    let shouldCloseConfirmation = true;
    try {
      const result = await onToggleActive(venue);
      if (result.status === "busy") shouldCloseConfirmation = false;
    } finally {
      if (toggleOperationOwnerRef.current === owner) {
        toggleOperationOwnerRef.current = null;
        setIsTogglingActive(false);
        if (shouldCloseConfirmation) setIsDeactivateConfirmOpen(false);
      }
    }
  };

  return (
    <>
      <article className="record-row">
        <div className="record-summary">
          <button type="button" className="record-open" onClick={() => detail.open ? requestSheetClose(`venue-detail-${venue.id}`) : detail.show()} disabled={actionsDisabled} aria-expanded={detail.open} aria-controls={detail.open ? `venue-detail-${venue.id}` : undefined}>
            <span className="record-identity"><strong>{venue.name}</strong><small>{venue.primaryDomain || venue.address || venueTypeLabels[venue.type]}</small></span>
            <span className="record-value">{venueTypeLabels[venue.type]}</span>
            <span className="record-status">{venue.active ? t("active") : t("inactive")}</span>
          </button>
        </div>
      {detail.open && <Sheet id={`venue-detail-${venue.id}`} title={venue.name} presentation="detail" size="record" onClose={() => { handleCancelEdit(); detail.close(); }}
        busy={actionsDisabled || isSaving || isTogglingActive} dirty={isEditing && JSON.stringify(editData) !== JSON.stringify(createVenueEditData(venue))}>
        {error && <Alert type="error" message={error} />}
      {!isEditing ? (
        <div className="record-information-grid">
          {venue.description && (
            <p className="col-span-full break-words text-sm leading-relaxed text-text-muted">
              {venue.description}
            </p>
          )}
          <div className="border-b border-border-subtle pb-4">
            <p className="app-label">{t("brandDomain")}</p>
            <p className="break-words text-sm font-medium text-text-heading">
              {venue.brandName || venue.name}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-text-muted">
              {venue.primaryDomain || t("noDomain")}
            </p>
            <p className="mt-1 font-mono text-xs uppercase text-text-dim">
              {t("defaultLanguage")}: {venue.defaultLocale || "en"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 border-b border-border-subtle pb-4">
            <div>
              <p className="text-xs text-text-dim mb-1">
                {t("status")}
              </p>
              <p
                className={`font-mono text-xs sm:text-sm ${venue.active ? "text-text-heading" : "text-status-danger"}`}
              >
                {venue.active ? t("active") : t("inactive")}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-dim mb-1">
                {t("type")}
              </p>
              <p
                className={`font-mono text-xs sm:text-sm ${getVenueTypeColor(venue.type)}`}
              >
                {venueTypeLabels[venue.type]}
              </p>
            </div>
          </div>
          <div className="col-span-full border-b border-border-subtle pb-4">
            <p className="app-label">{t("localOperations")}</p>
            <p className="font-mono text-sm text-text-heading">{venue.timezone}</p>
            <p className="mt-1 font-mono text-xs text-text-muted">
              {venue.openingTime} - {venue.closingTime}
            </p>
          </div>
          <div className="col-span-full flex flex-wrap gap-3">
            <Button
              ref={editButtonRef}
              type="button"
              onClick={handleEdit}
              disabled={actionsDisabled}
              variant="secondary"
              size="sm"
            >
              {t("edit")}
            </Button>
            <Button
              type="button"
              isLoading={isTogglingActive}
              disabled={actionsDisabled}
              onClick={() => {
                if (venue.active) {
                  setIsDeactivateConfirmOpen(true);
                } else {
                  void handleToggleActive();
                }
              }}
              variant={venue.active ? "danger" : "secondary"}
              size="sm"
            >
              {venue.active ? t("deactivate") : t("activate")}
            </Button>
          </div>
        </div>
      ) : (
        <fieldset
          disabled={isSaving || actionsDisabled}
          className="record-form space-y-4"
          aria-busy={isSaving || actionsDisabled}
        >
          <div>
            <label htmlFor={`venue-name-${venue.id}`} className="app-label">
              {t("venueName")}
            </label>
            <input
              ref={editNameInputRef}
              id={`venue-name-${venue.id}`}
              name={`venue-name-${venue.id}`}
              type="text"
              value={editData.name}
              onChange={(e) => {
                setEditData({ ...editData, name: e.target.value });
                if (editNameError) setEditNameError("");
              }}
              className="app-field"
              autoComplete="off"
              required
              aria-invalid={Boolean(editNameError)}
              aria-describedby={
                editNameError ? `venue-name-error-${venue.id}` : undefined
              }
            />
            {editNameError && (
              <div id={`venue-name-error-${venue.id}`}>
                <Alert type="error" message={editNameError} />
              </div>
            )}
          </div>

          <fieldset>
            <legend className="app-label">
              {t("type")}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              {VENUE_TYPES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={editData.type === opt.value}
                  onClick={() =>
                    setEditData({
                      ...editData,
                      type: opt.value as Venue["type"],
                    })
                  }
                  className={`min-h-11 border p-2 text-xs font-medium transition-colors ${
                    editData.type === opt.value
                      ? "border-border-strong bg-surface-active text-text-heading"
                      : "bg-surface-raised text-text-muted border-border-strong hover:text-text-heading hover:border-border-strong"
                  }`}
                >
                  {venueTypeLabels[opt.value]}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`venue-address-${venue.id}`} className="app-label">
              {t("address")}
            </label>
            <input
              id={`venue-address-${venue.id}`}
              name={`venue-address-${venue.id}`}
              type="text"
              value={editData.address}
              onChange={(e) =>
                setEditData({ ...editData, address: e.target.value })
              }
              className="app-field"
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor={`venue-description-${venue.id}`} className="app-label">
              {t("description")}
            </label>
            <textarea
              id={`venue-description-${venue.id}`}
              name={`venue-description-${venue.id}`}
              value={editData.description}
              onChange={(e) =>
                setEditData({ ...editData, description: e.target.value })
              }
              className="app-field resize-none"
              rows={2}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor={`venue-timezone-${venue.id}`} className="app-label">
              {t("timezone")}
            </label>
            <input
              id={`venue-timezone-${venue.id}`}
              name={`venue-timezone-${venue.id}`}
              type="text"
              list={`venue-timezones-${venue.id}`}
              value={editData.timezone}
              onChange={(event) =>
                setEditData({ ...editData, timezone: event.target.value })
              }
              className="app-field"
              autoComplete="off"
              required
            />
            <datalist id={`venue-timezones-${venue.id}`}>
              {TIMEZONE_OPTIONS.map((timezone) => (
                <option key={timezone} value={timezone} />
              ))}
            </datalist>
          </div>

          <fieldset>
            <legend className="app-label">{t("operatingHours")}</legend>
            <div className="record-detail-grid">
              <div>
                <label htmlFor={`venue-opening-time-${venue.id}`} className="app-label">
                  {t("openingTime")}
                </label>
                <input
                  id={`venue-opening-time-${venue.id}`}
                  name={`venue-opening-time-${venue.id}`}
                  type="time"
                  value={editData.openingTime}
                  onChange={(event) =>
                    setEditData({ ...editData, openingTime: event.target.value })
                  }
                  className="app-field"
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label htmlFor={`venue-closing-time-${venue.id}`} className="app-label">
                  {t("closingTime")}
                </label>
                <input
                  id={`venue-closing-time-${venue.id}`}
                  name={`venue-closing-time-${venue.id}`}
                  type="time"
                  value={editData.closingTime}
                  onChange={(event) =>
                    setEditData({ ...editData, closingTime: event.target.value })
                  }
                  className="app-field"
                  autoComplete="off"
                  required
                />
              </div>
            </div>
            <p className="app-helper">{t("operatingHoursHelp")}</p>
          </fieldset>

          <div className="record-detail-grid">
            <div>
              <label htmlFor={`venue-brand-name-${venue.id}`} className="app-label">
                {t("displayName")}
              </label>
              <input
                id={`venue-brand-name-${venue.id}`}
                name={`venue-brand-name-${venue.id}`}
                type="text"
                value={editData.brandName}
                onChange={(e) => setEditData({ ...editData, brandName: e.target.value })}
                className="app-field"
                placeholder={venue.name}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor={`venue-brand-tagline-${venue.id}`} className="app-label">
                {t("tagline")}
              </label>
              <input
                id={`venue-brand-tagline-${venue.id}`}
                name={`venue-brand-tagline-${venue.id}`}
                type="text"
                value={editData.brandTagline}
                onChange={(e) => setEditData({ ...editData, brandTagline: e.target.value })}
                className="app-field"
                placeholder={t("taglinePlaceholder")}
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`venue-domain-${venue.id}`} className="app-label">
              {t("primaryDomain")}
            </label>
            <input
              id={`venue-domain-${venue.id}`}
              name={`venue-domain-${venue.id}`}
              type="text"
              inputMode="url"
              value={editData.primaryDomain}
              onChange={(e) => setEditData({ ...editData, primaryDomain: e.target.value })}
              className="app-field"
              placeholder="guest.example.com"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="app-helper">{t("emptyDomainHelp")}</p>
          </div>

          <div>
            <label htmlFor={`venue-default-locale-${venue.id}`} className="app-label">
              {t("domainDefaultLanguage")}
            </label>
            <select
              id={`venue-default-locale-${venue.id}`}
              name={`venue-default-locale-${venue.id}`}
              value={editData.defaultLocale}
              autoComplete="off"
              onChange={(event) =>
                setEditData({
                  ...editData,
                  defaultLocale: event.target.value as "en" | "ko",
                })
              }
              className="app-field"
            >
              <option value="en">{commonT("english")}</option>
              <option value="ko">{commonT("korean")}</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              onClick={handleSave}
              isLoading={isSaving}
              size="sm"
              fullWidth
            >
              {t("save")}
            </Button>
            <Button
              type="button"
              onClick={handleCancelEdit}
              variant="secondary"
              size="sm"
              fullWidth
            >
              {commonT("cancel")}
            </Button>
          </div>
        </fieldset>
      )}
      <ConfirmDialog
        open={isDeactivateConfirmOpen}
        title={t("deactivateTitle")}
        description={t("deactivateDescription", { name: venue.name })}
        confirmLabel={t("deactivate")}
        cancelLabel={commonT("cancel")}
        onConfirm={() => void handleToggleActive()}
        onCancel={() => setIsDeactivateConfirmOpen(false)}
        isLoading={isTogglingActive}
        confirmDisabled={actionsDisabled}
      />
      </Sheet>}
      </article>
    </>
  );
}
