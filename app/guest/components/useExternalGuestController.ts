"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestRequestGuard } from "@/lib/hooks";
import { useRouteLoadingTask } from "@/components/RouteTransitionProvider";
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
  const retryHeadingRef = useRef<HTMLHeadingElement>(null);
  const reconciliationHeadingRef = useRef<HTMLHeadingElement>(null);
  const contentHeadingRef = useRef<HTMLHeadingElement>(null);
  const validationGuard = useLatestRequestGuard();
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

  const loadExternalData = useCallback(async (showInitialLoading = false) => {
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
      if (!isLatestRequest()) return;
      if (validationError) {
        console.error("Invalid external guest link:", validationError);
        if (getExternalLinkValidationDisposition(validationError) === "invalid") {
          setHasValidationError(true);
          setLinkInfo(null);
          setVenueInfo(null);
          setGuests([]);
        } else {
          setHasValidationError(false);
          setError("refreshFailed");
        }
        return false;
      } else if (data) {
        setHasValidationError(false);
        setRequiresReconciliation(false);
        setError(null);
        setLinkInfo(data.link);
        setVenueInfo(data.venue);
        setGuests(data.guests ?? []);
        if (data.link.kind === "self_rsvp") {
          setGuestName(data.guests?.[0]?.name ?? "");
        }
        return true;
      }
      setError("refreshFailed");
      return false;
    } catch (validationError) {
      if (!isLatestRequest()) return;
      console.error("Invalid external guest link:", validationError);
      setHasValidationError(false);
      setError("refreshFailed");
      return false;
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
    if (isReconciling || (!showRetryPanel && !showReconciliationBanner)) return;
    const frame = window.requestAnimationFrame(() => {
      if (showRetryPanel) {
        retryHeadingRef.current?.focus();
      } else {
        reconciliationHeadingRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isReconciling, showReconciliationBanner, showRetryPanel]);

  const handleReconciliationRetry = async () => {
    if (isReconciling) return;
    setIsReconciling(true);
    try {
      const refreshed = await loadExternalData(false);
      if (refreshed === false) {
        setRequiresReconciliation(true);
      } else if (refreshed === true) {
        window.requestAnimationFrame(() => contentHeadingRef.current?.focus());
      }
    } finally {
      setIsReconciling(false);
    }
  };

  const handleInitialRetry = async () => {
    const refreshed = await loadExternalData(true);
    if (refreshed === true) {
      window.requestAnimationFrame(() => contentHeadingRef.current?.focus());
    }
  };

  const handleSave = async () => {
    if (
      !guestName.trim() ||
      !linkInfo ||
      (linkInfo.kind === "self_rsvp" && !ownerKey) ||
      isSelfRsvpLocked ||
      requiresReconciliation ||
      isLoading ||
      isBulkSubmitting ||
      deletingId !== null
    ) return;
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
          setGuestName(data.name);
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
        const refreshed = await loadExternalData(false);
        if (refreshed === false) {
          setRequiresReconciliation(true);
        } else if (refreshed === true && actionFeedback) {
          setError(actionFeedback);
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDelete = async (guestId: string) => {
    if (requiresReconciliation || isReconciling) return;
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
        if (refreshed === false) {
          setRequiresReconciliation(true);
        } else if (refreshed === true && actionFeedback) {
          setError(actionFeedback);
        }
      } finally {
        setDeletingId(null);
      }
    }
  };

  const handleBulkSave = async (bulkGuests: BulkGuestCreateInput[]) => {
    if (!linkInfo || linkInfo.kind === "self_rsvp") {
      return { data: null, error: "SELF_RSVP_BULK_UNSUPPORTED" };
    }
    setError(null);

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

    return response;
  };

  const handleBulkSubmissionComplete = async () => {
    const refreshed = await loadExternalData(false);
    if (!refreshed) {
      setRequiresReconciliation(true);
      throw new Error("External guest list refresh failed");
    }
  };

  const handleBulkSubmittingChange = (isSubmitting: boolean) => {
    setIsBulkSubmitting(isSubmitting);
  };

  return {
    contentHeadingRef,
    deletingId,
    error,
    guests,
    guestName,
    handleBulkSubmissionComplete,
    handleBulkSubmittingChange,
    handleBulkSave,
    handleDelete,
    handleInitialRetry,
    handleReconciliationRetry,
    handleSave,
    hasValidationError,
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
    setGuestName,
    showReconciliationBanner,
    showRetryPanel,
    venueInfo,
  };
}
