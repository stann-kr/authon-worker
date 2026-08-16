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
import Button from "../../../components/Button";
import { useSectionLoadingTask } from "../../../components/RouteTransitionProvider";
import {
  useLatestRequestGuard,
  useScopedOperationGuard,
} from "../../../lib/hooks";
import { formatDateDisplay } from "../../../lib/date";
import {
  deriveAsyncListState,
  shouldShowEmptyState,
} from "../../../lib/ui/async-list-state";
import {
  fetchExternalLinksByDate,
  fetchRecentExternalLinks,
  fetchExternalDjDirectory,
  createExternalLink,
  deleteExternalLink,
  deactivateExternalLink,
  activateExternalLink,
} from "../../../lib/api/external-links";
import type {
  ExternalDJLink,
  ExternalDjSuggestion,
} from "../../../lib/api/types";
import {
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
import ExternalDjCombobox from "./ExternalDjCombobox";

const EMPTY_LINKS: ExternalDJLink[] = [];

interface LinkFormData {
  date: string;
  dj: string;
  contributorId: string | null;
  event: string;
  maxGuests: number | "";
  localeMode: ExternalDJLink["localeMode"];
  kind: ExternalDJLink["kind"];
}

type LinkFormField = "date" | "dj" | "event" | "maxGuests" | "localeMode" | "kind";

interface LinkFormValidationError {
  field: LinkFormField;
  message: string;
}

interface LinkActionFeedback {
  id: string;
  operationId: number;
  result: Extract<ExternalLinkShareResult, "shared" | "copied">;
}

export type LinkManagementSection = "create" | "manage";

interface LinkManagementProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  businessDate: string;
  activeSection?: LinkManagementSection;
  onActiveSectionChange?: (section: LinkManagementSection) => void;
  showSectionNavigation?: boolean;
  eventId?: string | null;
}

export default function LinkManagement({
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
  const [internalActiveSection, setInternalActiveSection] =
    useState<LinkManagementSection>("create");
  const activeTab = activeSection ?? internalActiveSection;
  const setActiveTab = useCallback(
    (section: LinkManagementSection) => {
      if (onActiveSectionChange) {
        onActiveSectionChange(section);
        return;
      }
      setInternalActiveSection(section);
    },
    [onActiveSectionChange],
  );
  const [manageScope, setManageScope] = useState<"date" | "recent">("date");
  const [recentLimit, setRecentLimit] = useState<5 | 10>(5);
  const [manageFilter, setManageFilter] = useState<ManageFilter>("all");
  const [manageSort, setManageSort] = useState<ManageSort>("newest");
  const [now, setNow] = useState(() => Date.now());
  const [formData, setFormData] = useState<LinkFormData>({
    date: selectedDate,
    dj: "",
    contributorId: null,
    event: "",
    maxGuests: 5,
    localeMode: "auto" as ExternalDJLink["localeMode"],
    kind: "contributor" as ExternalDJLink["kind"],
  });
  const [generatedLink, setGeneratedLink] = useState<ExternalDJLink | null>(
    null,
  );
  const [generatedLinkScopeKey, setGeneratedLinkScopeKey] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratedLinkActionPending, setIsGeneratedLinkActionPending] =
    useState(false);
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const [links, setLinks] = useState<ExternalDJLink[]>([]);
  const [djSuggestions, setDjSuggestions] = useState<ExternalDjSuggestion[]>([]);
  const [djDirectoryVenueId, setDjDirectoryVenueId] = useState("");
  const [isDjDirectoryLoading, setIsDjDirectoryLoading] = useState(false);
  const [djDirectoryError, setDjDirectoryError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const [linkActionFeedback, setLinkActionFeedback] =
    useState<LinkActionFeedback | null>(null);
  const [visibleLinkId, setVisibleLinkId] = useState<string | null>(null);
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [error, setError] = useState<string | null>(null);
  const [errorScopeKey, setErrorScopeKey] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [successScopeKey, setSuccessScopeKey] = useState("");
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
  const linkKindInputRef = useRef<HTMLInputElement>(null);
  const generatedLinkPanelRef = useRef<HTMLDivElement>(null);
  const shouldFocusTemplateDateRef = useRef(false);
  const shouldFocusGeneratedLinkRef = useRef(false);
  const activeCreateOperationIdRef = useRef<number | null>(null);
  const linkActionToastOwnerRef = useRef<number | null>(null);

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
    currentVenue,
  } = useVenueSelector();

  const requestScopeKey = `${venueId}:${manageScope}:${
    manageScope === "recent" ? recentLimit : selectedDate
  }:${eventId ?? "general"}`;
  const credentialScopeKey = `${venueId}:create:${formData.date}:${eventId ?? "general"}`;
  const requestGuard = useLatestRequestGuard();
  const djDirectoryRequestGuard = useLatestRequestGuard();
  const linkMutationGuard = useScopedOperationGuard();
  const createOperationGuard = useScopedOperationGuard();
  const shareOperationGuard = useScopedOperationGuard();
  const currentRequestScopeKeyRef = useRef(requestScopeKey);
  const currentCredentialScopeKeyRef = useRef(credentialScopeKey);
  const currentVenueIdRef = useRef(venueId);
  currentRequestScopeKeyRef.current = requestScopeKey;
  currentCredentialScopeKeyRef.current = credentialScopeKey;
  currentVenueIdRef.current = venueId;
  const scopedGeneratedLink =
    generatedLinkScopeKey === credentialScopeKey ? generatedLink : null;
  const currentMessageScopeKey =
    activeTab === "create" ? credentialScopeKey : requestScopeKey;
  const scopedError = errorScopeKey === currentMessageScopeKey ? error : null;
  const scopedSuccess =
    successScopeKey === currentMessageScopeKey ? success : null;
  const currentDjSuggestions =
    djDirectoryVenueId === venueId ? djSuggestions : [];

  useEffect(() => {
    requestGuard.invalidateRequests();
    linkMutationGuard.invalidateOperations();
    shareOperationGuard.invalidateOperations();
    setLoadingStates({});
    setPendingDeleteLink(null);
    setPendingDeactivateLink(null);
    setLinkActionFeedback(null);
    setError(null);
    setErrorScopeKey("");
    setSuccess(null);
    setSuccessScopeKey("");
    setLoadOutcome("idle");
  }, [linkMutationGuard, requestGuard, requestScopeKey, shareOperationGuard]);

  useEffect(() => {
    createOperationGuard.invalidateOperations();
    shareOperationGuard.invalidateOperations();
    activeCreateOperationIdRef.current = null;
    linkActionToastOwnerRef.current = null;
    shouldFocusGeneratedLinkRef.current = false;
    setIsGenerating(false);
    setIsGeneratedLinkActionPending(false);
    setGeneratedLink(null);
    setGeneratedLinkScopeKey("");
    setLinkActionToast(null);
    setError(null);
    setErrorScopeKey("");
    setFormValidationError(null);
  }, [createOperationGuard, credentialScopeKey, shareOperationGuard]);

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

  useEffect(() => {
    djDirectoryRequestGuard.invalidateRequests();
    setDjSuggestions([]);
    setDjDirectoryVenueId("");
    setDjDirectoryError(null);
    setIsDjDirectoryLoading(false);
    setFormData((prev) => ({ ...prev, contributorId: null }));
  }, [djDirectoryRequestGuard, venueId]);

  const loadDjDirectory = useCallback(async () => {
    const requestedVenueId = venueId;
    const isLatestRequest = djDirectoryRequestGuard.beginRequest();
    if (!requestedVenueId) {
      setDjSuggestions([]);
      setDjDirectoryVenueId("");
      setDjDirectoryError(null);
      setIsDjDirectoryLoading(false);
      return;
    }

    setIsDjDirectoryLoading(true);
    setDjDirectoryError(null);
    try {
      const { data, error } = await fetchExternalDjDirectory(requestedVenueId);
      if (!isLatestRequest() || currentVenueIdRef.current !== requestedVenueId) {
        return;
      }
      setDjSuggestions(data ?? []);
      setDjDirectoryVenueId(requestedVenueId);
      setDjDirectoryError(error ? t("djDirectoryUnavailable") : null);
    } catch (directoryError) {
      if (!isLatestRequest() || currentVenueIdRef.current !== requestedVenueId) {
        return;
      }
      console.error("Failed to load external DJ directory:", directoryError);
      setDjSuggestions([]);
      setDjDirectoryVenueId(requestedVenueId);
      setDjDirectoryError(t("djDirectoryUnavailable"));
    } finally {
      if (isLatestRequest() && currentVenueIdRef.current === requestedVenueId) {
        setIsDjDirectoryLoading(false);
      }
    }
  }, [djDirectoryRequestGuard, t, venueId]);

  const loadLinks = useCallback(async () => {
    if (currentRequestScopeKeyRef.current !== requestScopeKey) return;
    const isLatestRequest = requestGuard.beginRequest();
    if (!venueId) {
      setLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setLoadOutcome("success");
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    setError(null);
    try {
      const { data, error } =
        manageScope === "recent"
          ? await fetchRecentExternalLinks(venueId, recentLimit, eventId)
          : await fetchExternalLinksByDate(venueId, selectedDate, eventId);
      if (
        !isLatestRequest() ||
        currentRequestScopeKeyRef.current !== requestScopeKey
      ) return;
      if (error) {
        console.error("Failed to load links:", error);
        setError(t("loadFailed"));
        setErrorScopeKey(requestScopeKey);
        setLoadOutcome(data ? "partial" : "error");
      } else {
        setLoadOutcome("success");
      }
      setLinks(data ?? []);
      setLoadedScopeKey(requestScopeKey);
    } catch (err) {
      if (
        !isLatestRequest() ||
        currentRequestScopeKeyRef.current !== requestScopeKey
      ) return;
      console.error("Failed to load links:", err);
      setLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setError(t("loadFailed"));
      setErrorScopeKey(requestScopeKey);
      setLoadOutcome("error");
    } finally {
      if (
        isLatestRequest() &&
        currentRequestScopeKeyRef.current === requestScopeKey
      ) setIsFetching(false);
    }
  }, [eventId, manageScope, recentLimit, requestGuard, requestScopeKey, selectedDate, t, venueId]);

  useEffect(() => {
    if (activeTab === "manage") {
      loadLinks();
    }
  }, [activeTab, loadLinks]);

  useEffect(() => {
    if (activeTab === "create") {
      void loadDjDirectory();
    }
  }, [activeTab, loadDjDirectory]);

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
    if (!scopedGeneratedLink || !shouldFocusGeneratedLinkRef.current) return;
    shouldFocusGeneratedLinkRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      generatedLinkPanelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [scopedGeneratedLink]);

  const clearFormFieldError = useCallback((field: LinkFormField) => {
    setFormValidationError((current) =>
      current?.field === field ? null : current,
    );
  }, []);

  const handleDjChange = useCallback(
    (dj: string, contributorId: string | null) => {
      clearFormFieldError("dj");
      setFormData((current) => ({ ...current, dj, contributorId }));
    },
    [clearFormFieldError],
  );

  const focusFormField = (field: LinkFormField) => {
    const target = {
      date: linkDateInputRef,
      dj: linkDjInputRef,
      event: linkEventInputRef,
      maxGuests: linkMaxGuestsInputRef,
      localeMode: linkLocaleInputRef,
      kind: linkKindInputRef,
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
        case "INVALID_CONTRIBUTOR":
          return { field: "dj", message: t("invalidContributor") };
        case "INVALID_EVENT":
        case "EVENT_TOO_LONG":
          return { field: "event", message: t("invalidEvent") };
        case "INVALID_MAX_GUESTS":
          return { field: "maxGuests", message: t("invalidMaxGuests") };
        case "INVALID_LOCALE_MODE":
          return { field: "localeMode", message: t("invalidLocaleMode") };
        case "INVALID_LINK_KIND":
          return { field: "kind", message: t("invalidLinkKind") };
        default:
          return null;
      }
    })();
    if (!validationError) return false;

    setError(null);
    setErrorScopeKey("");
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
    if (!venueId || activeCreateOperationIdRef.current !== null) return;

    const prepared = prepareExternalLinkCreateInput({
      date: formData.date,
      djName: formData.dj,
      contributorId: formData.contributorId,
      event: formData.event,
      maxGuests: formData.maxGuests,
      localeMode: formData.localeMode,
      kind: formData.kind,
    });
    if (prepared.error || !prepared.draft) {
      if (!applyFormValidationError(prepared.error ?? "INVALID_INPUT")) {
        setError(t("invalidCreateInput"));
        setErrorScopeKey(credentialScopeKey);
      }
      return;
    }

    const operationVenueId = venueId;
    const operationDate = selectedDate;
    const operation = createOperationGuard.beginOperation(
      credentialScopeKey,
      "create-link",
    );
    activeCreateOperationIdRef.current = operation.id;
    setIsGenerating(true);
    setError(null);
    setFormValidationError(null);

    try {
      const { data, error } = await createExternalLink({
        venueId: operationVenueId,
        eventId,
        ...prepared.draft,
      });

      if (!operation.isCurrent(currentCredentialScopeKeyRef.current)) return;
      if (error) {
        console.error("Failed to create link:", error);
        if (!applyFormValidationError(error)) {
          setError(t("createFailed"));
          setErrorScopeKey(operation.scopeKey);
        }
      } else if (data) {
        shouldFocusGeneratedLinkRef.current = true;
        setGeneratedLink(data);
        setGeneratedLinkScopeKey(operation.scopeKey);
        setTemplateNotice(null);
        setFormData({
          date: operationDate,
          dj: "",
          contributorId: null,
          event: "",
          maxGuests: 5,
          localeMode: "auto",
          kind: "contributor",
        });
        void loadDjDirectory();
      }
    } catch (createError) {
      if (!operation.isCurrent(currentCredentialScopeKeyRef.current)) return;
      console.error("Failed to create link:", createError);
      setError(t("createFailed"));
      setErrorScopeKey(operation.scopeKey);
    } finally {
      if (activeCreateOperationIdRef.current === operation.id) {
        activeCreateOperationIdRef.current = null;
        if (operation.finish(currentCredentialScopeKeyRef.current)) {
          setIsGenerating(false);
        }
      }
    }
  };

  const shareOrCopyLink = async (url: string, id?: string) => {
    const operationScopeKey = id ? requestScopeKey : credentialScopeKey;
    const operationScopeRef = id
      ? currentRequestScopeKeyRef
      : currentCredentialScopeKeyRef;
    const operation = shareOperationGuard.beginOperation(
      operationScopeKey,
      `share:${id ?? "generated"}`,
    );
    if (id) {
      setLoadingStates((prev) => ({ ...prev, [`share_${id}`]: true }));
    } else {
      setIsGeneratedLinkActionPending(true);
    }
    setError(null);

    const shareData = toExternalLinkShareData(url);
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

    if (!operation.isCurrent(operationScopeRef.current)) return;
    if (result === "shared" || result === "copied") {
      if (id) {
        setLinkActionFeedback({ id, operationId: operation.id, result });
        window.setTimeout(() => {
          setLinkActionFeedback((current) =>
            current?.id === id && current.operationId === operation.id
              ? null
              : current,
          );
        }, 2000);
      }
      linkActionToastOwnerRef.current = operation.id;
      setLinkActionToast(
        result === "shared"
          ? id
            ? t("guestLinkShared")
            : t("generatedLinkShared")
          : id
            ? t("guestLinkCopied")
            : t("generatedLinkCopied"),
      );
      window.setTimeout(() => {
        if (linkActionToastOwnerRef.current === operation.id) {
          linkActionToastOwnerRef.current = null;
          setLinkActionToast(null);
        }
      }, 2200);
    } else if (result === "failed") {
      setError(t("shareFailed"));
      setErrorScopeKey(operation.scopeKey);
    }

    if (operation.finish(operationScopeRef.current)) {
      if (id) {
        setLoadingStates((prev) => ({ ...prev, [`share_${id}`]: false }));
      } else {
        setIsGeneratedLinkActionPending(false);
      }
    }
  };

  const handleUseAsTemplate = (link: ExternalDJLink) => {
    const draft = toExternalLinkTemplateDraft(link, selectedDate);
    setFormData({
      date: draft.date,
      dj: draft.djName,
      contributorId: draft.contributorId,
      event: draft.event,
      maxGuests: draft.maxGuests,
      localeMode: draft.localeMode,
      kind: draft.kind,
    });
    setGeneratedLink(null);
    setGeneratedLinkScopeKey("");
    setError(null);
    setFormValidationError(null);
    setSuccess(null);
    setTemplateNotice(t("templateReady", { djName: draft.djName }));
    shouldFocusTemplateDateRef.current = true;
    setActiveTab("create");
  };

  const handleDeleteLink = async (id: string) => {
    const operation = linkMutationGuard.beginOperation(
      requestScopeKey,
      `delete:${id}`,
    );
    requestGuard.invalidateRequests();
    setIsFetching(false);
    setError(null);
    setSuccess(null);
    setLoadingStates((prev) => ({ ...prev, [`delete_${id}`]: true }));
    try {
      const { error } = await deleteExternalLink(id);
      if (!operation.isCurrent(currentRequestScopeKeyRef.current)) return;
      if (error) {
        console.error("Failed to delete link:", error);
        setError(t("deleteFailed"));
        setErrorScopeKey(operation.scopeKey);
      } else {
        requestGuard.invalidateRequests();
        setIsFetching(false);
        setLinks((prev) => prev.filter((link) => link.id !== id));
        setSuccess(t("deleted"));
        setSuccessScopeKey(operation.scopeKey);
      }
    } catch (deleteError) {
      if (!operation.isCurrent(currentRequestScopeKeyRef.current)) return;
      console.error("Failed to delete link:", deleteError);
      setError(t("deleteFailed"));
      setErrorScopeKey(operation.scopeKey);
    } finally {
      if (operation.finish(currentRequestScopeKeyRef.current)) {
        setLoadingStates((prev) => ({ ...prev, [`delete_${id}`]: false }));
        setPendingDeleteLink(null);
      }
    }
  };

  const requestDeleteLink = (link: ExternalDJLink) => {
    setError(null);
    setSuccess(null);
    setPendingDeleteLink(link);
  };

  const handleDeactivateLink = async (id: string) => {
    const operation = linkMutationGuard.beginOperation(
      requestScopeKey,
      `deactivate:${id}`,
    );
    requestGuard.invalidateRequests();
    setIsFetching(false);
    setError(null);
    setSuccess(null);

    setLoadingStates((prev) => ({ ...prev, [`deactivate_${id}`]: true }));
    try {
      const { error } = await deactivateExternalLink(id);
      if (!operation.isCurrent(currentRequestScopeKeyRef.current)) return;
      if (error) {
        console.error("Failed to deactivate link:", error);
        setError(t("deactivateFailed"));
        setErrorScopeKey(operation.scopeKey);
      } else {
        setLinks((prev) =>
          prev.map((link) =>
            link.id === id ? { ...link, active: false } : link,
          ),
        );
        setSuccess(t("deactivated"));
        setSuccessScopeKey(operation.scopeKey);
      }
    } catch (deactivateError) {
      if (!operation.isCurrent(currentRequestScopeKeyRef.current)) return;
      console.error("Failed to deactivate link:", deactivateError);
      setError(t("deactivateFailed"));
      setErrorScopeKey(operation.scopeKey);
    } finally {
      if (operation.finish(currentRequestScopeKeyRef.current)) {
        setLoadingStates((prev) => ({
          ...prev,
          [`deactivate_${id}`]: false,
        }));
        setPendingDeactivateLink(null);
      }
    }
  };

  const handleActivateLink = async (id: string) => {
    const operation = linkMutationGuard.beginOperation(
      requestScopeKey,
      `activate:${id}`,
    );
    requestGuard.invalidateRequests();
    setIsFetching(false);
    setError(null);
    setSuccess(null);

    setLoadingStates((prev) => ({ ...prev, [`activate_${id}`]: true }));
    try {
      const { error } = await activateExternalLink(id);
      if (!operation.isCurrent(currentRequestScopeKeyRef.current)) return;
      if (error) {
        console.error("Failed to activate link:", error);
        setError(t("reactivateFailed"));
        setErrorScopeKey(operation.scopeKey);
      } else {
        setLinks((prev) =>
          prev.map((link) =>
            link.id === id ? { ...link, active: true } : link,
          ),
        );
        setSuccess(t("reactivated"));
        setSuccessScopeKey(operation.scopeKey);
      }
    } catch (activateError) {
      if (!operation.isCurrent(currentRequestScopeKeyRef.current)) return;
      console.error("Failed to activate link:", activateError);
      setError(t("reactivateFailed"));
      setErrorScopeKey(operation.scopeKey);
    } finally {
      if (operation.finish(currentRequestScopeKeyRef.current)) {
        setLoadingStates((prev) => ({
          ...prev,
          [`activate_${id}`]: false,
        }));
      }
    }
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
  const listState = deriveAsyncListState({
    hasStarted: isFetching || loadOutcome !== "idle",
    isLoading: isCurrentScopeFetching,
    itemCount: sortedLinks.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });

  return (
    <>
      <OperationsLayout
        variant="stacked"
        title={t("title")}
        headingLevel={null}
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
                className={`app-panel p-4 sm:p-5 ${showSectionNavigation ? "mt-4" : ""}`}
              >
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
                      className={`min-h-11 border px-3 py-2 text-xs font-medium ${
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
        )}

        {activeTab === "manage" && (
          <div className="app-panel p-3 sm:p-4">
            <StatGrid
              items={[
                { label: t("total"), value: dashboardStats.total, color: "default" },
                { label: t("active"), value: dashboardStats.active, color: "checked" },
                { label: t("attention"), value: dashboardStats.attention, color: "danger" },
              ]}
            />
          </div>
        )}
          </>
        }
      >

      <div className="min-w-0">
        {activeTab === "create" && (
          <div className="space-y-6">
            <div className="app-panel p-4 sm:p-6">
              <h3 className="type-panel-title mb-6">
                {t("createAccessLink")}
              </h3>

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
                        name="link-date"
                        ref={linkDateInputRef}
                        type="date"
                        autoComplete="off"
                        value={formData.date}
                        disabled={isGenerating || Boolean(eventId)}
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
                    <ExternalDjCombobox
                      ref={linkDjInputRef}
                      value={formData.dj}
                      contributorId={formData.contributorId}
                      suggestions={currentDjSuggestions}
                      isDirectoryEnabled={formData.kind === "contributor"}
                      isDirectoryLoading={isDjDirectoryLoading}
                      directoryError={djDirectoryError}
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
                  <input
                    id="link-event-name"
                    name="event-name"
                    ref={linkEventInputRef}
                    type="text"
                    autoComplete="off"
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
                    className={`app-field uppercase ${
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

                <fieldset
                  aria-invalid={
                    formValidationError?.field === "kind" || undefined
                  }
                  aria-describedby="link-kind-help"
                >
                  <legend className="app-label">{t("accessType")}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
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
                        className={`min-h-20 cursor-pointer border p-3 transition-colors ${
                          formData.kind === option.value
                            ? "border-action-primary bg-surface-active"
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
                            className="mt-0.5 h-4 w-4 accent-[var(--action-primary)]"
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
                  <p id="link-kind-help" className="app-helper">
                    {t("accessTypeHelp")}
                  </p>
                  {formValidationError?.field === "kind" && (
                    <p className="mt-1 text-xs text-status-danger" role="alert">
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
                    className="break-words font-mono text-xs text-text-muted"
                  >
                    {scopedGeneratedLink.djName} / {scopedGeneratedLink.event} | {t("max")}:{" "}
                    {scopedGeneratedLink.maxGuests}
                  </p>
                  <p className="mt-1 font-mono text-xs text-text-dim">
                    {t("language")}: {scopedGeneratedLink.localeMode === "auto" ? t("auto") : scopedGeneratedLink.localeMode.toUpperCase()}
                  </p>
                  <p className="mt-1 text-xs text-text-dim">
                    {t("accessType")}: {scopedGeneratedLink.kind === "self_rsvp" ? t("selfRsvpLink") : t("contributorLink")}
                  </p>
                </div>

                <div className="bg-canvas border border-border-default p-4 mb-4">
                  <div className="font-mono text-xs tracking-wider text-text-muted mb-1">
                    {t("guestUrl")}
                  </div>
                  <div className="font-mono text-sm tracking-wider text-text-heading break-all">
                    {getGuestPageUrl(scopedGeneratedLink.token, scopedGeneratedLink.guestUrl)}
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() =>
                    shareOrCopyLink(
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
        )}

        {activeTab === "manage" && (
          <div className="space-y-4">
            {scopedError && <Alert type="error" message={scopedError} />}
            {scopedSuccess && <Alert type="success" message={scopedSuccess} />}

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
                        className={`min-h-11 border px-3 py-2 text-xs font-medium transition-colors ${
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
                    ? t("latestCreated", { count: recentLimit })
                    : formatDateDisplay(selectedDate, locale)}
                </p>
              </div>

              {listState === "loading" ? (
                <Skeleton rows={5} />
              ) : listState === "error" ? null : (
                <div
                  aria-busy={isCurrentScopeFetching}
                  className={`divide-y divide-border-default lg:overflow-y-auto ${
                    isCurrentScopeFetching ? "pointer-events-none" : ""
                  }`}
                >
                  {shouldShowEmptyState(listState) ? (
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
                              <p className="mt-1 text-xs text-text-dim">
                                {link.kind === "self_rsvp" ? t("selfRsvpLink") : t("contributorLink")}
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
                            className="mt-3 border border-border-default bg-canvas p-3 sm:ml-11"
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

                        <div className="mt-3 flex flex-wrap justify-end gap-2 sm:pl-11">
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
                              setVisibleLinkId((current) =>
                                current === link.id ? null : link.id,
                              )
                            }
                            aria-expanded={isLinkVisible}
                            aria-controls={`link-url-panel-${link.id}`}
                            variant="secondary"
                            size="sm"
                            leftIcon={
                              <Icon
                                name={isLinkVisible ? "view-off" : "view"}
                                size={16}
                              />
                            }
                          >
                            {isLinkVisible ? t("hide") : t("view")}
                          </Button>
                          <Button
                            type="button"
                            onClick={() =>
                              shareOrCopyLink(guestPageUrl, link.id)
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
                            <span className="inline-flex min-h-11 items-center border border-status-danger/70 px-3 text-xs text-status-danger">
                              {t("expired")}
                            </span>
                          ) : link.active ? (
                            <Button
                              type="button"
                              onClick={() => setPendingDeactivateLink(link)}
                              variant="secondary"
                              size="sm"
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
                              isLoading={loadingStates[`activate_${link.id}`]}
                            >
                              {t("activate")}
                            </Button>
                          )}
                          <Button
                            type="button"
                            onClick={() => requestDeleteLink(link)}
                            variant="danger"
                            size="sm"
                            isLoading={loadingStates[`delete_${link.id}`]}
                          >
                            {t("delete")}
                          </Button>
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
        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-[var(--app-z-toast)] max-w-[calc(100vw-2rem)] border border-border-strong bg-surface-raised px-4 py-3 text-text-heading md:bottom-5 md:right-5" role="status" aria-live="polite" aria-atomic="true">
          <p className="text-xs font-medium">
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
