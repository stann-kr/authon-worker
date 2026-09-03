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
  | "deleteFailed"
  | "deleteResultUnknown";

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

  const handleSave = async () => {
    if (
      !guestName.trim() ||
      !linkInfo ||
      (linkInfo.kind === "self_rsvp" && !ownerKey) ||
      isSelfRsvpLocked ||
      requiresReconciliation ||
      activeOperationRef.current
    ) return;
    const lease = acquireOperation();
    if (!lease) return;
    setIsLoading(true);
    setError(null);
    let actionFeedback: ExternalGuestFeedbackKey | null = null;

    try {
      const { data, error: createError } = ownedGuest
        ? await dependencies.updateGuestViaExternalLink({
            token,
            ownerKey: ownerKey ?? "",
            guestId: ownedGuest.id,
            guestName: guestName.trim().toUpperCase(),
          })
        : await dependencies.createGuestViaExternalLink({
            token,
            ownerKey,
            guestName: guestName.trim().toUpperCase(),
            date: linkInfo.date || "",
          });

      if (createError) {
        console.error("Failed to register guest:", createError);
        actionFeedback =
          createError === "RATE_LIMITED"
            ? "rateLimited"
            : createError === "Guest limit reached for this link."
              ? "rsvpFull"
            : createError === "DUPLICATE_REQUIRES_CONFIRMATION"
              ? "duplicateRequiresConfirmation"
              : "registerResultUnknown";
      } else if (data) {
        if (isSelfRsvp) {
          setGuests([data]);
          if (guestNameRevisionRef.current === lease.guestNameRevision) {
            setGuestName(data.name);
          }
        } else {
          setGuests((prev) => [...prev, data]);
          setGuestName("");
          setLinkInfo((prev) =>
            prev ? { ...prev, usedGuests: prev.usedGuests + 1 } : prev,
          );
        }
      } else {
        actionFeedback = "registerResultUnknown";
      }
    } catch (createError) {
      console.error("Failed to register guest:", createError);
      actionFeedback = "registerResultUnknown";
    } finally {
      try {
        const refreshed = await loadExternalData(
          false,
          lease.guestNameRevision,
        );
        if (refreshed !== "applied") {
          setRequiresReconciliation(true);
        } else if (actionFeedback) {
          setError(actionFeedback);
        }
      } finally {
        if (releaseOperation(lease)) setIsLoading(false);
      }
    }
  };

  const handleDelete = async (guestId: string) => {
    if (requiresReconciliation || activeOperationRef.current) return;
    const lease = acquireOperation();
    if (!lease) return;
    setDeletingId(guestId);
    setError(null);
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
    handleBulkSave,
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
