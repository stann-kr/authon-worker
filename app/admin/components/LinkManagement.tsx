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
import OperationalSectionNav from "../../../components/OperationalSectionNav";
import ConfirmDialog from "../../../components/ConfirmDialog";
import { useSectionLoadingTask } from "../../../components/RouteTransitionProvider";
import { useLatestRequestGuard } from "../../../lib/hooks";
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
  MAX_EXTERNAL_LINK_DJ_NAME_LENGTH,
  MAX_EXTERNAL_LINK_EVENT_LENGTH,
  prepareExternalLinkCreateInput,
  shareExternalLink,
  toExternalLinkShareData,
  toExternalLinkTemplateDraft,
  type ExternalLinkShareResult,
} from "../../../lib/external-links/domain";
import { useLocale, useTranslations } from "next-intl";
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

const EMPTY_LINKS: ExternalDJLink[] = [];

interface LinkFormData {
  date: string;
  dj: string;
  event: string;
  maxGuests: number | "";
  localeMode: ExternalDJLink["localeMode"];
}

type LinkFormField = "date" | "dj" | "event" | "maxGuests" | "localeMode";

interface LinkFormValidationError {
  field: LinkFormField;
  message: string;
}

interface LinkActionFeedback {
  id: string;
  result: Extract<ExternalLinkShareResult, "shared" | "copied">;
}

interface LinkManagementProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  businessDate: string;
}

export default function LinkManagement({
  selectedDate,
  onDateChange,
  businessDate,
}: LinkManagementProps) {
  const t = useTranslations("LinkAdmin");
  const commonT = useTranslations("Common");
  const locale = useLocale() as "en" | "ko";
  const [activeTab, setActiveTab] = useState<"create" | "manage">("create");
  const [manageScope, setManageScope] = useState<"date" | "recent">("date");
  const [recentLimit, setRecentLimit] = useState<5 | 10>(5);
  const [manageFilter, setManageFilter] = useState<ManageFilter>("all");
  const [manageSort, setManageSort] = useState<ManageSort>("newest");
  const [now, setNow] = useState(() => Date.now());
  const [formData, setFormData] = useState<LinkFormData>({
    date: selectedDate,
    dj: "",
    event: "",
    maxGuests: 5,
    localeMode: "auto" as ExternalDJLink["localeMode"],
  });
  const [generatedLink, setGeneratedLink] = useState<ExternalDJLink | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratedLinkActionPending, setIsGeneratedLinkActionPending] =
    useState(false);
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const [links, setLinks] = useState<ExternalDJLink[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [linkActionFeedback, setLinkActionFeedback] =
    useState<LinkActionFeedback | null>(null);
  const [visibleLinkId, setVisibleLinkId] = useState<string | null>(null);
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [linkActionToast, setLinkActionToast] = useState<string | null>(null);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [formValidationError, setFormValidationError] =
    useState<LinkFormValidationError | null>(null);
  const [pendingDeleteLink, setPendingDeleteLink] = useState<ExternalDJLink | null>(null);
  const [pendingDeactivateLink, setPendingDeactivateLink] =
    useState<ExternalDJLink | null>(null);
  const linkDateInputRef = useRef<HTMLInputElement>(null);
  const linkDjInputRef = useRef<HTMLInputElement>(null);
  const linkEventInputRef = useRef<HTMLInputElement>(null);
  const linkMaxGuestsInputRef = useRef<HTMLInputElement>(null);
  const linkLocaleInputRef = useRef<HTMLButtonElement>(null);
  const generatedLinkPanelRef = useRef<HTMLDivElement>(null);
  const shouldFocusTemplateDateRef = useRef(false);
  const shouldFocusGeneratedLinkRef = useRef(false);

  // 로딩 중 이전 데이터를 유지하여 화면 깜빡임 방지
  const displayCacheRef = useRef<{ scopeKey: string; links: ExternalDJLink[] }>({
    scopeKey: "",
    links: [],
  });

  const {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
  } = useVenueSelector();

  const requestScopeKey = `${venueId}:${manageScope}:${
    manageScope === "recent" ? recentLimit : selectedDate
  }`;
  const requestGuard = useLatestRequestGuard();

  useEffect(() => {
    if (!isFetching && loadedScopeKey === requestScopeKey) {
      displayCacheRef.current = { scopeKey: requestScopeKey, links };
    }
  }, [isFetching, links, loadedScopeKey, requestScopeKey]);

  const hasCurrentScopeData = loadedScopeKey === requestScopeKey;
  const isCurrentScopeFetching = isFetching || !hasCurrentScopeData;
  useSectionLoadingTask(activeTab === "manage" && isCurrentScopeFetching);
  const displayLinks = !hasCurrentScopeData
    ? EMPTY_LINKS
    : isFetching && displayCacheRef.current.scopeKey === requestScopeKey
      ? displayCacheRef.current.links
      : links;

  // Update form date when selectedDate prop changes
  useEffect(() => {
    setFormData((prev) => ({ ...prev, date: selectedDate }));
    setFormValidationError((current) =>
      current?.field === "date" ? null : current,
    );
  }, [selectedDate]);

  const loadLinks = useCallback(async () => {
    const isLatestRequest = requestGuard.beginRequest();
    if (!venueId) {
      setLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    setError(null);
    try {
      const { data, error } =
        manageScope === "recent"
          ? await fetchRecentExternalLinks(venueId, recentLimit)
          : await fetchExternalLinksByDate(venueId, selectedDate);
      if (!isLatestRequest()) return;
      if (error) {
        console.error("Failed to load links:", error);
        setError(error);
      }
      setLinks(data ?? []);
      setLoadedScopeKey(requestScopeKey);
    } catch (err) {
      if (!isLatestRequest()) return;
      console.error("Failed to load links:", err);
      setLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setError(t("loadFailed"));
    } finally {
      if (isLatestRequest()) setIsFetching(false);
    }
  }, [manageScope, recentLimit, requestGuard, requestScopeKey, selectedDate, t, venueId]);

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
    setNativeShareAvailable(typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (activeTab !== "create" || !shouldFocusTemplateDateRef.current) return;
    shouldFocusTemplateDateRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      linkDateInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeTab, templateNotice]);

  useEffect(() => {
    if (!generatedLink || !shouldFocusGeneratedLinkRef.current) return;
    shouldFocusGeneratedLinkRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      generatedLinkPanelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [generatedLink]);

  const clearFormFieldError = (field: LinkFormField) => {
    setFormValidationError((current) =>
      current?.field === field ? null : current,
    );
  };

  const focusFormField = (field: LinkFormField) => {
    const target = {
      date: linkDateInputRef,
      dj: linkDjInputRef,
      event: linkEventInputRef,
      maxGuests: linkMaxGuestsInputRef,
      localeMode: linkLocaleInputRef,
    }[field];
    window.requestAnimationFrame(() => target.current?.focus());
  };

  const applyFormValidationError = (code: string): boolean => {
    const validationError: LinkFormValidationError | null = (() => {
      switch (code) {
        case "INVALID_DATE":
          return { field: "date", message: t("invalidDate") };
        case "INVALID_DJ_NAME":
        case "DJ_NAME_TOO_LONG":
          return { field: "dj", message: t("invalidDjName") };
        case "INVALID_EVENT":
        case "EVENT_TOO_LONG":
          return { field: "event", message: t("invalidEvent") };
        case "INVALID_MAX_GUESTS":
          return { field: "maxGuests", message: t("invalidMaxGuests") };
        case "INVALID_LOCALE_MODE":
          return { field: "localeMode", message: t("invalidLocaleMode") };
        default:
          return null;
      }
    })();
    if (!validationError) return false;

    setError(null);
    setFormValidationError(validationError);
    focusFormField(validationError.field);
    return true;
  };

  const getGuestPageUrl = (token: string, guestUrl?: string | null) => {
    if (guestUrl) return guestUrl;
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/guest?token=${token}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!venueId || isGenerating) return;

    const prepared = prepareExternalLinkCreateInput({
      date: formData.date,
      djName: formData.dj,
      event: formData.event,
      maxGuests: formData.maxGuests,
      localeMode: formData.localeMode,
    });
    if (prepared.error || !prepared.draft) {
      if (!applyFormValidationError(prepared.error ?? "INVALID_INPUT")) {
        setError(t("invalidCreateInput"));
      }
      return;
    }

    setIsGenerating(true);
    setError(null);
    setFormValidationError(null);

    try {
      const { data, error } = await createExternalLink({
        venueId,
        ...prepared.draft,
      });

      if (error) {
        console.error("Failed to create link:", error);
        if (!applyFormValidationError(error)) {
          setError(t("createFailed"));
        }
      } else if (data) {
        shouldFocusGeneratedLinkRef.current = true;
        setGeneratedLink(data);
        setTemplateNotice(null);
        setFormData({
          date: selectedDate,
          dj: "",
          event: "",
          maxGuests: 5,
          localeMode: "auto",
        });
      }
    } catch (createError) {
      console.error("Failed to create link:", createError);
      setError(t("createFailed"));
    } finally {
      setIsGenerating(false);
    }
  };

  const shareOrCopyLink = async (
    link: ExternalDJLink,
    url: string,
    id?: string,
  ) => {
    if (id) {
      setLoadingStates((prev) => ({ ...prev, [`share_${id}`]: true }));
    } else {
      setIsGeneratedLinkActionPending(true);
    }
    setError(null);

    const shareData = toExternalLinkShareData(
      url,
      t("shareTitle", { djName: link.djName }),
      t("shareText", {
        event: link.event || t("untitledEvent"),
        date: link.date ? formatDateDisplay(link.date, locale) : t("noDate"),
      }),
    );
    const result = await shareExternalLink(shareData, {
      share:
        typeof navigator.share === "function"
          ? (data) => navigator.share(data)
          : undefined,
      canShare:
        typeof navigator.canShare === "function"
          ? (data) => navigator.canShare(data)
          : undefined,
      copy: async (value) => {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard API is unavailable");
        }
        await navigator.clipboard.writeText(value);
      },
    });

    if (result === "shared" || result === "copied") {
      if (id) {
        setLinkActionFeedback({ id, result });
        window.setTimeout(() => {
          setLinkActionFeedback((current) =>
            current?.id === id ? null : current,
          );
        }, 2000);
      }
      setLinkActionToast(
        result === "shared"
          ? id
            ? t("guestLinkShared")
            : t("generatedLinkShared")
          : id
            ? t("guestLinkCopied")
            : t("generatedLinkCopied"),
      );
      window.setTimeout(() => setLinkActionToast(null), 2200);
    } else if (result === "failed") {
      setError(t("shareFailed"));
    }

    if (id) {
      setLoadingStates((prev) => ({ ...prev, [`share_${id}`]: false }));
    } else {
      setIsGeneratedLinkActionPending(false);
    }
  };

  const handleUseAsTemplate = (link: ExternalDJLink) => {
    const draft = toExternalLinkTemplateDraft(link, selectedDate);
    setFormData({
      date: draft.date,
      dj: draft.djName,
      event: draft.event,
      maxGuests: draft.maxGuests,
      localeMode: draft.localeMode,
    });
    setGeneratedLink(null);
    setError(null);
    setFormValidationError(null);
    setSuccess(null);
    setTemplateNotice(t("templateReady", { djName: draft.djName }));
    shouldFocusTemplateDateRef.current = true;
    setActiveTab("create");
  };

  const handleDeleteLink = async (id: string) => {
    requestGuard.invalidateRequests();
    setIsFetching(false);
    setError(null);
    setSuccess(null);
    setLoadingStates((prev) => ({ ...prev, [`delete_${id}`]: true }));
    const { error } = await deleteExternalLink(id);
    if (error) {
      console.error("Failed to delete link:", error);
      setError(t("deleteFailed"));
    } else {
      requestGuard.invalidateRequests();
      setIsFetching(false);
      setLinks((prev) => prev.filter((link) => link.id !== id));
      setSuccess(t("deleted"));
    }
    setLoadingStates((prev) => ({ ...prev, [`delete_${id}`]: false }));
    setPendingDeleteLink(null);
  };

  const requestDeleteLink = (link: ExternalDJLink) => {
    setError(null);
    setSuccess(null);
    setPendingDeleteLink(link);
  };

  const handleDeactivateLink = async (id: string) => {
    setError(null);
    setSuccess(null);

    setLoadingStates((prev) => ({ ...prev, [`deactivate_${id}`]: true }));
    const { error } = await deactivateExternalLink(id);
    if (error) {
      console.error("Failed to deactivate link:", error);
      setError(t("deactivateFailed"));
    } else {
      setLinks((prev) =>
        prev.map((link) =>
          link.id === id ? { ...link, active: false } : link,
        ),
      );
      setSuccess(t("deactivated"));
    }
    setLoadingStates((prev) => ({ ...prev, [`deactivate_${id}`]: false }));
    setPendingDeactivateLink(null);
  };

  const handleActivateLink = async (id: string) => {
    setError(null);
    setSuccess(null);

    setLoadingStates((prev) => ({ ...prev, [`activate_${id}`]: true }));
    const { error } = await activateExternalLink(id);
    if (error) {
      console.error("Failed to activate link:", error);
      setError(t("reactivateFailed"));
    } else {
      setLinks((prev) =>
        prev.map((link) => (link.id === id ? { ...link, active: true } : link)),
      );
      setSuccess(t("reactivated"));
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
    () => sortLinks(
      filteredLinks,
      manageScope === "recent" ? "newest" : manageSort,
      locale === "ko" ? "ko-KR" : "en-US",
    ),
    [filteredLinks, locale, manageScope, manageSort],
  );

  const getTabInfo = () => {
    switch (activeTab) {
      case "create":
        return {
          title: t("createLink"),
          description: t("createDescription"),
        };
      case "manage":
        return { title: t("manageLinks"), description: t("manageDescription") };
      default:
        return { title: "", description: "" };
    }
  };

  const tabInfo = getTabInfo();

  return (
    <>
      <OperationsLayout
        title={t("title")}
        dashboard={
          <>
        {(activeTab === "create" || manageScope === "date") && (
          <div className="context-bar">
            <DatePicker
              value={selectedDate}
              onChange={onDateChange}
              businessDate={businessDate}
              disabled={isGenerating}
            />
          </div>
        )}
        {/* Venue selector for super_admin */}
        {isSuperAdmin && venues.length > 0 && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
            disabled={isGenerating}
            className="app-panel p-4 sm:p-5"
          />
        )}
        <div>
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
            {activeTab === "manage" && (
              <div className="app-panel mt-4 p-4 sm:p-5">
                <p className="app-label">{t("view")}</p>
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
                      {scope === "date" ? t("byDate") : t("recent")}
                    </button>
                  ))}
                </div>
                {manageScope === "recent" && (
                  <div className="mt-3">
                    <p className="app-label">{t("items")}</p>
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
                ? t("latestCreated", { count: recentLimit })
                : formatDateDisplay(selectedDate, locale)}
            </p>
          </div>
          {activeTab === "manage" && (
            <StatGrid
              items={[
                { label: t("total"), value: dashboardStats.total, color: "default" },
                { label: t("active"), value: dashboardStats.active, color: "checked" },
                { label: t("attention"), value: dashboardStats.attention, color: "danger" },
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
                  {t("createAccessLink")}
                </h2>
                <p className="text-text-muted text-xs font-medium">
                  {t("createAccessDescription")}
                </p>
              </div>

              {templateNotice && (
                <Alert
                  type="success"
                  message={templateNotice}
                  className="mb-4"
                />
              )}
              {error && <Alert type="error" message={error} className="mb-4" />}

              <form
                onSubmit={handleSubmit}
                className="space-y-4 sm:space-y-6"
                aria-busy={isGenerating}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <label htmlFor="link-date" className="app-label">
                      {t("date")}
                    </label>
                    <div className="relative h-[46px] group">
                      {/* Mirroring UI Layer */}
                      <div
                        className={`absolute inset-0 flex items-center justify-between border bg-canvas px-4 py-3 transition-colors pointer-events-none group-focus-within:border-border-focus ${
                          formValidationError?.field === "date"
                            ? "border-status-danger"
                            : "border-border-strong"
                        }`}
                      >
                        <span className="text-text-heading text-sm">
                          {formatDateDisplay(formData.date, locale)}
                        </span>
                        <Icon name="calendar" size={18} className="text-text-muted" />
                      </div>

                      {/* Hidden Native Input */}
                      <input
                        id="link-date"
                        ref={linkDateInputRef}
                        type="date"
                        value={formData.date}
                        disabled={isGenerating}
                        aria-invalid={
                          formValidationError?.field === "date" || undefined
                        }
                        aria-describedby={
                          formValidationError?.field === "date"
                            ? "link-date-error"
                            : undefined
                        }
                        onChange={(e) => {
                          clearFormFieldError("date");
                          setFormData({ ...formData, date: e.target.value });
                        }}
                        onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 [color-scheme:dark]"
                        required
                      />
                    </div>
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
                    <input
                      id="link-dj-name"
                      ref={linkDjInputRef}
                      type="text"
                      value={formData.dj}
                      disabled={isGenerating}
                      aria-invalid={
                        formValidationError?.field === "dj" || undefined
                      }
                      aria-describedby={
                        formValidationError?.field === "dj"
                          ? "link-dj-name-error"
                          : undefined
                      }
                      maxLength={MAX_EXTERNAL_LINK_DJ_NAME_LENGTH}
                      onChange={(e) => {
                        clearFormFieldError("dj");
                        setFormData({
                          ...formData,
                          dj: e.target.value.toUpperCase(),
                        });
                      }}
                      className={`w-full border bg-canvas px-4 py-3 text-sm uppercase text-text-heading focus:outline-none focus:border-border-focus disabled:cursor-not-allowed disabled:opacity-60 ${
                        formValidationError?.field === "dj"
                          ? "border-status-danger"
                          : "border-border-strong"
                      }`}
                      placeholder={t("djName")}
                      required
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
                  <input
                    id="link-event-name"
                    ref={linkEventInputRef}
                    type="text"
                    value={formData.event}
                    disabled={isGenerating}
                    aria-invalid={
                      formValidationError?.field === "event" || undefined
                    }
                    aria-describedby={
                      formValidationError?.field === "event"
                        ? "link-event-name-error"
                        : undefined
                    }
                    maxLength={MAX_EXTERNAL_LINK_EVENT_LENGTH}
                    onChange={(e) => {
                      clearFormFieldError("event");
                      setFormData({
                        ...formData,
                        event: e.target.value.toUpperCase(),
                      });
                    }}
                    className={`w-full border bg-canvas px-4 py-3 text-sm uppercase text-text-heading focus:outline-none focus:border-border-focus disabled:cursor-not-allowed disabled:opacity-60 ${
                      formValidationError?.field === "event"
                        ? "border-status-danger"
                        : "border-border-strong"
                    }`}
                    placeholder={t("eventName")}
                    required
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

                <div>
                  <label htmlFor="link-max-guests" className="app-label">
                    {t("maxGuests")}
                  </label>
                  <input
                    id="link-max-guests"
                    ref={linkMaxGuestsInputRef}
                    type="number"
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
                    className={`w-full border bg-canvas px-4 py-3 text-sm text-text-heading focus:outline-none focus:border-border-focus disabled:cursor-not-allowed disabled:opacity-60 ${
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
                            ? "border-action-primary bg-action-primary text-action-text"
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

                <button
                  type="submit"
                  disabled={isGenerating}
                  className="w-full bg-action-primary py-3 text-sm font-semibold text-action-text transition-colors hover:bg-action-hover disabled:bg-border-strong disabled:text-text-muted disabled:opacity-50 sm:py-4"
                >
                  {isGenerating ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-canvas border-t-transparent rounded-full animate-spin"></div>
                      {t("generating")}
                    </div>
                  ) : (
                    t("generateLink")
                  )}
                </button>
              </form>
            </div>

            {generatedLink && (
              <div
                ref={generatedLinkPanelRef}
                className="app-panel p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus sm:p-6"
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
                    className="text-text-muted font-mono text-xs"
                  >
                    {generatedLink.djName} / {generatedLink.event} | {t("max")}:{" "}
                    {generatedLink.maxGuests}
                  </p>
                  <p className="mt-1 font-mono text-xs text-text-dim">
                    {t("language")}: {generatedLink.localeMode === "auto" ? t("auto") : generatedLink.localeMode.toUpperCase()}
                  </p>
                </div>

                <div className="bg-canvas border border-border-default p-4 mb-4">
                  <div className="font-mono text-xs tracking-wider text-text-muted mb-1">
                    {t("guestUrl")}
                  </div>
                  <div className="font-mono text-sm tracking-wider text-text-heading break-all">
                    {getGuestPageUrl(generatedLink.token, generatedLink.guestUrl)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    shareOrCopyLink(
                      generatedLink,
                      getGuestPageUrl(
                        generatedLink.token,
                        generatedLink.guestUrl,
                      ),
                    )
                  }
                  disabled={isGeneratedLinkActionPending}
                  className="min-h-11 w-full bg-action-primary py-3 text-xs font-semibold text-action-text transition-colors hover:bg-action-hover disabled:opacity-50"
                >
                  {isGeneratedLinkActionPending ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-3 h-3 border-2 border-canvas border-t-transparent rounded-full animate-spin"></div>
                      {nativeShareAvailable ? t("sharing") : t("copying")}
                    </div>
                  ) : (
                    nativeShareAvailable ? t("shareLink") : t("copyLink")
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
                title={t("linkList")}
                count={sortedLinks.length}
                onRefresh={loadLinks}
                isLoading={isCurrentScopeFetching}
              />

              <div className="border-b border-border-subtle p-4 sm:p-5">
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
                        {t("sort")}
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
                    ? t("latestCreated", { count: recentLimit })
                    : formatDateDisplay(selectedDate, locale)}
                </p>
              </div>

              {isCurrentScopeFetching && sortedLinks.length === 0 ? (
                <Skeleton rows={5} />
              ) : (
                <div
                  className={`divide-y divide-border-default lg:overflow-y-auto transition-opacity duration-200 ${isCurrentScopeFetching ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {sortedLinks.length === 0 ? (
                    <EmptyState
                      icon="link"
                      message={t("noLinks")}
                    />
                  ) : (
                    sortedLinks.map((link, index) => {
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

                      const primaryStatus = status.expired
                        ? { label: t("expired"), tone: "border-status-danger text-status-danger", indicator: "before:bg-status-danger" }
                        : status.inactive
                          ? { label: t("inactive"), tone: "border-border-strong text-text-muted", indicator: "before:bg-border-strong" }
                          : status.full
                            ? { label: t("full"), tone: "border-status-danger text-status-danger", indicator: "before:bg-status-danger" }
                            : status.expiringSoon
                              ? { label: t("expiring"), tone: "border-status-waiting text-status-waiting", indicator: "before:bg-status-waiting" }
                              : { label: t("active"), tone: "border-status-checked text-status-checked", indicator: "before:bg-status-checked" };

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
                                {link.event || t("untitledEvent")}
                              </p>
                            </div>
                          </div>
                          <span className={`inline-flex min-h-7 items-center border-l-2 pl-2 text-xs font-semibold ${primaryStatus.tone}`}>
                            {primaryStatus.label}
                          </span>
                        </div>

                        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 pl-10 sm:pl-11">
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
                            <dd className="mt-0.5 font-mono text-xs uppercase text-text-muted">
                              {link.localeMode === "auto" ? t("auto") : link.localeMode}
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
                              {t("guestUrl")}
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
                                {t("open")}
                              </a>
                            </div>
                            <p className="app-helper">
                              {t("urlHelp")}
                            </p>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap justify-end gap-2 pl-10 sm:pl-11">
                          <button
                            type="button"
                            onClick={() => handleUseAsTemplate(link)}
                            className="min-h-11 border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-muted hover:border-border-strong hover:bg-surface-raised hover:text-text-heading"
                          >
                            {t("useAsTemplate")}
                          </button>
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
                            {isLinkVisible ? t("hide") : t("view")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              shareOrCopyLink(link, guestPageUrl, link.id)
                            }
                            disabled={loadingStates[`share_${link.id}`]}
                            className="inline-flex min-h-11 items-center justify-center gap-2 bg-action-primary px-4 py-2 text-xs font-semibold text-action-text transition-colors hover:bg-action-hover disabled:opacity-50"
                          >
                            {loadingStates[`share_${link.id}`] ? (
                              <>
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-canvas border-t-transparent" />
                                {nativeShareAvailable
                                  ? t("sharing")
                                  : t("copying")}
                              </>
                            ) : completedLinkAction === "shared" ? (
                              t("shared")
                            ) : completedLinkAction === "copied" ? (
                              t("copied")
                            ) : (
                              nativeShareAvailable
                                ? t("shareLink")
                                : t("copyLink")
                            )}
                          </button>
                          {status.expired ? (
                            <span className="inline-flex min-h-11 items-center border border-status-danger/70 px-3 text-xs text-status-danger">
                              {t("expired")}
                            </span>
                          ) : link.active ? (
                            <button
                              onClick={() => setPendingDeactivateLink(link)}
                              disabled={loadingStates[`deactivate_${link.id}`]}
                              className="min-h-11 border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-muted hover:bg-surface-raised disabled:opacity-50"
                            >
                              {loadingStates[`deactivate_${link.id}`]
                                ? "..."
                                : t("deactivate")}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleActivateLink(link.id)}
                              disabled={loadingStates[`activate_${link.id}`]}
                              className="min-h-11 border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-heading hover:bg-surface-raised disabled:opacity-50"
                            >
                              {loadingStates[`activate_${link.id}`]
                                ? "..."
                                : t("activate")}
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
                              t("delete")
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

      {linkActionToast && (
        <div className="fixed bottom-5 right-5 z-40 border border-border-strong bg-surface-raised px-4 py-3 text-text-heading" role="status" aria-live="polite" aria-atomic="true">
          <p className="text-xs font-medium uppercase tracking-[0.05em]">
            {linkActionToast}
          </p>
        </div>
      )}

      {pendingDeactivateLink && (
        <ConfirmDialog
          open
          title={t("deactivateTitle")}
          description={t("deactivateConfirm")}
          confirmLabel={t("deactivate")}
          cancelLabel={commonT("cancel")}
          onConfirm={() => handleDeactivateLink(pendingDeactivateLink.id)}
          onCancel={() => setPendingDeactivateLink(null)}
          isLoading={loadingStates[`deactivate_${pendingDeactivateLink.id}`]}
        />
      )}

      {pendingDeleteLink && (
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
          <div className="border border-border-strong bg-surface p-3">
            <p className="break-words text-sm font-medium text-text-heading">
              {pendingDeleteLink.djName} / {pendingDeleteLink.event}
            </p>
            <p className="mt-2 text-xs text-text-muted">
              {t("usage")} {pendingDeleteLink.usedGuests}/{pendingDeleteLink.maxGuests}
            </p>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
