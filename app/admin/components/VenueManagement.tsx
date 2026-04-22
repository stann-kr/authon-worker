"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchVenues,
  createVenue,
  updateVenue,
  type Venue,
} from "../../../lib/api/guests";
import StatGrid from "../../../components/StatGrid";
import PanelHeader from "../../../components/PanelHeader";
import Spinner from "../../../components/Spinner";
import Alert from "../../../components/Alert";
import EmptyState from "../../../components/EmptyState";
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
  });
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadVenues = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await fetchVenues(true); // include inactive
    if (data) setVenues(data);
    if (error) console.error("Failed to load venues:", error);
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
    });

    if (error) {
      setFormError(error.message || "Failed to create venue.");
    } else if (data) {
      setFormSuccess(`Venue "${data.name}" has been created.`);
      setFormData({ name: "", type: "club", address: "", description: "" });
      loadVenues();
    }
    setIsSubmitting(false);
  };

  const handleToggleActive = async (venue: Venue) => {
    const { error } = await updateVenue(venue.id, { active: !venue.active });
    if (error) {
      console.error("Failed to update venue:", error);
    } else {
      loadVenues();
    }
  };

  const getTabInfo = () => {
    switch (activeTab) {
      case "create":
        return { title: "CREATE VENUE", description: "Register a new venue" };
      case "list":
        return { title: "VENUE LIST", description: "Manage all venues" };
      default:
        return { title: "", description: "" };
    }
  };

  const tabInfo = getTabInfo();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
      {/* Sidebar */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="font-mono text-xs sm:text-sm tracking-wider text-gray-400 uppercase mb-3">
              SELECT MENU
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab("create")}
                className={`w-full p-3 font-mono text-xs tracking-wider uppercase transition-colors text-left ${
                  activeTab === "create"
                    ? "bg-white text-black"
                    : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                }`}
              >
                <i className="ri-add-line mr-2"></i>
                CREATE
              </button>
              <button
                onClick={() => setActiveTab("list")}
                className={`w-full p-3 font-mono text-xs tracking-wider uppercase transition-colors text-left ${
                  activeTab === "list"
                    ? "bg-white text-black"
                    : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                }`}
              >
                <i className="ri-store-2-line mr-2"></i>
                VENUES
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1">
              {tabInfo.title}
            </h2>
            <p className="text-gray-400 font-mono text-xs tracking-wider">
              {tabInfo.description}
            </p>
          </div>
          <div className="text-center mb-4">
            <div className="text-white font-mono text-3xl sm:text-4xl tracking-wider">
              {activeTab === "list" ? venues.length : "-"}
            </div>
            <div className="text-cyan-300 text-xs font-mono tracking-wider uppercase">
              {activeTab === "list" ? "TOTAL VENUES" : ""}
            </div>
          </div>

          {activeTab === "list" && (
            <StatGrid
              items={[
                {
                  label: "ACTIVE",
                  value: venues.filter((v) => v.active).length,
                  color: "green",
                },
                {
                  label: "INACTIVE",
                  value: venues.filter((v) => !v.active).length,
                  color: "red",
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="lg:col-span-3">
        {activeTab === "create" && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
              <h2 className="font-mono text-lg tracking-wider text-white uppercase mb-4">
                CREATE NEW VENUE
              </h2>

              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
                    VENUE NAME
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full bg-black border border-gray-700 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
                    placeholder="Club Name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
                    TYPE
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {VENUE_TYPES.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setFormData({
                            ...formData,
                            type: opt.value as Venue["type"],
                          })
                        }
                        className={`p-3 border font-mono text-xs tracking-wider uppercase transition-colors ${
                          formData.type === opt.value
                            ? "bg-white text-black border-white"
                            : "bg-black text-gray-400 border-gray-700 hover:text-white hover:border-gray-500"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
                    ADDRESS <span className="text-gray-600">(OPTIONAL)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full bg-black border border-gray-700 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
                    placeholder="Gangnam-gu, Seoul..."
                  />
                </div>

                <div>
                  <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
                    DESCRIPTION{" "}
                    <span className="text-gray-600">(OPTIONAL)</span>
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full bg-black border border-gray-700 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white resize-none"
                    rows={3}
                    placeholder="Venue description..."
                  />
                </div>

                {formError && <Alert type="error" message={formError} />}

                {formSuccess && <Alert type="success" message={formSuccess} />}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-white text-black py-3 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border border-black border-t-transparent rounded-full animate-spin"></div>
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
          <div className="bg-gray-900 border border-gray-700">
            <PanelHeader
              title="VENUE LIST"
              count={venues.length}
              onRefresh={loadVenues}
              isLoading={isLoading}
            />
            <div className="p-4">
              {isLoading && venues.length === 0 ? (
                <Spinner mode="inline" text="LOADING..." />
              ) : venues.length === 0 ? (
                <EmptyState icon="ri-store-2-line" message="NO VENUES FOUND" />
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
    </div>
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
    updates: Partial<Pick<Venue, "name" | "type" | "address" | "description">>,
  ) => Promise<any>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: venue.name,
    type: venue.type,
    address: venue.address || "",
    description: venue.description || "",
  });

  const handleSave = async () => {
    const error = await onSave(venue.id, {
      name: editData.name,
      type: editData.type,
      address: editData.address || undefined,
      description: editData.description || undefined,
    });
    if (!error) setIsEditing(false);
  };

  return (
    <div
      className={`bg-gray-900 border border-gray-700 p-4 sm:p-5 transition-opacity duration-200 ${!venue.active ? "opacity-60" : ""}`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-white font-mono text-sm sm:text-base tracking-wider">
            {venue.name}
          </h3>
          {venue.address && (
            <p className="text-gray-500 font-mono text-xs mt-1">
              {venue.address}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-xs tracking-wider uppercase ${getVenueTypeColor(venue.type)}`}
          >
            {venue.type.toUpperCase()}
          </span>
          {!venue.active && (
            <span className="bg-red-600 text-white px-2 py-1 font-mono text-xs tracking-wider uppercase">
              INACTIVE
            </span>
          )}
        </div>
      </div>

      {!isEditing ? (
        <div>
          {venue.description && (
            <p className="text-gray-400 font-mono text-xs mb-3">
              {venue.description}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <p className="text-gray-500 font-mono text-xs uppercase mb-1">
                STATUS
              </p>
              <p
                className={`font-mono text-xs sm:text-sm ${venue.active ? "text-green-400" : "text-red-400"}`}
              >
                {venue.active ? "ACTIVE" : "INACTIVE"}
              </p>
            </div>
            <div>
              <p className="text-gray-500 font-mono text-xs uppercase mb-1">
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
              className="bg-gray-700 hover:bg-gray-600 text-white font-mono text-xs tracking-wider uppercase py-2 sm:py-3 transition-colors"
            >
              EDIT
            </button>
            <button
              onClick={() => onToggleActive(venue)}
              className={`font-mono text-xs tracking-wider uppercase py-2 sm:py-3 transition-colors border ${
                venue.active
                  ? "bg-red-900/30 hover:bg-red-900/50 text-red-400 border-red-700"
                  : "bg-green-900/30 hover:bg-green-900/50 text-green-400 border-green-700"
              }`}
            >
              {venue.active ? "DEACTIVATE" : "ACTIVATE"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
              Name
            </label>
            <input
              type="text"
              value={editData.name}
              onChange={(e) =>
                setEditData({ ...editData, name: e.target.value })
              }
              className="w-full bg-gray-800 border border-gray-600 px-3 py-2 sm:py-3 text-white font-mono text-sm focus:outline-none focus:border-white"
            />
          </div>

          <div>
            <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
              Type
            </label>
            <div className="grid grid-cols-5 gap-1">
              {VENUE_TYPES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setEditData({
                      ...editData,
                      type: opt.value as Venue["type"],
                    })
                  }
                  className={`p-2 border font-mono text-xs tracking-wider uppercase transition-colors ${
                    editData.type === opt.value
                      ? "bg-white text-black border-white"
                      : "bg-gray-800 text-gray-400 border-gray-600 hover:text-white hover:border-gray-500"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
              Address
            </label>
            <input
              type="text"
              value={editData.address}
              onChange={(e) =>
                setEditData({ ...editData, address: e.target.value })
              }
              className="w-full bg-gray-800 border border-gray-600 px-3 py-2 sm:py-3 text-white font-mono text-sm focus:outline-none focus:border-white"
            />
          </div>

          <div>
            <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
              Description
            </label>
            <textarea
              value={editData.description}
              onChange={(e) =>
                setEditData({ ...editData, description: e.target.value })
              }
              className="w-full bg-gray-800 border border-gray-600 px-3 py-2 sm:py-3 text-white font-mono text-sm focus:outline-none focus:border-white resize-none"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleSave}
              className="bg-green-600 hover:bg-green-700 text-white font-mono text-xs tracking-wider uppercase py-2 sm:py-3 transition-colors"
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
                });
              }}
              className="bg-gray-700 hover:bg-gray-600 text-white font-mono text-xs tracking-wider uppercase py-2 sm:py-3 transition-colors"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
