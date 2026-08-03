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
import Icon from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import OperationsLayout from "../../../components/OperationsLayout";
import { getVenueTypeColor } from "../../../lib/colors";

const VENUE_TYPES = [
  { value: "club", label: "CLUB" },
  { value: "bar", label: "BAR" },
  { value: "lounge", label: "LOUNGE" },
  { value: "festival", label: "FESTIVAL" },
  { value: "private", label: "PRIVATE" },
] as const;

export default function VenueManagement() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"list" | "create">("list");
  const [formData, setFormData] = useState({
    name: "",
    type: "club" as Venue["type"],
    address: "",
    description: "",
    brandName: "",
    brandTagline: "",
    primaryDomain: "",
  });
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [listError, setListError] = useState("");

  const loadVenues = useCallback(async () => {
    setIsLoading(true);
    setListError("");
    const { data, error } = await fetchVenues(true); // include inactive
    if (data) setVenues(data);
    if (error) {
      console.error("Failed to load venues:", error);
      setListError("Unable to load venues. Please try again.");
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError("");
    setFormSuccess("");

    if (!formData.name.trim()) {
      setFormError("Please enter a venue name.");
      setIsSubmitting(false);
      return;
    }

    const { data, error } = await createVenue({
      name: formData.name.trim(),
      type: formData.type,
      address: formData.address.trim() || undefined,
      description: formData.description.trim() || undefined,
      brandName: formData.brandName.trim() || undefined,
      brandTagline: formData.brandTagline.trim() || undefined,
      primaryDomain: formData.primaryDomain.trim() || undefined,
    });

    if (error) {
      setFormError(error || "Failed to create venue.");
    } else if (data) {
      setFormSuccess(`Venue "${data.name}" has been created.`);
      setFormData({
        name: "",
        type: "club",
        address: "",
        description: "",
        brandName: "",
        brandTagline: "",
        primaryDomain: "",
      });
      loadVenues();
    }
    setIsSubmitting(false);
  };

  const handleToggleActive = async (venue: Venue) => {
    const { error } = await updateVenue(venue.id, { active: !venue.active });
    if (error) {
      console.error("Failed to update venue:", error);
      setListError("Unable to update the venue. Please try again.");
    } else {
      loadVenues();
    }
  };

  const getTabInfo = () => {
    switch (activeTab) {
      case "create":
        return { title: "Create venue", description: "Register a new venue" };
      case "list":
        return { title: "Venues", description: "Manage all venues" };
      default:
        return { title: "", description: "" };
    }
  };

  const tabInfo = getTabInfo();

  return (
    <OperationsLayout
      title="Admin venue management"
      dashboard={
        <>
        <div className="app-panel p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="type-context-title mb-3">
              Section
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab("create")}
                className={`flex w-full items-center gap-2 p-3 text-left text-sm font-medium transition-colors ${
                  activeTab === "create"
                    ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                    : "bg-surface-raised text-text-muted hover:text-text-heading border border-border-default"
                }`}
              >
                <Icon name="add" size={17} />
                Create
              </button>
              <button
                onClick={() => setActiveTab("list")}
                className={`flex w-full items-center gap-2 p-3 text-left text-sm font-medium transition-colors ${
                  activeTab === "list"
                    ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                    : "bg-surface-raised text-text-muted hover:text-text-heading border border-border-default"
                }`}
              >
                <Icon name="store" size={17} />
                Venues
              </button>
            </div>
          </div>
        </div>

        <div className="app-panel p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="type-panel-title mb-1">
              {tabInfo.title}
            </h2>
            <p className="text-sm text-text-muted">
              {tabInfo.description}
            </p>
          </div>
          <div className="text-center mb-4">
            <div className="text-text-heading font-mono text-3xl sm:text-4xl tracking-wider">
              {activeTab === "list" ? venues.length : "-"}
            </div>
            <div className="text-xs font-medium text-text-muted">
              {activeTab === "list" ? "TOTAL VENUES" : ""}
            </div>
          </div>

          {activeTab === "list" && (
            <StatGrid
              items={[
                {
                  label: "ACTIVE",
                  value: venues.filter((v) => v.active).length,
                  color: "default",
                },
                {
                  label: "INACTIVE",
                  value: venues.filter((v) => !v.active).length,
                  color: "danger",
                },
              ]}
            />
          )}
        </div>
        </>
      }
    >

      {/* Main content */}
      <div className="min-w-0">
        {activeTab === "create" && (
          <div className="space-y-6">
            <div className="app-panel p-4 sm:p-5">
              <h2 className="type-section-title mb-4">
                CREATE NEW VENUE
              </h2>

              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label htmlFor="venue-create-name" className="app-label">
                    VENUE NAME
                  </label>
                  <input
                    id="venue-create-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full bg-canvas border border-border-default px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus"
                    placeholder="Club Name"
                    required
                  />
                </div>

                <fieldset>
                  <legend className="app-label">
                    TYPE
                  </legend>
                  <div className="grid grid-cols-5 gap-2">
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
                        className={`p-3 border text-xs font-medium transition-colors ${
                          formData.type === opt.value
                            ? "border-action-primary bg-action-primary text-action-text"
                            : "bg-canvas text-text-muted border-border-default hover:text-text-heading hover:border-border-strong"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="venue-create-address" className="app-label">
                    ADDRESS <span className="text-text-dim">(OPTIONAL)</span>
                  </label>
                  <input
                    id="venue-create-address"
                    type="text"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full bg-canvas border border-border-default px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus"
                    placeholder="Gangnam-gu, Seoul..."
                  />
                </div>

                <div>
                  <label htmlFor="venue-create-description" className="app-label">
                    DESCRIPTION{" "}
                    <span className="text-text-dim">(OPTIONAL)</span>
                  </label>
                  <textarea
                    id="venue-create-description"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full bg-canvas border border-border-default px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus resize-none"
                    rows={3}
                    placeholder="Venue description..."
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="venue-create-brand-name" className="app-label">
                      DISPLAY NAME <span className="text-text-dim">(OPTIONAL)</span>
                    </label>
                    <input
                      id="venue-create-brand-name"
                      type="text"
                      value={formData.brandName}
                      onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                      className="app-field"
                      placeholder="Defaults to venue name"
                    />
                  </div>
                  <div>
                    <label htmlFor="venue-create-brand-tagline" className="app-label">
                      TAGLINE <span className="text-text-dim">(OPTIONAL)</span>
                    </label>
                    <input
                      id="venue-create-brand-tagline"
                      type="text"
                      value={formData.brandTagline}
                      onChange={(e) => setFormData({ ...formData, brandTagline: e.target.value })}
                      className="app-field"
                      placeholder="Guest Management System"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="venue-create-domain" className="app-label">
                    PRIMARY DOMAIN <span className="text-text-dim">(OPTIONAL)</span>
                  </label>
                  <input
                    id="venue-create-domain"
                    type="text"
                    inputMode="url"
                    value={formData.primaryDomain}
                    onChange={(e) => setFormData({ ...formData, primaryDomain: e.target.value })}
                    className="app-field"
                    placeholder="guest.example.com"
                  />
                  <p className="app-helper">Enter the hostname only, without https:// or a path.</p>
                </div>

                {formError && <Alert type="error" message={formError} />}

                {formSuccess && <Alert type="success" message={formSuccess} />}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-action-primary py-3 text-sm font-semibold text-action-text transition-colors hover:bg-action-hover disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border border-canvas border-t-transparent rounded-full animate-spin"></div>
                      <span>CREATING...</span>
                    </div>
                  ) : (
                    "CREATE VENUE"
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === "list" && (
          <div className="app-panel">
            <PanelHeader
              title="Venue list"
              count={venues.length}
              onRefresh={loadVenues}
              isLoading={isLoading}
            />
            <div className="p-4">
              {listError && <Alert type="error" message={listError} className="mb-4" />}
              {isLoading && venues.length === 0 ? (
                <Skeleton rows={4} />
              ) : venues.length === 0 ? (
                <EmptyState icon="store" message="NO VENUES FOUND" />
              ) : (
                <div
                  className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200 ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {venues.map((venue) => (
                    <VenueCard
                      key={venue.id}
                      venue={venue}
                      onToggleActive={handleToggleActive}
                      onSave={async (id, updates) => {
                        const { error } = await updateVenue(id, updates);
                        if (!error) loadVenues();
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
  onToggleActive: (venue: Venue) => void;
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
    >>,
  ) => Promise<string | null>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: venue.name,
    type: venue.type,
    address: venue.address || "",
    description: venue.description || "",
    brandName: venue.brandName || "",
    brandTagline: venue.brandTagline || "",
    primaryDomain: venue.primaryDomain || "",
  });

  const handleSave = async () => {
    const error = await onSave(venue.id, {
      name: editData.name,
      type: editData.type,
      address: editData.address || undefined,
      description: editData.description || undefined,
      brandName: editData.brandName,
      brandTagline: editData.brandTagline,
      primaryDomain: editData.primaryDomain,
    });
    if (!error) setIsEditing(false);
  };

  return (
    <div
      className={`app-panel p-4 sm:p-5 transition-opacity duration-200 ${!venue.active ? "opacity-60" : ""}`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="type-row-title font-mono tracking-wider">
            {venue.name}
          </h3>
          {venue.address && (
            <p className="text-text-dim font-mono text-xs mt-1">
              {venue.address}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium ${getVenueTypeColor(venue.type)}`}
          >
            {venue.type.toUpperCase()}
          </span>
          {!venue.active && (
            <span className="border border-status-danger/70 bg-status-danger/10 px-2 py-1 font-mono text-xs uppercase tracking-wider text-status-danger">
              INACTIVE
            </span>
          )}
        </div>
      </div>

      {!isEditing ? (
        <div>
          {venue.description && (
            <p className="text-text-muted font-mono text-xs mb-3">
              {venue.description}
            </p>
          )}
          <div className="mb-3 border border-border-subtle bg-canvas p-3">
            <p className="app-label">BRAND / DOMAIN</p>
            <p className="font-mono text-sm text-text-heading">
              {venue.brandName || venue.name}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-text-muted">
              {venue.primaryDomain || "No primary domain assigned"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <p className="text-xs text-text-dim mb-1">
                STATUS
              </p>
              <p
                className={`font-mono text-xs sm:text-sm ${venue.active ? "text-text-heading" : "text-status-danger"}`}
              >
                {venue.active ? "ACTIVE" : "INACTIVE"}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-dim mb-1">
                Type
              </p>
              <p
                className={`font-mono text-xs sm:text-sm ${getVenueTypeColor(venue.type)}`}
              >
                {venue.type.toUpperCase()}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="bg-surface-active hover:bg-border-strong text-text-heading text-xs font-medium py-2 sm:py-3 transition-colors"
            >
              EDIT
            </button>
            <button
              onClick={() => onToggleActive(venue)}
              className={`text-xs font-medium py-2 sm:py-3 transition-colors border ${
                venue.active
                  ? "border-status-danger/70 bg-status-danger/10 text-status-danger hover:bg-status-danger/20"
                  : "bg-surface-raised hover:bg-surface-raised text-text-heading border-border-strong"
              }`}
            >
              {venue.active ? "DEACTIVATE" : "ACTIVATE"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor={`venue-name-${venue.id}`} className="app-label">
              Name
            </label>
            <input
              id={`venue-name-${venue.id}`}
              type="text"
              value={editData.name}
              onChange={(e) =>
                setEditData({ ...editData, name: e.target.value })
              }
              className="w-full bg-surface-raised border border-border-strong px-3 py-2 sm:py-3 text-text-heading font-mono text-sm focus:outline-none focus:border-border-focus"
            />
          </div>

          <fieldset>
            <legend className="app-label">
              Type
            </legend>
            <div className="grid grid-cols-5 gap-1">
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
                  className={`p-2 border text-xs font-medium transition-colors ${
                    editData.type === opt.value
                      ? "border-action-primary bg-action-primary text-action-text"
                      : "bg-surface-raised text-text-muted border-border-strong hover:text-text-heading hover:border-border-strong"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`venue-address-${venue.id}`} className="app-label">
              Address
            </label>
            <input
              id={`venue-address-${venue.id}`}
              type="text"
              value={editData.address}
              onChange={(e) =>
                setEditData({ ...editData, address: e.target.value })
              }
              className="w-full bg-surface-raised border border-border-strong px-3 py-2 sm:py-3 text-text-heading font-mono text-sm focus:outline-none focus:border-border-focus"
            />
          </div>

          <div>
            <label htmlFor={`venue-description-${venue.id}`} className="app-label">
              Description
            </label>
            <textarea
              id={`venue-description-${venue.id}`}
              value={editData.description}
              onChange={(e) =>
                setEditData({ ...editData, description: e.target.value })
              }
              className="w-full bg-surface-raised border border-border-strong px-3 py-2 sm:py-3 text-text-heading font-mono text-sm focus:outline-none focus:border-border-focus resize-none"
              rows={2}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`venue-brand-name-${venue.id}`} className="app-label">
                Display name
              </label>
              <input
                id={`venue-brand-name-${venue.id}`}
                type="text"
                value={editData.brandName}
                onChange={(e) => setEditData({ ...editData, brandName: e.target.value })}
                className="app-field"
                placeholder={venue.name}
              />
            </div>
            <div>
              <label htmlFor={`venue-brand-tagline-${venue.id}`} className="app-label">
                Tagline
              </label>
              <input
                id={`venue-brand-tagline-${venue.id}`}
                type="text"
                value={editData.brandTagline}
                onChange={(e) => setEditData({ ...editData, brandTagline: e.target.value })}
                className="app-field"
                placeholder="Guest Management System"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`venue-domain-${venue.id}`} className="app-label">
              Primary domain
            </label>
            <input
              id={`venue-domain-${venue.id}`}
              type="text"
              inputMode="url"
              value={editData.primaryDomain}
              onChange={(e) => setEditData({ ...editData, primaryDomain: e.target.value })}
              className="app-field"
              placeholder="guest.example.com"
            />
            <p className="app-helper">Saving an empty value removes the primary domain.</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleSave}
              className="bg-text-heading hover:bg-text-body text-canvas text-xs font-medium py-2 sm:py-3 transition-colors"
            >
              SAVE
            </button>
            <button
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
                });
              }}
              className="bg-surface-active hover:bg-border-strong text-text-heading text-xs font-medium py-2 sm:py-3 transition-colors"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
