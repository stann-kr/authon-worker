"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  invalidatePolling: () => void;
  loadGuests: (options?: { silent?: boolean }) => Promise<boolean | undefined>;
  setError: (message: string | null) => void;
  translate: GuestLimitRequestTranslate;
  commonTranslate: GuestLimitRequestTranslate;
  dependencies: GuestLimitRequestControllerDependencies;
}

interface RequestScopeOwner {
  scopeKey: string;
}

interface ActiveRequestOperation {
  scopeKey: string;
  owner: RequestScopeOwner;
  draftRevision: number;
  shouldRestoreFocus: boolean;
}

interface RequestFocusIntent {
  scopeKey: string;
  owner: RequestScopeOwner;
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
  const [focusIntent, setFocusIntent] = useState<RequestFocusIntent | null>(
    null,
  );
  const requestSummaryRefs = useRef(new Map<string, HTMLElement>());
  const pendingRequestStatusRefs = useRef(new Map<string, HTMLDivElement>());
  const draftRevisionsRef = useRef(new Map<string, number>());
  const activeOperationsRef = useRef(new Map<string, ActiveRequestOperation>());
  const committedScopeOwnersRef = useRef(new Map<string, RequestScopeOwner>());
  const scopeOwner = useMemo<RequestScopeOwner>(
    () => ({ scopeKey: requestScopeKey }),
    [requestScopeKey],
  );
  const committedScopeOwnerRef = useRef(scopeOwner);
  const translateRef = useRef(t);
  translateRef.current = t;

  useLayoutEffect(() => {
    committedScopeOwnerRef.current = scopeOwner;
    committedScopeOwnersRef.current.set(requestScopeKey, scopeOwner);
  }, [requestScopeKey, scopeOwner]);

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
  const isRequestDisclosureDisabled =
    !canEditGuestLimitRequestDraft(requestSectionState);
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
  const isRequestingExtra =
    requestingScopeKeys.has(requestScopeKey) ||
    activeOperationsRef.current.has(requestScopeKey);

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
      draftRevisionsRef.current.set(
        requestScopeKey,
        (draftRevisionsRef.current.get(requestScopeKey) ?? 0) + 1,
      );
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
    if (
      isRequestSubmissionDisabled ||
      activeOperationsRef.current.has(requestScopeKey)
    ) {
      return;
    }

    const requestSummaryRef = requestSummaryRefs.current.get(requestScopeKey);
    const operation: ActiveRequestOperation = {
      scopeKey: requestScopeKey,
      owner: scopeOwner,
      draftRevision: draftRevisionsRef.current.get(requestScopeKey) ?? 0,
      shouldRestoreFocus: Boolean(
        requestSummaryRef?.parentElement?.contains(document.activeElement),
      ),
    };
    activeOperationsRef.current.set(requestScopeKey, operation);
    invalidatePolling();
    const extra = Number.parseInt(requestDraft.requestedExtra, 10);
    setRequestingScopeKeys((current) => {
      const next = new Set(current);
      next.add(operation.scopeKey);
      return next;
    });
    setError(null);
    let hasPublishedPendingError = false;
    try {
      const { error: requestError } = await dependencies.createRequest({
        date: selectedDate,
        eventId: selectedEventId,
        requestedExtra: extra,
        reason: requestDraft.requestReason,
      });
      const isLatestScopeEpoch =
        committedScopeOwnersRef.current.get(operation.scopeKey) ===
        operation.owner;
      if (
        !requestError &&
        isLatestScopeEpoch &&
        draftRevisionsRef.current.get(operation.scopeKey) ===
          operation.draftRevision
      ) {
        setRequestDrafts((current) =>
          resetScopedGuestLimitRequestDraft(current, operation.scopeKey),
        );
      }
      if (
        !isLatestScopeEpoch ||
        committedScopeOwnerRef.current !== operation.owner
      ) {
        return;
      }
      if (requestError) {
        setError(
          requestError === "PENDING_REQUEST_EXISTS"
            ? translateRef.current("requestAlreadyPending")
            : translateRef.current("requestFailed"),
        );
        if (requestError === "PENDING_REQUEST_EXISTS") {
          hasPublishedPendingError = true;
          await loadGuests({ silent: true });
        }
      } else {
        await loadGuests({ silent: true });
      }
      if (
        committedScopeOwnersRef.current.get(operation.scopeKey) !==
          operation.owner ||
        committedScopeOwnerRef.current !== operation.owner
      ) {
        return;
      }
      if (operation.shouldRestoreFocus) {
        setFocusIntent({
          scopeKey: operation.scopeKey,
          owner: operation.owner,
        });
      }
    } catch (requestError) {
      const isCurrentScopeOperation =
        committedScopeOwnersRef.current.get(operation.scopeKey) ===
          operation.owner && committedScopeOwnerRef.current === operation.owner;
      if (isCurrentScopeOperation) {
        if (!hasPublishedPendingError) {
          console.error("Failed to request additional guests:", requestError);
          setError(translateRef.current("requestFailed"));
        }
        if (operation.shouldRestoreFocus) {
          setFocusIntent({
            scopeKey: operation.scopeKey,
            owner: operation.owner,
          });
        }
      }
    } finally {
      if (activeOperationsRef.current.get(operation.scopeKey) === operation) {
        activeOperationsRef.current.delete(operation.scopeKey);
      }
      setRequestingScopeKeys((current) => {
        const next = new Set(current);
        next.delete(operation.scopeKey);
        return next;
      });
    }
  }, [
    dependencies,
    invalidatePolling,
    isRequestSubmissionDisabled,
    loadGuests,
    requestDraft,
    requestScopeKey,
    selectedDate,
    selectedEventId,
    setError,
    scopeOwner,
  ]);

  useLayoutEffect(() => {
    if (!focusIntent) return;
    if (
      committedScopeOwnersRef.current.get(focusIntent.scopeKey) !==
        focusIntent.owner ||
      committedScopeOwnerRef.current !== focusIntent.owner
    ) {
      setFocusIntent((current) => (current === focusIntent ? null : current));
      return;
    }
    const requestSummaryRef = requestSummaryRefs.current.get(
      focusIntent.scopeKey,
    );
    const activeElement = document.activeElement;
    const canRestoreFocus =
      activeElement === document.body || activeElement === requestSummaryRef;

    if (canRestoreFocus) {
      (
        pendingRequestStatusRefs.current.get(focusIntent.scopeKey) ??
        requestSummaryRef
      )?.focus();
    }
    setFocusIntent(null);
  }, [focusIntent, requestSectionState, requestScopeKey]);

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
