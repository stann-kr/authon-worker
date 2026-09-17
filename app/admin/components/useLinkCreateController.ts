"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useTranslations } from "next-intl";
import type { ExternalDjSuggestion } from "@/lib/contributors/types";
import {
  prepareExternalLinkCreateInput,
  toExternalLinkShareData,
  type ExternalLinkShareAdapter,
  type ExternalLinkShareData,
  type ExternalLinkShareResult,
  type ExternalLinkCreateDraft,
} from "@/lib/external-links/domain";
import type {
  ExternalDJLink,
  ExternalEventSuggestion,
  ExternalLinkCreateSuggestions,
} from "@/lib/external-links/types";
import { useLatestRequestGuard, useScopedOperationGuard } from "@/lib/hooks";

export interface LinkCreateFormData {
  date: string;
  dj: string;
  contributorId: string | null;
  event: string;
  maxGuests: number | "";
  localeMode: ExternalDJLink["localeMode"];
  kind: ExternalDJLink["kind"];
}

export type LinkCreateFormField =
  | "date"
  | "dj"
  | "event"
  | "maxGuests"
  | "localeMode"
  | "kind";

export interface LinkCreateFormValidationError {
  field: LinkCreateFormField;
  message: string;
}

export interface LinkCreateControllerActions {
  fetchSuggestions: (venueId: string) => Promise<{
    data: ExternalLinkCreateSuggestions | null;
    error: string | null;
  }>;
  createLink: (
    link: ExternalLinkCreateDraft & {
      venueId: string;
      eventId: string | null;
    },
  ) => Promise<{ data: ExternalDJLink | null; error: string | null }>;
  shareLink: (
    data: ExternalLinkShareData,
    adapter: ExternalLinkShareAdapter,
  ) => Promise<ExternalLinkShareResult>;
}

interface UseLinkCreateControllerOptions {
  selectedDate: string;
  onDateChange: (date: string) => void;
  venueId: string;
  eventId: string | null;
  isActive: boolean;
  actions: LinkCreateControllerActions;
}

const EMPTY_FORM_DATA = (date: string): LinkCreateFormData => ({
  date,
  dj: "",
  contributorId: null,
  event: "",
  maxGuests: 5,
  localeMode: "auto",
  kind: "contributor",
});

export function useLinkCreateController({
  selectedDate,
  onDateChange,
  venueId,
  eventId,
  isActive,
  actions,
}: UseLinkCreateControllerOptions) {
  const t = useTranslations("LinkAdmin");
  const [formData, setFormData] = useState<LinkCreateFormData>(() =>
    EMPTY_FORM_DATA(selectedDate),
  );
  const [generatedLink, setGeneratedLink] = useState<ExternalDJLink | null>(
    null,
  );
  const [generatedLinkScopeKey, setGeneratedLinkScopeKey] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratedLinkActionPending, setIsGeneratedLinkActionPending] =
    useState(false);
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const [djSuggestions, setDjSuggestions] = useState<ExternalDjSuggestion[]>([]);
  const [eventSuggestions, setEventSuggestions] = useState<ExternalEventSuggestion[]>([]);
  const [suggestionsVenueId, setSuggestionsVenueId] = useState("");
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createErrorScopeKey, setCreateErrorScopeKey] = useState("");
  const [linkActionToast, setLinkActionToast] = useState<string | null>(null);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [formValidationError, setFormValidationError] =
    useState<LinkCreateFormValidationError | null>(null);
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
  const suggestionsRequestGuard = useLatestRequestGuard();
  const createOperationGuard = useScopedOperationGuard();
  const shareOperationGuard = useScopedOperationGuard();
  const credentialScopeKey = `${venueId}:create:${formData.date}:${eventId ?? "general"}`;
  const currentCredentialScopeKeyRef = useRef(credentialScopeKey);
  const currentVenueIdRef = useRef(venueId);
  const isActiveRef = useRef(isActive);
  const actionsRef = useRef(actions);
  const tRef = useRef(t);
  currentCredentialScopeKeyRef.current = credentialScopeKey;
  currentVenueIdRef.current = venueId;
  isActiveRef.current = isActive;
  actionsRef.current = actions;
  tRef.current = t;

  const scopedGeneratedLink =
    generatedLinkScopeKey === credentialScopeKey ? generatedLink : null;
  const scopedCreateError =
    createErrorScopeKey === credentialScopeKey ? createError : null;
  const currentDjSuggestions =
    suggestionsVenueId === venueId ? djSuggestions : [];
  const currentEventSuggestions =
    suggestionsVenueId === venueId ? eventSuggestions : [];

  useEffect(() => {
    setNativeShareAvailable(typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    setFormData((current) => ({ ...current, date: selectedDate }));
    setFormValidationError((current) =>
      current?.field === "date" ? null : current,
    );
  }, [selectedDate]);

  useEffect(() => {
    suggestionsRequestGuard.invalidateRequests();
    setDjSuggestions([]);
    setEventSuggestions([]);
    setSuggestionsVenueId("");
    setSuggestionsError(null);
    setIsSuggestionsLoading(false);
    setFormData((current) => ({ ...current, contributorId: null }));
  }, [suggestionsRequestGuard, venueId]);

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
    setCreateError(null);
    setCreateErrorScopeKey("");
    setFormValidationError(null);
  }, [createOperationGuard, credentialScopeKey, shareOperationGuard]);

  useEffect(() => {
    if (isActive) return;
    suggestionsRequestGuard.invalidateRequests();
    createOperationGuard.invalidateOperations();
    shareOperationGuard.invalidateOperations();
    activeCreateOperationIdRef.current = null;
    linkActionToastOwnerRef.current = null;
    setIsSuggestionsLoading(false);
    setIsGenerating(false);
    setIsGeneratedLinkActionPending(false);
  }, [
    createOperationGuard,
    suggestionsRequestGuard,
    isActive,
    shareOperationGuard,
  ]);

  const loadSuggestions = useCallback(async () => {
    const requestedVenueId = venueId;
    const isLatestRequest = suggestionsRequestGuard.beginRequest();
    if (!requestedVenueId) {
      setDjSuggestions([]);
      setEventSuggestions([]);
      setSuggestionsVenueId("");
      setSuggestionsError(null);
      setIsSuggestionsLoading(false);
      return;
    }

    setIsSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      const { data, error } = await actionsRef.current.fetchSuggestions(requestedVenueId);
      if (
        !isLatestRequest() ||
        !isActiveRef.current ||
        currentVenueIdRef.current !== requestedVenueId
      ) {
        return;
      }
      setDjSuggestions(data?.djs ?? []);
      setEventSuggestions(data?.events ?? []);
      setSuggestionsVenueId(requestedVenueId);
      setSuggestionsError(
        error ? tRef.current("createSuggestionsUnavailable") : null,
      );
    } catch (directoryError) {
      if (
        !isLatestRequest() ||
        !isActiveRef.current ||
        currentVenueIdRef.current !== requestedVenueId
      ) {
        return;
      }
      console.error("Failed to load external link suggestions:", directoryError);
      setDjSuggestions([]);
      setEventSuggestions([]);
      setSuggestionsVenueId(requestedVenueId);
      setSuggestionsError(tRef.current("createSuggestionsUnavailable"));
    } finally {
      if (
        isLatestRequest() &&
        isActiveRef.current &&
        currentVenueIdRef.current === requestedVenueId
      ) {
        setIsSuggestionsLoading(false);
      }
    }
  }, [suggestionsRequestGuard, venueId]);

  useEffect(() => {
    if (isActive) void loadSuggestions();
  }, [isActive, loadSuggestions]);

  useEffect(() => {
    if (!isActive || !shouldFocusTemplateDateRef.current) return;
    shouldFocusTemplateDateRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      linkDateInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isActive, templateNotice]);

  useEffect(() => {
    if (!isActive || !scopedGeneratedLink || !shouldFocusGeneratedLinkRef.current) {
      return;
    }
    shouldFocusGeneratedLinkRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      generatedLinkPanelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isActive, scopedGeneratedLink]);

  const clearFormFieldError = useCallback((field: LinkCreateFormField) => {
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

  const handleDateChange = (date: string) => {
    clearFormFieldError("date");
    onDateChange(date);
  };

  const focusFormField = (field: LinkCreateFormField) => {
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
    const validationError: LinkCreateFormValidationError | null = (() => {
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

    setCreateError(null);
    setCreateErrorScopeKey("");
    setFormValidationError(validationError);
    focusFormField(validationError.field);
    return true;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isActive || !venueId || activeCreateOperationIdRef.current !== null) {
      return;
    }

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
        setCreateError(t("invalidCreateInput"));
        setCreateErrorScopeKey(credentialScopeKey);
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
    setCreateError(null);
    setFormValidationError(null);

    try {
      const { data, error } = await actions.createLink({
        venueId: operationVenueId,
        eventId,
        ...prepared.draft,
      });

      if (
        !isActiveRef.current ||
        !operation.isCurrent(currentCredentialScopeKeyRef.current)
      ) {
        return;
      }
      if (error) {
        console.error("Failed to create link:", error);
        if (!applyFormValidationError(error)) {
          setCreateError(t("createFailed"));
          setCreateErrorScopeKey(operation.scopeKey);
        }
      } else if (data) {
        shouldFocusGeneratedLinkRef.current = true;
        setGeneratedLink(data);
        setGeneratedLinkScopeKey(operation.scopeKey);
        setTemplateNotice(null);
        setFormData(EMPTY_FORM_DATA(operationDate));
        void loadSuggestions();
      }
    } catch (createError) {
      if (
        !isActiveRef.current ||
        !operation.isCurrent(currentCredentialScopeKeyRef.current)
      ) {
        return;
      }
      console.error("Failed to create link:", createError);
      setCreateError(t("createFailed"));
      setCreateErrorScopeKey(operation.scopeKey);
    } finally {
      if (activeCreateOperationIdRef.current === operation.id) {
        activeCreateOperationIdRef.current = null;
        if (operation.finish(currentCredentialScopeKeyRef.current)) {
          setIsGenerating(false);
        }
      }
    }
  };

  const shareOrCopyGeneratedLink = async (url: string) => {
    if (!isActive) return;
    const operation = shareOperationGuard.beginOperation(
      credentialScopeKey,
      "share:generated",
    );
    setIsGeneratedLinkActionPending(true);
    setCreateError(null);

    const result = await actions.shareLink(toExternalLinkShareData(url), {
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

    if (
      !isActiveRef.current ||
      !operation.isCurrent(currentCredentialScopeKeyRef.current)
    ) {
      return;
    }
    if (result === "shared" || result === "copied") {
      linkActionToastOwnerRef.current = operation.id;
      setLinkActionToast(
        result === "shared" ? t("generatedLinkShared") : t("generatedLinkCopied"),
      );
      window.setTimeout(() => {
        if (linkActionToastOwnerRef.current === operation.id) {
          linkActionToastOwnerRef.current = null;
          setLinkActionToast(null);
        }
      }, 2200);
    } else if (result === "failed") {
      setCreateError(t("shareFailed"));
      setCreateErrorScopeKey(operation.scopeKey);
    }

    if (operation.finish(currentCredentialScopeKeyRef.current)) {
      setIsGeneratedLinkActionPending(false);
    }
  };

  const applyTemplate = useCallback(
    (draft: Readonly<ExternalLinkCreateDraft>) => {
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
      setCreateError(null);
      setCreateErrorScopeKey("");
      setFormValidationError(null);
      setTemplateNotice(t("templateReady", { djName: draft.djName }));
      shouldFocusTemplateDateRef.current = true;
    },
    [t],
  );

  return {
    formData,
    setFormData,
    handleDateChange,
    isGenerating,
    nativeShareAvailable,
    currentDjSuggestions,
    currentEventSuggestions,
    isSuggestionsLoading,
    suggestionsError,
    formValidationError,
    scopedCreateError,
    templateNotice,
    scopedGeneratedLink,
    isGeneratedLinkActionPending,
    linkActionToast,
    linkDateInputRef,
    linkDjInputRef,
    linkEventInputRef,
    linkMaxGuestsInputRef,
    linkLocaleInputRef,
    linkKindInputRef,
    generatedLinkPanelRef,
    clearFormFieldError,
    handleDjChange,
    handleSubmit,
    shareOrCopyGeneratedLink,
    applyTemplate,
  };
}
