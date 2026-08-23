"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import type { User as AuthUser } from "@/lib/auth";
import type { GuestQuota } from "@/lib/guest-limits/types";
import {
  canEditGuestLimitRequestDraft,
  canSubmitGuestLimitRequest,
  DEFAULT_GUEST_LIMIT_REQUEST_DRAFT,
  getGuestLimitRequestSectionState,
  getScopedGuestLimitRequestDraft,
  resetScopedGuestLimitRequestDraft,
  type GuestLimitRequestDraft,
} from "@/lib/guests/request-section-state";
import { canRequestGuestLimit } from "@/lib/users/policy";

type GuestLimitRequestTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface GuestLimitRequestControllerDependencies {
  createRequest: (params: {
    date: string;
    eventId?: string | null;
    requestedExtra: number;
    reason?: string | null;
  }) => Promise<{ error: string | null }>;
}

interface UseGuestLimitRequestControllerOptions {
  user: AuthUser | null;
  requestScopeKey: string;
  selectedDate: string;
  selectedEventId: string | null;
  quota: GuestQuota | null;
  hasCurrentScopeData: boolean;
  hasVerifiedCurrentQuota: boolean;
  isCurrentScopeFetching: boolean;
  currentScopeKeyRef: RefObject<string>;
  invalidatePolling: () => void;
  loadGuests: (options?: { silent?: boolean }) => Promise<boolean | undefined>;
  setError: (message: string | null) => void;
  translate: GuestLimitRequestTranslate;
  commonTranslate: GuestLimitRequestTranslate;
  dependencies: GuestLimitRequestControllerDependencies;
}

export default function useGuestLimitRequestController({
  user,
  requestScopeKey,
  selectedDate,
  selectedEventId,
  quota,
  hasCurrentScopeData,
  hasVerifiedCurrentQuota,
  isCurrentScopeFetching,
  currentScopeKeyRef,
  invalidatePolling,
  loadGuests,
  setError,
  translate: t,
  commonTranslate: commonT,
  dependencies,
}: UseGuestLimitRequestControllerOptions) {
  const [requestDrafts, setRequestDrafts] = useState<
    Record<string, GuestLimitRequestDraft>
  >({});
  const [requestingScopeKeys, setRequestingScopeKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const requestSummaryRefs = useRef(new Map<string, HTMLElement>());
  const pendingRequestStatusRefs = useRef(new Map<string, HTMLDivElement>());

  const isGuestLimitRequestEligible = Boolean(
    user &&
      canRequestGuestLimit({
        role: user.role,
        accountKind: user.account_kind,
        doorAccessEnabled: user.door_access_enabled,
      }),
  );
  const requestSectionState = getGuestLimitRequestSectionState({
    isEligible: isGuestLimitRequestEligible,
    hasCurrentScopeData,
    canRequestExtra: quota?.canRequestExtra === true,
    hasPendingRequest: Boolean(quota?.pendingRequest),
  });
  const isRequestDisclosureDisabled = !canEditGuestLimitRequestDraft(
    requestSectionState,
  );
  const isRequestSubmissionDisabled = !canSubmitGuestLimitRequest({
    sectionState: requestSectionState,
    hasVerifiedQuota: hasVerifiedCurrentQuota,
    isScopeFetching: isCurrentScopeFetching,
  });
  const requestSectionMeta =
    requestSectionState === "loading" || isCurrentScopeFetching
      ? commonT("loading")
      : !hasVerifiedCurrentQuota
        ? t("requestUnavailable")
        : requestSectionState === "unavailable"
          ? quota?.baseLimit === null
            ? t("requestNotNeeded")
            : t("requestUnavailable")
          : undefined;
  const requestDraft = getScopedGuestLimitRequestDraft(
    requestDrafts,
    requestScopeKey,
  );
  const isRequestingExtra = requestingScopeKeys.has(requestScopeKey);

  const setRequestSummaryElement = useCallback(
    (scopeKey: string, element: HTMLElement | null) => {
      if (element) {
        requestSummaryRefs.current.set(scopeKey, element);
      } else {
        requestSummaryRefs.current.delete(scopeKey);
      }
    },
    [],
  );
  const setPendingRequestStatusElement = useCallback(
    (scopeKey: string, element: HTMLDivElement | null) => {
      if (element) {
        pendingRequestStatusRefs.current.set(scopeKey, element);
      } else {
        pendingRequestStatusRefs.current.delete(scopeKey);
      }
    },
    [],
  );

  const updateRequestDraft = useCallback(
    (patch: Partial<GuestLimitRequestDraft>) => {
      setRequestDrafts((current) => ({
        ...current,
        [requestScopeKey]: {
          ...(current[requestScopeKey] ?? DEFAULT_GUEST_LIMIT_REQUEST_DRAFT),
          ...patch,
        },
      }));
    },
    [requestScopeKey],
  );

  const handleExtraRequest = useCallback(async () => {
    if (isRequestingExtra || isRequestSubmissionDisabled) return;

    const operationScopeKey = requestScopeKey;
    const requestSummaryRef = requestSummaryRefs.current.get(operationScopeKey);
    const shouldRestoreRequestFocus = Boolean(
      requestSummaryRef?.parentElement?.contains(document.activeElement),
    );
    invalidatePolling();
    const extra = Number.parseInt(requestDraft.requestedExtra, 10);
    setRequestingScopeKeys((current) => {
      const next = new Set(current);
      next.add(operationScopeKey);
      return next;
    });
    setError(null);
    try {
      const { error: requestError } = await dependencies.createRequest({
        date: selectedDate,
        eventId: selectedEventId,
        requestedExtra: extra,
        reason: requestDraft.requestReason,
      });
      if (!requestError) {
        setRequestDrafts((current) =>
          resetScopedGuestLimitRequestDraft(current, operationScopeKey),
        );
      }
      if (currentScopeKeyRef.current !== operationScopeKey) return;
      if (requestError) {
        setError(
          requestError === "PENDING_REQUEST_EXISTS"
            ? t("requestAlreadyPending")
            : t("requestFailed"),
        );
      } else {
        await loadGuests({ silent: true });
      }
    } catch (requestError) {
      if (currentScopeKeyRef.current === operationScopeKey) {
        console.error("Failed to request additional guests:", requestError);
        setError(t("requestFailed"));
      }
    } finally {
      setRequestingScopeKeys((current) => {
        const next = new Set(current);
        next.delete(operationScopeKey);
        return next;
      });
      if (shouldRestoreRequestFocus) {
        requestAnimationFrame(() => {
          if (currentScopeKeyRef.current !== operationScopeKey) return;
          if (
            document.activeElement &&
            document.activeElement !== document.body
          ) {
            return;
          }
          (
            pendingRequestStatusRefs.current.get(operationScopeKey) ??
            requestSummaryRefs.current.get(operationScopeKey)
          )?.focus();
        });
      }
    }
  }, [
    currentScopeKeyRef,
    dependencies,
    invalidatePolling,
    isRequestingExtra,
    isRequestSubmissionDisabled,
    loadGuests,
    requestDraft,
    requestScopeKey,
    selectedDate,
    selectedEventId,
    setError,
    t,
  ]);

  return {
    isRequestDisclosureDisabled,
    isRequestSubmissionDisabled,
    isRequestingExtra,
    isCurrentScopeFetching,
    requestDraft,
    requestSectionMeta,
    requestSectionState,
    handleExtraRequest,
    setPendingRequestStatusElement,
    setRequestSummaryElement,
    updateRequestDraft,
  };
}
