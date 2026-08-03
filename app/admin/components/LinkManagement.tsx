"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import StatGrid from "../../../components/StatGrid";
import PanelHeader from "../../../components/PanelHeader";
import EmptyState from "../../../components/EmptyState";
import Alert from "../../../components/Alert";
import Icon from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import DatePicker from "../../../components/DatePicker";
import OperationsLayout from "../../../components/OperationsLayout";
import { formatDateDisplay } from "../../../lib/date";
import {
  fetchExternalLinksByDate,
  fetchRecentExternalLinks,
  createExternalLink,
  deleteExternalLink,
  deactivateExternalLink,
  activateExternalLink,
} from "../../../lib/api/external-links";
import type { ExternalDJLink } from "../../../lib/api/types";
import {
  deriveLinkStatus,
  filterLinksByManageFilter,
  formatRelativeExpiry,
  formatTimestamp,
  getDashboardStats,
  sortLinks,
  type ManageFilter,
  type ManageSort,
} from "./linkStatus";

interface LinkManagementProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export default function LinkManagement({
  selectedDate,
  onDateChange,
}: LinkManagementProps) {
  const [activeTab, setActiveTab] = useState<"create" | "manage">("create");
  const [manageScope, setManageScope] = useState<"date" | "recent">("date");
  const [recentLimit, setRecentLimit] = useState<5 | 10>(5);
  const [manageFilter, setManageFilter] = useState<ManageFilter>("all");
  const [manageSort, setManageSort] = useState<ManageSort>("newest");
  const [now, setNow] = useState(() => Date.now());
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
  const [visibleLinkId, setVisibleLinkId] = useState<string | null>(null);
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [pendingDeleteLink, setPendingDeleteLink] = useState<ExternalDJLink | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);

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
    setError(null);
    try {
      const { data, error } =
        manageScope === "recent"
          ? await fetchRecentExternalLinks(venueId, recentLimit)
          : await fetchExternalLinksByDate(venueId, selectedDate);
      if (error) {
        console.error("Failed to load links:", error);
        setError(error);
      } else if (data) {
        setLinks(data);
      }
    } catch (err) {
      console.error("Failed to load links:", err);
      setError("Unable to load links right now.");
    } finally {
      setIsFetching(false);
    }
  }, [manageScope, recentLimit, selectedDate, venueId]);

  useEffect(() => {
    if (activeTab === "manage") {
      loadLinks();
    }
  }, [activeTab, loadLinks]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!pendingDeleteLink) return;

    deleteCancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingDeleteLink(null);
        return;
      }

      if (event.key === "Tab" && deleteDialogRef.current) {
        const focusable = Array.from(
          deleteDialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      deleteTriggerRef.current?.focus();
    };
  }, [pendingDeleteLink]);

  const getGuestPageUrl = (token: string, guestUrl?: string | null) => {
    if (guestUrl) return guestUrl;
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
      setCopyToast(id ? "Guest link copied." : "Generated link copied.");
      setTimeout(() => setCopyToast(null), 2200);
    } catch (err) {
      console.error("Copy failed:", err);
      setError("Failed to copy link.");
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
    setLoadingStates((prev) => ({ ...prev, [`delete_${id}`]: true }));
    const { error } = await deleteExternalLink(id);
    if (error) {
      console.error("Failed to delete link:", error);
      setError("Failed to delete link.");
    } else {
      setLinks((prev) => prev.filter((link) => link.id !== id));
      setSuccess("Link deleted.");
      setPendingDeleteLink(null);
    }
    setLoadingStates((prev) => ({ ...prev, [`delete_${id}`]: false }));
  };

  const requestDeleteLink = (link: ExternalDJLink) => {
    deleteTriggerRef.current = document.activeElement as HTMLElement | null;
    setError(null);
    setSuccess(null);
    setPendingDeleteLink(link);
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

  const dashboardStats = useMemo(
    () => getDashboardStats(displayLinks, now),
    [displayLinks, now],
  );

  const filteredLinks = useMemo(
    () => filterLinksByManageFilter(displayLinks, manageFilter, now),
    [displayLinks, manageFilter, now],
  );

  const sortedLinks = useMemo(
    () => sortLinks(filteredLinks, manageScope === "recent" ? "newest" : manageSort),
    [filteredLinks, manageScope, manageSort],
  );

  const getTabInfo = () => {
    switch (activeTab) {
      case "create":
        return {
          title: "Create link",
          description: "Generate new access code",
        };
      case "manage":
        return { title: "Manage links", description: "View and manage codes" };
      default:
        return { title: "", description: "" };
    }
  };

  const tabInfo = getTabInfo();

  return (
    <>
      <OperationsLayout
        title="Admin link management"
        dashboard={
          <>
        {(activeTab === "create" || manageScope === "date") && (
          <div className="context-bar">
            <DatePicker value={selectedDate} onChange={onDateChange} />
          </div>
        )}
        {/* Venue selector for super_admin */}
        {isSuperAdmin && venues.length > 0 && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
            className="app-panel p-4 sm:p-5"
          />
        )}
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
                onClick={() => setActiveTab("manage")}
                className={`flex w-full items-center gap-2 p-3 text-left text-sm font-medium transition-colors ${
                  activeTab === "manage"
                    ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                    : "bg-surface-raised text-text-muted hover:text-text-heading border border-border-default"
                }`}
              >
                <Icon name="link" size={17} />
                Manage
              </button>
            </div>
            {activeTab === "manage" && (
              <div className="mt-4 border-t border-border-subtle pt-4">
                <p className="app-label">View</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["date", "recent"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      aria-pressed={manageScope === scope}
                      onClick={() => {
                        setManageScope(scope);
                        setManageFilter("all");
                      }}
                      className={`min-h-11 border px-3 py-2 text-xs font-medium uppercase ${
                        manageScope === scope
                          ? "border-action-primary bg-action-primary text-action-text"
                          : "border-border-default bg-surface-raised text-text-muted"
                      }`}
                    >
                      {scope === "date" ? "By date" : "Recent"}
                    </button>
                  ))}
                </div>
                {manageScope === "recent" && (
                  <div className="mt-3">
                    <p className="app-label">Items</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([5, 10] as const).map((limit) => (
                        <button
                          key={limit}
                          type="button"
                          aria-pressed={recentLimit === limit}
                          onClick={() => setRecentLimit(limit)}
                          className={`min-h-11 border px-3 py-2 font-mono text-xs ${
                            recentLimit === limit
                              ? "border-action-primary bg-action-primary text-action-text"
                              : "border-border-default bg-surface-raised text-text-muted"
                          }`}
                        >
                          {limit}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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
            <p className="text-sm text-text-muted mt-1">
              {activeTab === "manage" && manageScope === "recent"
                ? `Latest ${recentLimit} created links`
                : formatDateDisplay(selectedDate)}
            </p>
          </div>
          {activeTab === "manage" && (
            <StatGrid
              items={[
                { label: "TOTAL", value: dashboardStats.total, color: "default" },
                { label: "ACTIVE", value: dashboardStats.active, color: "checked" },
                { label: "ATTENTION", value: dashboardStats.attention, color: "danger" },
              ]}
            />
          )}
        </div>
          </>
        }
      >

      <div className="min-w-0">
        {activeTab === "create" && (
          <div className="space-y-6">
            <div className="app-panel p-4 sm:p-6">
              <div className="mb-6">
                <h2 className="type-panel-title font-mono uppercase tracking-wider mb-1">
                  CREATE ACCESS LINK
                </h2>
                <p className="text-text-muted text-xs font-medium">
                  GENERATE NEW GUEST CODE FOR EXTERNAL DJ
                </p>
              </div>

              {error && <Alert type="error" message={error} className="mb-4" />}

              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <label htmlFor="link-date" className="app-label">
                      DATE
                    </label>
                    <div className="relative h-[46px] group">
                      {/* Mirroring UI Layer */}
                      <div className="absolute inset-0 bg-canvas border border-border-strong px-4 py-3 flex items-center justify-between pointer-events-none group-focus-within:border-border-focus transition-colors">
                        <span className="text-text-heading text-sm">
                          {formatDateDisplay(formData.date)}
                        </span>
                        <Icon name="calendar" size={18} className="text-text-muted" />
                      </div>

                      {/* Hidden Native Input */}
                      <input
                        id="link-date"
                        type="date"
                        value={formData.date}
                        onChange={(e) =>
                          setFormData({ ...formData, date: e.target.value })
                        }
                        onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 [color-scheme:dark]"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="link-dj-name" className="app-label">
                      DJ NAME
                    </label>
                    <input
                      id="link-dj-name"
                      type="text"
                      value={formData.dj}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          dj: e.target.value.toUpperCase(),
                        })
                      }
                      className="w-full bg-canvas border border-border-strong px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus uppercase"
                      placeholder="DJ NAME"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="link-event-name" className="app-label">
                    EVENT NAME
                  </label>
                  <input
                    id="link-event-name"
                    type="text"
                    value={formData.event}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        event: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full bg-canvas border border-border-strong px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus uppercase"
                    placeholder="EVENT NAME"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="link-max-guests" className="app-label">
                    MAX GUESTS
                  </label>
                  <input
                    id="link-max-guests"
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
                    className="w-full bg-canvas border border-border-strong px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isGenerating}
                  className="w-full bg-action-primary py-3 text-sm font-semibold text-action-text transition-colors hover:bg-action-hover disabled:bg-border-strong disabled:text-text-muted disabled:opacity-50 sm:py-4"
                >
                  {isGenerating ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-canvas border-t-transparent rounded-full animate-spin"></div>
                      GENERATING...
                    </div>
                  ) : (
                    "GENERATE LINK"
                  )}
                </button>
              </form>
            </div>

            {generatedLink && (
              <div className="app-panel p-4 sm:p-6">
                <div className="mb-4">
                  <h3 className="type-panel-title mb-2">
                    GENERATED ACCESS LINK
                  </h3>
                  <p className="text-text-muted font-mono text-xs">
                    {generatedLink.djName} / {generatedLink.event} | MAX:{" "}
                    {generatedLink.maxGuests}
                  </p>
                </div>

                <div className="bg-canvas border border-border-default p-4 mb-4">
                  <div className="font-mono text-xs tracking-wider text-text-muted mb-1">
                    GUEST URL
                  </div>
                  <div className="font-mono text-sm tracking-wider text-text-heading break-all">
                    {getGuestPageUrl(generatedLink.token, generatedLink.guestUrl)}
                  </div>
                </div>

                <button
                  onClick={() =>
                    copyToClipboard(getGuestPageUrl(generatedLink.token, generatedLink.guestUrl))
                  }
                  disabled={isCopying}
                  className="w-full bg-action-primary py-3 text-xs font-semibold text-action-text transition-colors hover:bg-action-hover disabled:opacity-50"
                >
                  {isCopying ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-3 h-3 border-2 border-canvas border-t-transparent rounded-full animate-spin"></div>
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

            <div className="app-panel">
              <PanelHeader
                title="Link list"
                count={sortedLinks.length}
                onRefresh={loadLinks}
                isLoading={isFetching}
              />

              <div className="border-b border-border-subtle p-4 sm:p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: "all", label: "All", count: dashboardStats.total },
                      { key: "active", label: "Active", count: dashboardStats.active },
                      { key: "attention", label: "Attention", count: dashboardStats.attention },
                    ].map((filter) => (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setManageFilter(filter.key as ManageFilter)}
                        aria-pressed={manageFilter === filter.key}
                        className={`min-h-11 border px-3 py-2 text-xs font-medium uppercase transition-colors ${
                          manageFilter === filter.key
                            ? "border-action-primary bg-action-primary text-action-text"
                            : "border-border-default bg-canvas text-text-muted hover:border-border-strong hover:text-text-heading"
                        }`}
                      >
                        {filter.label} {filter.count}
                      </button>
                    ))}
                  </div>

                  {manageScope === "date" && (
                    <div className="min-w-[190px]">
                      <label htmlFor="link-sort" className="app-label">
                        Sort
                      </label>
                      <div className="relative">
                        <select
                          id="link-sort"
                          value={manageSort}
                          onChange={(event) =>
                            setManageSort(event.target.value as ManageSort)
                          }
                          className="app-field min-h-11 appearance-none py-2.5 pl-4 pr-12 text-xs uppercase"
                        >
                          <option value="newest">Newest created</option>
                          <option value="expiresSoonest">Expires soonest</option>
                          <option value="djName">DJ name</option>
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
                    ? `Latest ${recentLimit} created links`
                    : formatDateDisplay(selectedDate)}
                  {manageFilter !== "all" ? ` · ${manageFilter}` : ""}
                </p>
              </div>

              {isFetching && sortedLinks.length === 0 ? (
                <Skeleton rows={5} />
              ) : (
                <div
                  className={`divide-y divide-border-default lg:overflow-y-auto transition-opacity duration-200 ${isFetching ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {sortedLinks.length === 0 ? (
                    <EmptyState
                      icon="link"
                      message="NO LINKS MATCH THIS FILTER"
                    />
                  ) : (
                    sortedLinks.map((link, index) => {
                      const status = deriveLinkStatus(link, now);
                      const guestPageUrl = getGuestPageUrl(link.token, link.guestUrl);
                      const isLinkVisible = visibleLinkId === link.id;
                      const usageTone = status.full
                        ? "bg-status-danger"
                        : status.usagePercent >= 80
                          ? "bg-text-muted"
                          : "bg-text-heading";

                      const primaryStatus = status.expired
                        ? { label: "EXPIRED", tone: "border-status-danger text-status-danger", indicator: "before:bg-status-danger" }
                        : status.inactive
                          ? { label: "INACTIVE", tone: "border-border-strong text-text-muted", indicator: "before:bg-border-strong" }
                          : status.full
                            ? { label: "FULL", tone: "border-status-danger text-status-danger", indicator: "before:bg-status-danger" }
                            : status.expiringSoon
                              ? { label: "EXPIRING", tone: "border-status-waiting text-status-waiting", indicator: "before:bg-status-waiting" }
                              : { label: "ACTIVE", tone: "border-status-checked text-status-checked", indicator: "before:bg-status-checked" };

                      return (
                      <article
                        key={link.id}
                        className={`relative px-4 py-3.5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 ${primaryStatus.indicator} ${index % 2 === 1 ? "bg-surface-raised" : "bg-surface"}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="w-7 shrink-0 font-mono text-xs tabular-nums text-text-dim">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div className="min-w-0">
                              <h3 className="type-row-title break-words">
                                {link.djName}
                              </h3>
                              <p className="mt-0.5 break-words text-xs text-text-muted">
                                {link.event || "Untitled event"}
                              </p>
                            </div>
                          </div>
                          <span className={`inline-flex min-h-7 items-center border-l-2 pl-2 text-xs font-semibold ${primaryStatus.tone}`}>
                            {primaryStatus.label}
                          </span>
                        </div>

                        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 pl-10 sm:pl-11">
                          <div>
                            <dt className="text-xs text-text-dim">EVENT DATE</dt>
                            <dd className="mt-0.5 font-mono text-xs text-text-muted">
                              {link.date ? formatDateDisplay(link.date) : "No date"}
                            </dd>
                          </div>
                          {manageScope === "recent" && (
                            <div>
                              <dt className="text-xs text-text-dim">CREATED</dt>
                              <dd className="mt-0.5 font-mono text-xs text-text-muted">
                                {formatTimestamp(link.createdAt)}
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt className="text-xs text-text-dim">USAGE</dt>
                            <dd className="mt-0.5 font-mono text-xs text-text-heading">
                              {link.usedGuests}/{link.maxGuests}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-text-dim">EXPIRY</dt>
                            <dd className={`mt-0.5 font-mono text-xs ${status.expired ? "text-status-danger" : "text-text-muted"}`}>
                              {formatRelativeExpiry(link.expiresAt, now)}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-3 pl-10 sm:pl-11">
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
                            className="mt-3 border border-border-default bg-canvas p-3 ml-10 sm:ml-11"
                          >
                            <label
                              htmlFor={`link-url-${link.id}`}
                              className="app-label"
                            >
                              Guest URL
                            </label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                id={`link-url-${link.id}`}
                                type="text"
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
                                className="pressable inline-flex min-h-11 items-center justify-center border border-border-default bg-surface-raised px-4 text-xs font-semibold text-text-heading hover:border-border-strong hover:bg-surface-hover"
                              >
                                OPEN
                              </a>
                            </div>
                            <p className="app-helper">
                              Select the URL manually or open it in a new tab.
                            </p>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap justify-end gap-2 pl-10 sm:pl-11">
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleLinkId((current) =>
                                current === link.id ? null : link.id,
                              )
                            }
                            aria-expanded={isLinkVisible}
                            aria-controls={`link-url-panel-${link.id}`}
                            className="inline-flex min-h-11 items-center gap-2 border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-heading hover:bg-surface-raised"
                          >
                            <Icon
                              name={isLinkVisible ? "view-off" : "view"}
                              size={16}
                            />
                            {isLinkVisible ? "HIDE" : "VIEW"}
                          </button>
                          <button
                            onClick={() =>
                              copyToClipboard(guestPageUrl, link.id)
                            }
                            disabled={loadingStates[`copy_${link.id}`]}
                            className="min-h-11 bg-action-primary px-4 py-2 text-xs font-semibold text-action-text transition-colors hover:bg-action-hover disabled:opacity-50"
                          >
                            {loadingStates[`copy_${link.id}`] ? (
                              <div className="flex items-center justify-center">
                                <div className="w-3 h-3 border-2 border-canvas border-t-transparent rounded-full animate-spin"></div>
                              </div>
                            ) : copiedId === link.id ? (
                              "COPIED"
                            ) : (
                              "COPY LINK"
                            )}
                          </button>
                          {status.expired ? (
                            <span className="inline-flex min-h-11 items-center border border-status-danger/70 px-3 text-xs text-status-danger">
                              EXPIRED
                            </span>
                          ) : link.active ? (
                            <button
                              onClick={() => handleDeactivateLink(link.id)}
                              disabled={loadingStates[`deactivate_${link.id}`]}
                              className="min-h-11 border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-muted hover:bg-surface-raised disabled:opacity-50"
                            >
                              {loadingStates[`deactivate_${link.id}`]
                                ? "..."
                                : "DEACTIVATE"}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleActivateLink(link.id)}
                              disabled={loadingStates[`activate_${link.id}`]}
                              className="min-h-11 border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-heading hover:bg-surface-raised disabled:opacity-50"
                            >
                              {loadingStates[`activate_${link.id}`]
                                ? "..."
                                : "ACTIVATE"}
                            </button>
                          )}
                          <button
                            onClick={() => requestDeleteLink(link)}
                            disabled={loadingStates[`delete_${link.id}`]}
                            className="min-h-11 border border-status-danger/70 bg-status-danger/10 px-3 py-2 text-xs font-medium text-status-danger hover:bg-status-danger/20 disabled:opacity-50"
                          >
                            {loadingStates[`delete_${link.id}`] ? (
                              <div className="flex items-center justify-center">
                                <div className="h-3 w-3 animate-spin rounded-full border-2 border-status-danger border-t-transparent"></div>
                              </div>
                            ) : (
                              "DELETE"
                            )}
                          </button>
                        </div>
                      </article>
                    )})
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </OperationsLayout>

      {copyToast && (
        <div className="fixed bottom-5 right-5 z-40 border border-border-strong bg-surface-raised px-4 py-3 text-text-heading" role="status" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-[0.05em]">
            {copyToast}
          </p>
        </div>
      )}

      {pendingDeleteLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 px-4">
          <div
            ref={deleteDialogRef}
            className="w-full max-w-md border border-status-danger/70 bg-canvas p-5 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-link-title"
            aria-describedby="delete-link-description"
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="mb-2 font-mono text-xs uppercase tracking-[0.24em] text-status-danger">
                  Destructive action
                </p>
                <h3 id="delete-link-title" className="type-panel-title font-mono uppercase tracking-[0.18em]">
                  Delete guest link?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingDeleteLink(null)}
                className="text-text-dim hover:text-text-heading transition-colors"
                aria-label="Close delete confirmation"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="space-y-3 mb-6">
              <p id="delete-link-description" className="text-xs font-medium uppercase tracking-[0.05em] text-text-muted leading-relaxed">
                This action is permanent and will immediately invalidate the active guest link.
              </p>
              <div className="border border-border-default bg-canvas p-3">
                <p className="text-xs font-medium uppercase tracking-[0.05em] text-text-heading break-words">
                  {pendingDeleteLink.djName} / {pendingDeleteLink.event}
                </p>
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.05em] text-text-dim">
                  Usage {pendingDeleteLink.usedGuests}/{pendingDeleteLink.maxGuests}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                ref={deleteCancelRef}
                type="button"
                onClick={() => setPendingDeleteLink(null)}
                className="bg-canvas border border-border-default text-text-body py-3 px-4 text-xs font-medium uppercase tracking-[0.05em] hover:text-text-heading hover:border-border-strong transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteLink(pendingDeleteLink.id)}
                disabled={loadingStates[`delete_${pendingDeleteLink.id}`]}
                className="border border-status-danger/70 bg-status-danger/10 px-4 py-3 font-mono text-xs uppercase tracking-[0.22em] text-status-danger transition-colors hover:bg-status-danger/20 disabled:opacity-50"
              >
                {loadingStates[`delete_${pendingDeleteLink.id}`]
                  ? "Deleting..."
                  : "Delete link"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
