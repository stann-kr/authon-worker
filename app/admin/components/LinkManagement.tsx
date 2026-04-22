"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import StatGrid from "../../../components/StatGrid";
import PanelHeader from "../../../components/PanelHeader";
import Spinner from "../../../components/Spinner";
import EmptyState from "../../../components/EmptyState";
import Alert from "../../../components/Alert";
import { formatDateDisplay } from "../../../lib/date";
import {
  fetchExternalLinksByDate,
  createExternalLink,
  deleteExternalLink,
  deactivateExternalLink,
  activateExternalLink,
  type ExternalDJLink,
} from "../../../lib/api/guests";

interface LinkManagementProps {
  selectedDate: string;
}

export default function LinkManagement({ selectedDate }: LinkManagementProps) {
  const [activeTab, setActiveTab] = useState<"create" | "manage">("create");
  const [formData, setFormData] = useState({
    date: selectedDate,
    dj: "",
    event: "",
    maxGuests: 5,
  });
  const [generatedLink, setGeneratedLink] = useState<ExternalDJLink | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [links, setLinks] = useState<ExternalDJLink[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 로딩 중 이전 데이터를 유지하여 화면 깜빡임 방지
  const displayCacheRef = useRef<ExternalDJLink[]>([]);

  useEffect(() => {
    if (!isFetching) {
      displayCacheRef.current = links;
    }
  }, [isFetching, links]);

  const displayLinks = isFetching ? displayCacheRef.current : links;

  const {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    user,
  } = useVenueSelector();

  // Update form date when selectedDate prop changes
  useEffect(() => {
    setFormData((prev) => ({ ...prev, date: selectedDate }));
  }, [selectedDate]);

  const loadLinks = useCallback(async () => {
    if (!venueId) return;
    setIsFetching(true);
    try {
      const { data, error } = await fetchExternalLinksByDate(
        venueId,
        selectedDate,
      );
      if (error) {
        console.error("Failed to load links:", error);
      } else if (data) {
        setLinks(data);
      }
    } catch (err) {
      console.error("Failed to load links:", err);
    } finally {
      setIsFetching(false);
    }
  }, [venueId, selectedDate]);

  useEffect(() => {
    if (activeTab === "manage") {
      loadLinks();
    }
  }, [activeTab, loadLinks]);

  const getGuestPageUrl = (token: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/guest?token=${token}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.date || !formData.dj || !formData.event || !venueId) return;

    setIsGenerating(true);
    setError(null);

    const { data, error } = await createExternalLink({
      venueId,
      djName: formData.dj,
      event: formData.event,
      date: formData.date,
      maxGuests: formData.maxGuests,
      createdBy: user?.id,
    });

    if (error) {
      console.error("Failed to create link:", error);
      setError("Failed to create link.");
    } else if (data) {
      setGeneratedLink(data);
      setFormData({ date: selectedDate, dj: "", event: "", maxGuests: 5 });
    }

    setIsGenerating(false);
  };

  const copyToClipboard = async (text: string, id?: string) => {
    if (id) {
      setLoadingStates((prev) => ({ ...prev, [`copy_${id}`]: true }));
    } else {
      setIsCopying(true);
    }

    try {
      await navigator.clipboard.writeText(text);
      if (id) {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (err) {
      console.error("Copy failed:", err);
    }

    setTimeout(() => {
      if (id) {
        setLoadingStates((prev) => ({ ...prev, [`copy_${id}`]: false }));
      } else {
        setIsCopying(false);
      }
    }, 100);
  };

  const handleDeleteLink = async (id: string) => {
    setSuccess(null);
    if (!confirm("DELETE THIS LINK?")) return;
    setLoadingStates((prev) => ({ ...prev, [`delete_${id}`]: true }));
    const { error } = await deleteExternalLink(id);
    if (error) {
      console.error("Failed to delete link:", error);
      setError("Failed to delete link.");
    } else {
      setLinks((prev) => prev.filter((link) => link.id !== id));
      setSuccess("Link deleted.");
    }
    setLoadingStates((prev) => ({ ...prev, [`delete_${id}`]: false }));
  };

  const handleDeactivateLink = async (id: string) => {
    setError(null);
    setSuccess(null);
    if (!confirm("Deactivate this link?")) return;

    setLoadingStates((prev) => ({ ...prev, [`deactivate_${id}`]: true }));
    const { error } = await deactivateExternalLink(id);
    if (error) {
      console.error("Failed to deactivate link:", error);
      setError("Failed to deactivate link.");
    } else {
      setLinks((prev) =>
        prev.map((link) =>
          link.id === id ? { ...link, active: false } : link,
        ),
      );
      setSuccess("Link deactivated.");
    }
    setLoadingStates((prev) => ({ ...prev, [`deactivate_${id}`]: false }));
  };

  const handleActivateLink = async (id: string) => {
    setError(null);
    setSuccess(null);

    setLoadingStates((prev) => ({ ...prev, [`activate_${id}`]: true }));
    const { error } = await activateExternalLink(id);
    if (error) {
      console.error("Failed to activate link:", error);
      setError("Failed to activate link.");
    } else {
      setLinks((prev) =>
        prev.map((link) => (link.id === id ? { ...link, active: true } : link)),
      );
      setSuccess("Link reactivated.");
    }
    setLoadingStates((prev) => ({ ...prev, [`activate_${id}`]: false }));
  };

  const activeLinks = displayLinks.filter((l) => l.active);
  const inactiveLinks = displayLinks.filter((l) => !l.active);

  const getTabInfo = () => {
    switch (activeTab) {
      case "create":
        return {
          title: "CREATE LINK",
          description: "Generate new access code",
        };
      case "manage":
        return { title: "MANAGE LINKS", description: "View and manage codes" };
      default:
        return { title: "", description: "" };
    }
  };

  const tabInfo = getTabInfo();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
      <div className="lg:col-span-1 space-y-4">
        {/* Venue selector for super_admin */}
        {isSuperAdmin && venues.length > 0 && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
          />
        )}
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
                onClick={() => setActiveTab("manage")}
                className={`w-full p-3 font-mono text-xs tracking-wider uppercase transition-colors text-left ${
                  activeTab === "manage"
                    ? "bg-white text-black"
                    : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                }`}
              >
                <i className="ri-link mr-2"></i>
                MANAGE
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
            <p className="text-gray-400 font-mono text-xs tracking-wider mt-1">
              {formatDateDisplay(selectedDate)}
            </p>
          </div>
          <div className="text-center mb-4">
            <div className="text-white font-mono text-3xl sm:text-4xl tracking-wider">
              {displayLinks.length}
            </div>
            <div className="text-cyan-300 text-xs font-mono tracking-wider uppercase">
              TOTAL LINKS
            </div>
          </div>

          <StatGrid
            items={[
              { label: "ACTIVE", value: activeLinks.length, color: "green" },
              { label: "EXPIRED", value: inactiveLinks.length, color: "red" },
            ]}
          />
        </div>
      </div>

      <div className="lg:col-span-3">
        {activeTab === "create" && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-700 p-4 sm:p-6">
              <div className="mb-6">
                <h2 className="font-mono text-sm sm:text-base tracking-wider text-white uppercase mb-1">
                  CREATE ACCESS LINK
                </h2>
                <p className="text-gray-400 font-mono text-xs tracking-wider uppercase">
                  GENERATE NEW GUEST CODE FOR EXTERNAL DJ
                </p>
              </div>

              {error && <Alert type="error" message={error} className="mb-4" />}

              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <label className="block font-mono text-xs tracking-wider text-gray-400 uppercase mb-2">
                      DATE
                    </label>
                    <div className="relative h-[46px] group">
                      {/* Mirroring UI Layer */}
                      <div className="absolute inset-0 bg-black border border-gray-600 px-4 py-3 flex items-center justify-between pointer-events-none group-focus-within:border-white transition-colors">
                        <span className="text-white font-mono text-sm tracking-wider">
                          {formatDateDisplay(formData.date)}
                        </span>
                        <i className="ri-calendar-line text-gray-400"></i>
                      </div>

                      {/* Hidden Native Input */}
                      <input
                        type="date"
                        value={formData.date}
                        onChange={(e) =>
                          setFormData({ ...formData, date: e.target.value })
                        }
                        onClick={(e) => (e.target as any).showPicker?.()}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 [color-scheme:dark]"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-xs tracking-wider text-gray-400 uppercase mb-2">
                      DJ NAME
                    </label>
                    <input
                      type="text"
                      value={formData.dj}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          dj: e.target.value.toUpperCase(),
                        })
                      }
                      className="w-full bg-black border border-gray-600 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white uppercase"
                      placeholder="DJ NAME"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-xs tracking-wider text-gray-400 uppercase mb-2">
                    EVENT NAME
                  </label>
                  <input
                    type="text"
                    value={formData.event}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        event: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full bg-black border border-gray-600 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white uppercase"
                    placeholder="EVENT NAME"
                    required
                  />
                </div>

                <div>
                  <label className="block font-mono text-xs tracking-wider text-gray-400 uppercase mb-2">
                    MAX GUESTS
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={formData.maxGuests}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        maxGuests: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-black border border-gray-600 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isGenerating}
                  className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:bg-gray-600 disabled:text-gray-400 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                      GENERATING...
                    </div>
                  ) : (
                    "GENERATE LINK"
                  )}
                </button>
              </form>
            </div>

            {generatedLink && (
              <div className="bg-gray-900 border border-gray-700 p-4 sm:p-6">
                <div className="mb-4">
                  <h3 className="font-mono text-sm tracking-wider text-white uppercase mb-2">
                    GENERATED ACCESS LINK
                  </h3>
                  <p className="text-gray-400 font-mono text-xs">
                    {generatedLink.djName} — {generatedLink.event} | MAX:{" "}
                    {generatedLink.maxGuests}
                  </p>
                </div>

                <div className="bg-black border border-gray-700 p-4 mb-4">
                  <div className="font-mono text-xs tracking-wider text-gray-400 mb-1">
                    GUEST URL
                  </div>
                  <div className="font-mono text-sm tracking-wider text-white break-all">
                    {getGuestPageUrl(generatedLink.token)}
                  </div>
                </div>

                <button
                  onClick={() =>
                    copyToClipboard(getGuestPageUrl(generatedLink.token))
                  }
                  disabled={isCopying}
                  className="w-full bg-white text-black py-3 font-mono text-xs tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  {isCopying ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                      COPYING...
                    </div>
                  ) : (
                    "COPY LINK"
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "manage" && (
          <div className="space-y-4">
            {error && <Alert type="error" message={error} />}
            {success && <Alert type="success" message={success} />}

            <div className="bg-gray-900 border border-gray-700">
              <PanelHeader
                title="LINK LIST"
                count={displayLinks.length}
                onRefresh={loadLinks}
                isLoading={isFetching}
              />

              {isFetching && displayLinks.length === 0 ? (
                <Spinner mode="inline" text="LOADING..." />
              ) : (
                <div
                  className={`divide-y divide-gray-700 lg:overflow-y-auto transition-opacity duration-200 ${isFetching ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {displayLinks.length === 0 ? (
                    <EmptyState
                      icon="ri-link"
                      message="NO LINKS FOUND FOR THIS DATE"
                    />
                  ) : (
                    displayLinks.map((link, index) => (
                      <div
                        key={link.id}
                        className={`p-4 ${!link.active ? "opacity-50" : ""} ${index % 2 === 1 ? "bg-gray-800/60" : ""}`}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-6 h-6 sm:w-8 sm:h-8 border border-gray-600 flex items-center justify-center">
                              <span className="text-xs font-mono text-gray-400">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                            </div>
                            <div>
                              <p className="font-mono text-sm tracking-wider text-white uppercase">
                                {link.djName} - {link.event}
                              </p>
                              <p className="text-xs font-mono text-gray-400 mt-1">
                                MAX: {link.maxGuests} | USED: {link.usedGuests}{" "}
                                |{" "}
                                {link.active ? (
                                  <span className="text-green-400">ACTIVE</span>
                                ) : (
                                  <span className="text-red-400">INACTIVE</span>
                                )}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="bg-black border border-gray-700 p-3 mb-4">
                          <div className="mb-1">
                            <span className="font-mono text-xs tracking-wider text-gray-400 uppercase">
                              GUEST URL
                            </span>
                          </div>
                          <div className="font-mono text-xs tracking-wider text-white break-all">
                            {getGuestPageUrl(link.token)}
                          </div>
                        </div>

                        {/* Usage progress bar */}
                        <div className="mb-4">
                          <div className="flex justify-between text-xs font-mono text-gray-400 mb-1">
                            <span>USAGE</span>
                            <span>
                              {link.usedGuests}/{link.maxGuests}
                            </span>
                          </div>
                          <div className="w-full bg-gray-800 h-1">
                            <div
                              className={`h-1 transition-all ${link.usedGuests >= link.maxGuests ? "bg-red-500" : "bg-green-500"}`}
                              style={{
                                width: `${Math.min((link.usedGuests / link.maxGuests) * 100, 100)}%`,
                              }}
                            ></div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-px bg-gray-700">
                          <button
                            onClick={() =>
                              copyToClipboard(
                                getGuestPageUrl(link.token),
                                link.id,
                              )
                            }
                            disabled={loadingStates[`copy_${link.id}`]}
                            className="bg-white text-black py-2 font-mono text-xs tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50"
                          >
                            {loadingStates[`copy_${link.id}`] ? (
                              <div className="flex items-center justify-center">
                                <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                              </div>
                            ) : copiedId === link.id ? (
                              "COPIED"
                            ) : (
                              "COPY"
                            )}
                          </button>
                          {link.active ? (
                            <button
                              onClick={() => handleDeactivateLink(link.id)}
                              disabled={loadingStates[`deactivate_${link.id}`]}
                              className="bg-gray-900 border border-gray-600 text-yellow-400 py-2 font-mono text-xs tracking-wider uppercase hover:bg-gray-800 transition-colors disabled:opacity-50"
                            >
                              {loadingStates[`deactivate_${link.id}`]
                                ? "..."
                                : "DEACTIVATE"}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleActivateLink(link.id)}
                              disabled={loadingStates[`activate_${link.id}`]}
                              className="bg-gray-900 border border-gray-600 text-green-400 py-2 font-mono text-xs tracking-wider uppercase hover:bg-gray-800 transition-colors disabled:opacity-50"
                            >
                              {loadingStates[`activate_${link.id}`]
                                ? "..."
                                : "ACTIVATE"}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteLink(link.id)}
                            disabled={loadingStates[`delete_${link.id}`]}
                            className="bg-gray-900 border border-gray-600 text-red-400 py-2 font-mono text-xs tracking-wider uppercase hover:bg-gray-800 transition-colors disabled:opacity-50"
                          >
                            {loadingStates[`delete_${link.id}`] ? (
                              <div className="flex items-center justify-center">
                                <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                              </div>
                            ) : (
                              "DELETE"
                            )}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
