"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchVenues,
  createVenue,
  updateVenue,
} from "../../../lib/api/venues";
import type { Venue } from "../../../lib/api/types";
import StatGrid from "../../../components/StatGrid";
import PanelHeader from "../../../components/PanelHeader";
import Alert from "../../../components/Alert";
import EmptyState from "../../../components/EmptyState";
import Skeleton from "../../../components/Skeleton";
import OperationsLayout from "../../../components/OperationsLayout";
import OperationalSectionNav from "../../../components/OperationalSectionNav";
import ConfirmDialog from "../../../components/ConfirmDialog";
import Button from "../../../components/Button";
import { useSectionLoadingTask } from "../../../components/RouteTransitionProvider";
import { useLatestRequestGuard } from "../../../lib/hooks";
import { captureImmutableDraft } from "../../../lib/forms/immutable-draft";
import {
  deriveAsyncListState,
  shouldShowEmptyState,
} from "../../../lib/ui/async-list-state";
import { getVenueTypeColor } from "../../../lib/colors";
import { useTranslations } from "next-intl";
import { useVenueSelector } from "../../../components/VenueSelector";
import {
  DEFAULT_CLOSING_TIME,
  DEFAULT_OPENING_TIME,
  DEFAULT_VENUE_TIMEZONE,
} from "../../../lib/date";
import {
  VENUE_MUTATION_ERROR_KEYS,
  selectDomainMessageKey,
} from "../../../lib/api/domain-error";

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
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
  const [formData, setFormData] = useState({
    name: "",
    type: "club" as Venue["type"],
    address: "",
    description: "",
    brandName: "",
    brandTagline: "",
    primaryDomain: "",
    defaultLocale: "en" as NonNullable<Venue["defaultLocale"]>,
    timezone: DEFAULT_VENUE_TIMEZONE,
    openingTime: DEFAULT_OPENING_TIME,
    closingTime: DEFAULT_CLOSING_TIME,
  });
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [listError, setListError] = useState("");
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const { refreshVenues: refreshActiveVenues } = useVenueSelector();
  const requestGuard = useLatestRequestGuard();
  useSectionLoadingTask(isLoading);

  const loadVenues = useCallback(async () => {
    const isLatestRequest = requestGuard.beginRequest();
    setIsLoading(true);
    setListError("");
    try {
      const { data, error } = await fetchVenues(true); // include inactive
      if (!isLatestRequest()) return;
      if (data) setVenues(data);
      if (error) {
        console.error("Failed to load venues:", error);
        setListError(t("loadFailed"));
        setLoadOutcome(data ? "partial" : "error");
      } else {
        setLoadOutcome("success");
      }
    } catch (error: unknown) {
      if (!isLatestRequest()) return;
      console.error("Failed to load venues:", error);
      setListError(t("loadFailed"));
      setLoadOutcome("error");
    } finally {
      if (isLatestRequest()) setIsLoading(false);
    }
  }, [requestGuard, t]);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const draft = captureImmutableDraft(formData);
    setIsSubmitting(true);
    setFormError("");
    setFormSuccess("");

    if (!draft.name.trim()) {
      setFormError(t("nameRequired"));
      setIsSubmitting(false);
      return;
    }

    try {
      const { data, error } = await createVenue({
        name: draft.name.trim(),
        type: draft.type,
        address: draft.address.trim() || undefined,
        description: draft.description.trim() || undefined,
        brandName: draft.brandName.trim() || undefined,
        brandTagline: draft.brandTagline.trim() || undefined,
        primaryDomain: draft.primaryDomain.trim() || undefined,
        defaultLocale: draft.defaultLocale,
        timezone: draft.timezone.trim(),
        openingTime: draft.openingTime,
        closingTime: draft.closingTime,
      });

      if (error) {
        console.error("Failed to create venue:", error);
        setFormError(
          t(selectDomainMessageKey(error, VENUE_MUTATION_ERROR_KEYS, "createFailed")),
        );
      } else if (data) {
        setFormSuccess(t("created", { name: data.name }));
        setFormData({
          name: "",
          type: "club",
          address: "",
          description: "",
          brandName: "",
          brandTagline: "",
          primaryDomain: "",
          defaultLocale: "en",
          timezone: DEFAULT_VENUE_TIMEZONE,
          openingTime: DEFAULT_OPENING_TIME,
          closingTime: DEFAULT_CLOSING_TIME,
        });
        await Promise.all([loadVenues(), refreshActiveVenues()]);
      }
    } catch (error: unknown) {
      console.error("Failed to create venue:", error);
      setFormError(t("createFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (venue: Venue) => {
    const { error } = await updateVenue(venue.id, { active: !venue.active });
    if (error) {
      console.error("Failed to update venue:", error);
      setListError(t("updateFailed"));
    } else {
      await Promise.all([loadVenues(), refreshActiveVenues()]);
    }
  };
  const listState = deriveAsyncListState({
    hasStarted: isLoading || loadOutcome !== "idle",
    isLoading,
    itemCount: venues.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });

  return (
    <OperationsLayout
      variant="stacked"
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
          <div className="app-panel p-3 sm:p-4">
            <StatGrid
              items={[
                {
                  label: t("totalVenues"),
                  value: venues.length,
                  color: "default",
                },
                {
                  label: t("active"),
                  value: venues.filter((v) => v.active).length,
                  color: "default",
                },
                {
                  label: t("inactive"),
                  value: venues.filter((v) => !v.active).length,
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
          <div className="space-y-6">
            <div className="app-panel p-4 sm:p-5">
              <h3 className="type-section-title mb-4">
                {t("createNew")}
              </h3>

              <form onSubmit={handleCreate} aria-busy={isSubmitting}>
                <fieldset disabled={isSubmitting} className="space-y-4">
                <div>
                  <label htmlFor="venue-create-name" className="app-label">
                    {t("venueName")}
                  </label>
                  <input
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
                  />
                </div>

                <fieldset>
                  <legend className="app-label">
                    {t("type")}
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
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
                            ? "border-action-primary bg-action-primary text-action-text"
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

                {formError && <Alert type="error" message={formError} />}

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
          <div className="app-panel">
            <PanelHeader
              title={t("venueList")}
              count={venues.length}
              onRefresh={loadVenues}
              isLoading={isLoading}
            />
            <div className="p-4">
              {listError && <Alert type="error" message={listError} className="mb-4" />}
              {listState === "loading" ? (
                <Skeleton rows={4} />
              ) : shouldShowEmptyState(listState) ? (
                <EmptyState icon="store" message={t("noVenues")} />
              ) : (
                <div
                  aria-busy={isLoading}
                  className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${
                    isLoading ? "pointer-events-none" : ""
                  }`}
                >
                  {venues.map((venue) => (
                    <VenueCard
                      key={venue.id}
                      venue={venue}
                      onToggleActive={handleToggleActive}
                      onSave={async (id, updates) => {
                        const { error } = await updateVenue(id, updates);
                        if (!error) {
                          setListError("");
                          await Promise.all([loadVenues(), refreshActiveVenues()]);
                        } else {
                          setListError(
                            t(
                              selectDomainMessageKey(
                                error,
                                VENUE_MUTATION_ERROR_KEYS,
                                "updateFailed",
                              ),
                            ),
                          );
                        }
                        return error;
                      }}
                    />
                  ))}
                </div>
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

function VenueCard({
  venue,
  onToggleActive,
  onSave,
}: {
  venue: Venue;
  onToggleActive: (venue: Venue) => Promise<void>;
  onSave: (
    id: string,
    updates: Partial<Pick<Venue,
      | "name"
      | "type"
      | "address"
      | "description"
      | "brandName"
      | "brandTagline"
      | "primaryDomain"
      | "defaultLocale"
      | "timezone"
      | "openingTime"
      | "closingTime"
    >>,
  ) => Promise<string | null>;
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
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
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
  });
  const [isDeactivateConfirmOpen, setIsDeactivateConfirmOpen] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (isSaving) return;
    const draft = captureImmutableDraft(editData);
    setIsSaving(true);
    try {
      const error = await onSave(venue.id, {
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
      if (!error) setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async () => {
    setIsTogglingActive(true);
    await onToggleActive(venue);
    setIsTogglingActive(false);
    setIsDeactivateConfirmOpen(false);
  };

  return (
    <>
      <div className="app-panel p-4 sm:p-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="type-row-title break-words">
            {venue.name}
          </h3>
          {venue.address && (
            <p className="mt-1 break-words text-xs leading-relaxed text-text-dim">
              {venue.address}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium ${getVenueTypeColor(venue.type)}`}
          >
            {venueTypeLabels[venue.type]}
          </span>
          {!venue.active && (
            <span className="border border-status-danger/70 bg-status-danger/10 px-2 py-1 font-mono text-xs uppercase tracking-wider text-status-danger">
              {t("inactive")}
            </span>
          )}
        </div>
      </div>

      {!isEditing ? (
        <div>
          {venue.description && (
            <p className="mb-3 break-words text-sm leading-relaxed text-text-muted">
              {venue.description}
            </p>
          )}
          <div className="mb-3 border border-border-subtle bg-canvas p-3">
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
          <div className="grid grid-cols-2 gap-2 mb-3">
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
          <div className="mb-3 border border-border-subtle bg-canvas p-3">
            <p className="app-label">{t("localOperations")}</p>
            <p className="font-mono text-sm text-text-heading">{venue.timezone}</p>
            <p className="mt-1 font-mono text-xs text-text-muted">
              {venue.openingTime} - {venue.closingTime}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => setIsEditing(true)}
              variant="secondary"
              size="sm"
              fullWidth
            >
              {t("edit")}
            </Button>
            <Button
              type="button"
              isLoading={isTogglingActive}
              onClick={() => {
                if (venue.active) {
                  setIsDeactivateConfirmOpen(true);
                } else {
                  void handleToggleActive();
                }
              }}
              variant={venue.active ? "danger" : "secondary"}
              size="sm"
              fullWidth
            >
              {venue.active ? t("deactivate") : t("activate")}
            </Button>
          </div>
        </div>
      ) : (
        <fieldset disabled={isSaving} className="space-y-3" aria-busy={isSaving}>
          <div>
            <label htmlFor={`venue-name-${venue.id}`} className="app-label">
              {t("venueName")}
            </label>
            <input
              id={`venue-name-${venue.id}`}
              name={`venue-name-${venue.id}`}
              type="text"
              value={editData.name}
              onChange={(e) =>
                setEditData({ ...editData, name: e.target.value })
              }
              className="app-field"
              autoComplete="off"
            />
          </div>

          <fieldset>
            <legend className="app-label">
              {t("type")}
            </legend>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-5">
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
                      ? "border-action-primary bg-action-primary text-action-text"
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
            <div className="grid gap-3 sm:grid-cols-2">
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

          <div className="grid gap-3 sm:grid-cols-2">
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

          <div className="grid grid-cols-2 gap-2">
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
              onClick={() => {
                setIsEditing(false);
                setEditData({
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
                });
              }}
              variant="secondary"
              size="sm"
              fullWidth
            >
              {commonT("cancel")}
            </Button>
          </div>
        </fieldset>
      )}
      </div>
      <ConfirmDialog
        open={isDeactivateConfirmOpen}
        title={t("deactivateTitle")}
        description={t("deactivateDescription", { name: venue.name })}
        confirmLabel={t("deactivate")}
        cancelLabel={commonT("cancel")}
        onConfirm={() => void handleToggleActive()}
        onCancel={() => setIsDeactivateConfirmOpen(false)}
        isLoading={isTogglingActive}
      />
    </>
  );
}
