"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestRequestGuard } from "@/lib/hooks";
import {
  useRouteLoadingTask,
  useRouteTransition,
} from "@/components/RouteTransitionProvider";
import { getExternalLinkValidationDisposition } from "@/lib/external-links/domain";
import {
  createExternalOwnerKey,
  externalOwnerStorageKey,
} from "@/lib/external-links/ownership";
import type { BulkGuestCreateInput } from "@/lib/guests/types";
import type {
  ExternalDJLink,
  ExternalLinkPublicGuest,
  ExternalLinkPublicGuestCreateResult,
  ExternalLinkPublicValidationData,
} from "@/lib/external-links/types";
import type { Venue } from "@/lib/venues/types";

export type ExternalGuestFeedbackKey =
  | "refreshFailed"
  | "registerResultUnknown"
  | "duplicateRequiresConfirmation"
  | "rateLimited"
  | "rsvpFull"
  | "linkFull"
  | "deleteFailed"
  | "deleteResultUnknown";

export interface ExternalGuestNotice {
  key: "guestAdded" | "rsvpRegistered" | "rsvpUpdated";
  name: string;
}

const LINK_LIMIT_REACHED_ERROR = "Guest limit reached for this link.";

export interface ExternalGuestControllerDependencies {
  validateExternalToken: (
    token: string,
    ownerKey?: string | null,
  ) => Promise<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>;
  createGuestViaExternalLink: (params: {
    token: string;
    guestName: string;
    date: string;
    ownerKey?: string | null;
  }) => Promise<{ data: ExternalLinkPublicGuest | null; error: string | null }>;
  createGuestsViaExternalLink: (params: {
    token: string;
    date: string;
    items: BulkGuestCreateInput[];
  }) => Promise<{
    data: ExternalLinkPublicGuestCreateResult | null;
    error: string | null;
  }>;
  deleteGuestViaExternalLink: (params: {
    token: string;
    guestId: string;
    ownerKey?: string | null;
  }) => Promise<{ error: string | null }>;
  updateGuestViaExternalLink: (params: {
    token: string;
    ownerKey: string;
    guestId: string;
    guestName: string;
  }) => Promise<{ data: ExternalLinkPublicGuest | null; error: string | null }>;
}

interface UseExternalGuestControllerOptions {
  token: string;
  dependencies: ExternalGuestControllerDependencies;
}

type ExternalLoadResult = "applied" | "failed" | "stale";
interface ExternalOperationLease {
  identity: symbol;
  guestNameRevision: number;
}

export default function useExternalGuestController({
  token,
  dependencies,
}: UseExternalGuestControllerOptions) {
  const [linkInfo, setLinkInfo] = useState<ExternalDJLink | null>(null);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [isOwnerKeyReady, setIsOwnerKeyReady] = useState(false);
  const [venueInfo, setVenueInfo] = useState<Venue | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [hasValidationError, setHasValidationError] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<ExternalGuestFeedbackKey | null>(null);
  const [notice, setNotice] = useState<ExternalGuestNotice | null>(null);
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [guests, setGuests] = useState<ExternalLinkPublicGuest[]>([]);
  const activeOperationRef = useRef<ExternalOperationLease | null>(null);
  const guestNameRevisionRef = useRef(0);
  const externalViewRootRef = useRef<HTMLDivElement>(null);
  const invalidHeadingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusInvalidHeadingRef = useRef(false);
  const retryHeadingRef = useRef<HTMLHeadingElement>(null);
  const reconciliationHeadingRef = useRef<HTMLHeadingElement>(null);
  const contentHeadingRef = useRef<HTMLHeadingElement>(null);
  const guestNameInputRef = useRef<HTMLInputElement>(null);
  const validationGuard = useLatestRequestGuard();
  const { requestFocusRestore } = useRouteTransition();
  const showRetryPanel =
    !isValidating &&
    !hasValidationError &&
    (!linkInfo || !venueInfo);
  const showReconciliationBanner =
    !isValidating &&
    !hasValidationError &&
    requiresReconciliation &&
    Boolean(linkInfo && venueInfo);
  const isSelfRsvp = linkInfo?.kind === "self_rsvp";
  const ownedGuest = isSelfRsvp ? guests[0] ?? null : null;
  const isSelfRsvpLocked = Boolean(
    ownedGuest && ownedGuest.status !== "pending",
  );

  useRouteLoadingTask(isValidating || !isOwnerKeyReady);

  const acquireOperation = () => {
    if (activeOperationRef.current) return null;
    const lease: ExternalOperationLease = {
      identity: Symbol("external-guest-operation"),
      guestNameRevision: guestNameRevisionRef.current,
    };
    activeOperationRef.current = lease;
    return lease;
  };

  const releaseOperation = (lease: ExternalOperationLease) => {
    if (activeOperationRef.current !== lease) return false;
    activeOperationRef.current = null;
    return true;
  };

  const handleGuestNameChange = (value: string) => {
    guestNameRevisionRef.current += 1;
    setGuestName(value);
    // 중복 확인은 확인한 이름에만 적용되므로 이름이 바뀌면 해제합니다.
    setError((current) =>
      current === "duplicateRequiresConfirmation" ? null : current,
    );
  };

  useEffect(() => {
    try {
      const storageKey = externalOwnerStorageKey(token);
      const stored = window.localStorage.getItem(storageKey);
      const key = stored ?? createExternalOwnerKey();
      if (!stored) window.localStorage.setItem(storageKey, key);
      setOwnerKey(key);
    } catch {
      setOwnerKey(null);
    } finally {
      setIsOwnerKeyReady(true);
    }
  }, [token]);

  const loadExternalData = useCallback(async (
    showInitialLoading = false,
    guestNameRevisionBaseline = guestNameRevisionRef.current,
  ): Promise<ExternalLoadResult> => {
    const isLatestRequest = validationGuard.beginRequest();
    if (showInitialLoading) {
      setIsValidating(true);
      setHasValidationError(false);
      setError(null);
      setLinkInfo(null);
      setVenueInfo(null);
      setGuests([]);
    }
    try {
      const { data, error: validationError } =
        await dependencies.validateExternalToken(token, ownerKey);
      if (!isLatestRequest()) return "stale" as const;
      if (validationError) {
        console.error("Invalid external guest link:", validationError);
        if (getExternalLinkValidationDisposition(validationError) === "invalid") {
          const activeElement = document.activeElement;
          const focusIsInsideView = Boolean(
            activeElement &&
              externalViewRootRef.current?.contains(activeElement),
          );
          const focusIsOutsideView = Boolean(
            activeElement &&
              activeElement !== document.body &&
              activeElement.isConnected &&
              !focusIsInsideView,
          );
          shouldFocusInvalidHeadingRef.current =
            focusIsInsideView ||
            (showInitialLoading && !focusIsOutsideView);
          setHasValidationError(true);
          setLinkInfo(null);
          setVenueInfo(null);
          setGuests([]);
        } else {
          setHasValidationError(false);
          setError("refreshFailed");
        }
        return "failed" as const;
      } else if (data) {
        shouldFocusInvalidHeadingRef.current = false;
        setHasValidationError(false);
        setRequiresReconciliation(false);
        setError(null);
        setLinkInfo(data.link);
        setVenueInfo(data.venue);
        setGuests(data.guests ?? []);
        if (
          data.link.kind === "self_rsvp" &&
          guestNameRevisionRef.current === guestNameRevisionBaseline
        ) {
          setGuestName(data.guests?.[0]?.name ?? "");
        }
        return "applied" as const;
      }
      setError("refreshFailed");
      return "failed" as const;
    } catch (validationError) {
      if (!isLatestRequest()) return "stale" as const;
      console.error("Invalid external guest link:", validationError);
      setHasValidationError(false);
      setError("refreshFailed");
      return "failed" as const;
    } finally {
      if (showInitialLoading && isLatestRequest()) setIsValidating(false);
    }
  }, [dependencies, ownerKey, token, validationGuard]);

  useEffect(() => {
    if (isOwnerKeyReady) void loadExternalData(true);
    // Translation changes are unrelated to an already-validated token. Do not
    // restart token validation or route loading when the locale changes.
  }, [isOwnerKeyReady, loadExternalData]);

  useEffect(() => {
    if (isReconciling) return;
    if (hasValidationError && shouldFocusInvalidHeadingRef.current) {
      shouldFocusInvalidHeadingRef.current = false;
      return requestFocusRestore(invalidHeadingRef);
    }
    if (!showRetryPanel && !showReconciliationBanner) return;
    return requestFocusRestore(
      showRetryPanel ? retryHeadingRef : reconciliationHeadingRef,
    );
  }, [
    hasValidationError,
    isReconciling,
    requestFocusRestore,
    showReconciliationBanner,
    showRetryPanel,
  ]);

  const handleReconciliationRetry = async () => {
    const lease = acquireOperation();
    if (!lease) return;
    setIsReconciling(true);
    try {
      const refreshed = await loadExternalData(false);
      if (refreshed !== "applied") {
        setRequiresReconciliation(true);
      } else {
        requestFocusRestore(contentHeadingRef);
      }
    } finally {
      if (releaseOperation(lease)) setIsReconciling(false);
    }
  };

  const handleInitialRetry = async () => {
    const lease = acquireOperation();
    if (!lease) return;
    try {
      const refreshed = await loadExternalData(true);
      if (refreshed === "applied") {
        requestFocusRestore(contentHeadingRef);
      }
    } finally {
      releaseOperation(lease);
    }
  };

  const createWithDuplicateOverride = async (
    name: string,
    date: string,
  ): Promise<{ data: ExternalLinkPublicGuest | null; error: string | null }> => {
    const response = await dependencies.createGuestsViaExternalLink({
      token,
      date,
      items: [{ name, allowDuplicate: true }],
    });
    if (response.error || !response.data) {
      return { data: null, error: response.error ?? "UNKNOWN_ERROR" };
    }
    const [result] = response.data.items;
    if (result?.status === "created" && result.guest) {
      return { data: result.guest, error: null };
    }
    if (result?.status === "limit_reached") {
      return { data: null, error: LINK_LIMIT_REACHED_ERROR };
    }
    return { data: null, error: "UNKNOWN_ERROR" };
  };

  const submitGuest = async (allowDuplicate: boolean) => {
    if (
      !guestName.trim() ||
      !linkInfo ||
      (linkInfo.kind === "self_rsvp" && !ownerKey) ||
      (allowDuplicate && linkInfo.kind === "self_rsvp") ||
      isSelfRsvpLocked ||
      requiresReconciliation ||
      activeOperationRef.current
    ) return;
    const lease = acquireOperation();
    if (!lease) return;
    setIsLoading(true);
    setError(null);
    setNotice(null);
    let actionFeedback: ExternalGuestFeedbackKey | null = null;
    let successNotice: ExternalGuestNotice | null = null;
    const submittedName = guestName.trim().toUpperCase();

    try {
      const { data, error: createError } = ownedGuest
        ? await dependencies.updateGuestViaExternalLink({
            token,
            ownerKey: ownerKey ?? "",
            guestId: ownedGuest.id,
            guestName: submittedName,
          })
        : allowDuplicate
          ? await createWithDuplicateOverride(submittedName, linkInfo.date || "")
          : await dependencies.createGuestViaExternalLink({
              token,
              ownerKey,
              guestName: submittedName,
              date: linkInfo.date || "",
            });

      if (createError) {
        console.error("Failed to register guest:", createError);
        actionFeedback =
          createError === "RATE_LIMITED"
            ? "rateLimited"
            : createError === LINK_LIMIT_REACHED_ERROR
              ? isSelfRsvp
                ? "rsvpFull"
                : "linkFull"
            : createError === "DUPLICATE_REQUIRES_CONFIRMATION"
              ? "duplicateRequiresConfirmation"
              : "registerResultUnknown";
      } else if (data) {
        if (isSelfRsvp) {
          setGuests([data]);
          if (guestNameRevisionRef.current === lease.guestNameRevision) {
            setGuestName(data.name);
          }
          successNotice = {
            key: ownedGuest ? "rsvpUpdated" : "rsvpRegistered",
            name: data.name,
          };
        } else {
          setGuests((prev) => [...prev, data]);
          setGuestName("");
          setLinkInfo((prev) =>
            prev ? { ...prev, usedGuests: prev.usedGuests + 1 } : prev,
          );
          successNotice = { key: "guestAdded", name: data.name };
        }
      } else {
        actionFeedback = "registerResultUnknown";
      }
    } catch (createError) {
      console.error("Failed to register guest:", createError);
      actionFeedback = "registerResultUnknown";
    } finally {
      let shouldRestoreFocus = false;
      try {
        const refreshed = await loadExternalData(
          false,
          lease.guestNameRevision,
        );
        if (refreshed !== "applied") {
          setRequiresReconciliation(true);
        } else {
          shouldRestoreFocus = true;
          if (actionFeedback) setError(actionFeedback);
          if (successNotice) setNotice(successNotice);
        }
      } finally {
        if (releaseOperation(lease)) {
          setIsLoading(false);
          // 저장 버튼이 잠시 비활성화되어 focus를 잃으므로 다음 입력을 위해 되돌립니다.
          if (shouldRestoreFocus) {
            window.requestAnimationFrame(() => guestNameInputRef.current?.focus());
          }
        }
      }
    }
  };

  const handleSave = () => submitGuest(false);

  const handleConfirmDuplicate = () => submitGuest(true);

  const handleDelete = async (guestId: string) => {
    if (requiresReconciliation || activeOperationRef.current) return;
    const lease = acquireOperation();
    if (!lease) return;
    setDeletingId(guestId);
    setError(null);
    setNotice(null);
    let actionFeedback: ExternalGuestFeedbackKey | null = null;

    try {
      const { error: deleteError } = await dependencies.deleteGuestViaExternalLink({
        token,
        guestId,
        ownerKey,
      });

      if (deleteError) {
        console.error("Failed to delete guest:", deleteError);
        actionFeedback = "deleteFailed";
      } else {
        setGuests((prev) => prev.filter((g) => g.id !== guestId));
        setLinkInfo((prev) =>
          prev ? { ...prev, usedGuests: Math.max(0, prev.usedGuests - 1) } : prev,
        );
      }
    } catch (deleteError) {
      console.error("Failed to delete guest:", deleteError);
      actionFeedback = "deleteResultUnknown";
    } finally {
      try {
        const refreshed = await loadExternalData(false);
        if (refreshed !== "applied") {
          setRequiresReconciliation(true);
        } else if (actionFeedback) {
          setError(actionFeedback);
        }
      } finally {
        if (releaseOperation(lease)) setDeletingId(null);
      }
    }
  };

  const handleBulkSave = async (bulkGuests: BulkGuestCreateInput[]) => {
    if (
      !linkInfo ||
      linkInfo.kind === "self_rsvp" ||
      requiresReconciliation ||
      activeOperationRef.current
    ) {
      return { data: null, error: "SELF_RSVP_BULK_UNSUPPORTED" };
    }
    const lease = acquireOperation();
    if (!lease) return { data: null, error: "SELF_RSVP_BULK_UNSUPPORTED" };
    setIsBulkSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await dependencies.createGuestsViaExternalLink({
        token,
        date: linkInfo.date || "",
        items: bulkGuests,
      });

      if (response.data) {
        const createdGuests = response.data.items.flatMap((item) =>
          item.status === "created" && item.guest ? [item.guest] : [],
        );
        if (createdGuests.length > 0) {
          setGuests((current) => [...current, ...createdGuests]);
          setLinkInfo((current) =>
            current
              ? { ...current, usedGuests: current.usedGuests + createdGuests.length }
              : current,
          );
        }
      }

      const refreshed = await loadExternalData(false);
      if (refreshed !== "applied") setRequiresReconciliation(true);
      return response;
    } catch (error) {
      const refreshed = await loadExternalData(false);
      if (refreshed !== "applied") setRequiresReconciliation(true);
      throw error;
    } finally {
      if (releaseOperation(lease)) setIsBulkSubmitting(false);
    }
  };

  return {
    contentHeadingRef,
    deletingId,
    error,
    externalViewRootRef,
    guests,
    guestName,
    guestNameInputRef,
    handleBulkSave,
    handleConfirmDuplicate,
    handleDelete,
    handleInitialRetry,
    handleReconciliationRetry,
    handleSave,
    hasValidationError,
    invalidHeadingRef,
    isBulkSubmitting,
    isLoading,
    isOwnerKeyReady,
    isReconciling,
    isSelfRsvp,
    isSelfRsvpLocked,
    isValidating,
    linkInfo,
    notice,
    ownedGuest,
    ownerKey,
    reconciliationHeadingRef,
    requiresReconciliation,
    retryHeadingRef,
    handleGuestNameChange,
    showReconciliationBanner,
    showRetryPanel,
    venueInfo,
  };
}
