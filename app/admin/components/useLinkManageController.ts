"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useLatestRequestGuard, useScopedOperationGuard } from "@/lib/hooks";
import { deriveAsyncListState } from "@/lib/ui/async-list-state";
import {
  toExternalLinkShareData,
  type ExternalLinkShareAdapter,
  type ExternalLinkShareData,
  type ExternalLinkShareResult,
} from "@/lib/external-links/domain";
import type { ExternalDJLink } from "@/lib/external-links/types";
import {
  filterLinksByManageFilter,
  getDashboardStats,
  sortLinks,
  type ManageFilter,
  type ManageSort,
} from "./linkStatus";

const EMPTY_LINKS: ExternalDJLink[] = [];

export interface LinkManageControllerActions {
  fetchByDate: (
    venueId: string,
    date: string,
    eventId: string | null,
  ) => Promise<{ data: ExternalDJLink[] | null; error: string | null }>;
  fetchRecent: (
    venueId: string,
    limit: 5 | 10,
    eventId: string | null,
  ) => Promise<{ data: ExternalDJLink[] | null; error: string | null }>;
  deleteLink: (id: string) => Promise<{ error: string | null }>;
  deactivateLink: (id: string) => Promise<{ error: string | null }>;
  activateLink: (id: string) => Promise<{ error: string | null }>;
  shareLink: (
    data: ExternalLinkShareData,
    adapter: ExternalLinkShareAdapter,
  ) => Promise<ExternalLinkShareResult>;
}

interface Options {
  selectedDate: string;
  venueId: string;
  eventId: string | null;
  isActive: boolean;
  locale: "en" | "ko";
  actions: LinkManageControllerActions;
}

interface LinkActionFeedback {
  id: string;
  operationId: number;
  result: Extract<ExternalLinkShareResult, "shared" | "copied">;
}

interface LifecycleLease {
  scopeKey: string;
  owner: symbol;
}

export function useLinkManageController({
  selectedDate,
  venueId,
  eventId,
  isActive,
  locale,
  actions,
}: Options) {
  const t = useTranslations("LinkAdmin");
  const [manageScope, setManageScope] = useState<"date" | "recent">("recent");
  const [recentLimit, setRecentLimit] = useState<5 | 10>(5);
  const [manageFilter, setManageFilter] = useState<ManageFilter>("all");
  const [manageSort, setManageSort] = useState<ManageSort>("newest");
  const [now, setNow] = useState(() => Date.now());
  const [links, setLinks] = useState<ExternalDJLink[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const [linkActionFeedback, setLinkActionFeedback] =
    useState<LinkActionFeedback | null>(null);
  const [visibleLinkId, setVisibleLinkId] = useState<string | null>(null);
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [errorScopeKey, setErrorScopeKey] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [successScopeKey, setSuccessScopeKey] = useState("");
  const [linkActionToast, setLinkActionToast] = useState<string | null>(null);
  const [pendingDeleteLink, setPendingDeleteLink] =
    useState<ExternalDJLink | null>(null);
  const displayCacheRef = useRef<{ scopeKey: string; links: ExternalDJLink[] }>(
    { scopeKey: "", links: [] },
  );
  const toastOwnerRef = useRef<number | null>(null);
  const activeLifecycleLeasesRef = useRef<Map<string, LifecycleLease>>(
    new Map(),
  );
  const [lifecycleBusyIds, setLifecycleBusyIds] = useState<
    Record<string, boolean>
  >({});
  const requestGuard = useLatestRequestGuard();
  const mutationGuard = useScopedOperationGuard();
  const shareGuard = useScopedOperationGuard();
  const scopedEventId = manageScope === "date" ? eventId : null;
  const requestScopeKey = `${venueId}:${manageScope}:${manageScope === "recent" ? recentLimit : selectedDate}:${scopedEventId ?? "general"}`;
  const currentScopeRef = useRef(requestScopeKey);
  const isActiveRef = useRef(isActive);
  const actionsRef = useRef(actions);
  const tRef = useRef(t);
  currentScopeRef.current = requestScopeKey;
  isActiveRef.current = isActive;
  actionsRef.current = actions;
  tRef.current = t;

  useEffect(() => {
    requestGuard.invalidateRequests();
    mutationGuard.invalidateOperations();
    shareGuard.invalidateOperations();
    activeLifecycleLeasesRef.current.clear();
    toastOwnerRef.current = null;
    setLoadingStates({});
    setLifecycleBusyIds({});
    setPendingDeleteLink(null);
    setLinkActionFeedback(null);
    setLinkActionToast(null);
    setError(null);
    setErrorScopeKey("");
    setSuccess(null);
    setSuccessScopeKey("");
    setLoadOutcome("idle");
  }, [mutationGuard, requestGuard, requestScopeKey, shareGuard]);

  useEffect(() => {
    if (isActive) return;
    requestGuard.invalidateRequests();
    mutationGuard.invalidateOperations();
    shareGuard.invalidateOperations();
    activeLifecycleLeasesRef.current.clear();
    toastOwnerRef.current = null;
    setIsFetching(false);
    setLoadingStates({});
    setLifecycleBusyIds({});
    setPendingDeleteLink(null);
    setLinkActionFeedback(null);
    setLinkActionToast(null);
  }, [isActive, mutationGuard, requestGuard, shareGuard]);

  useEffect(() => {
    if (!isFetching && loadedScopeKey === requestScopeKey)
      displayCacheRef.current = { scopeKey: requestScopeKey, links };
  }, [isFetching, links, loadedScopeKey, requestScopeKey]);

  const loadLinks = useCallback(async () => {
    if (!isActiveRef.current || currentScopeRef.current !== requestScopeKey)
      return;
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
      const result =
        manageScope === "recent"
          ? await actionsRef.current.fetchRecent(venueId, recentLimit, scopedEventId)
          : await actionsRef.current.fetchByDate(
              venueId,
              selectedDate,
              scopedEventId,
            );
      if (
        !isLatestRequest() ||
        !isActiveRef.current ||
        currentScopeRef.current !== requestScopeKey
      )
        return;
      if (result.error) {
        setError(tRef.current("loadFailed"));
        setErrorScopeKey(requestScopeKey);
        setLoadOutcome(result.data ? "partial" : "error");
      } else setLoadOutcome("success");
      setLinks(result.data ?? []);
      setLoadedScopeKey(requestScopeKey);
    } catch (loadError) {
      if (
        !isLatestRequest() ||
        !isActiveRef.current ||
        currentScopeRef.current !== requestScopeKey
      )
        return;
      console.error("Failed to load links:", loadError);
      setLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setError(tRef.current("loadFailed"));
      setErrorScopeKey(requestScopeKey);
      setLoadOutcome("error");
    } finally {
      if (
        isLatestRequest() &&
        isActiveRef.current &&
        currentScopeRef.current === requestScopeKey
      )
        setIsFetching(false);
    }
  }, [
    scopedEventId,
    manageScope,
    recentLimit,
    requestGuard,
    requestScopeKey,
    selectedDate,
    venueId,
  ]);

  useEffect(() => {
    if (isActive) void loadLinks();
  }, [isActive, loadLinks]);
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const hasCurrentScopeData = loadedScopeKey === requestScopeKey;
  const isCurrentScopeFetching = isFetching || !hasCurrentScopeData;
  const displayLinks = !hasCurrentScopeData
    ? EMPTY_LINKS
    : isFetching && displayCacheRef.current.scopeKey === requestScopeKey
      ? displayCacheRef.current.links
      : links;
  const dashboardStats = useMemo(
    () => getDashboardStats(displayLinks, now),
    [displayLinks, now],
  );
  const filteredLinks = useMemo(
    () => filterLinksByManageFilter(displayLinks, manageFilter, now),
    [displayLinks, manageFilter, now],
  );
  const sortedLinks = useMemo(
    () =>
      sortLinks(
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

  const completeMutation = useCallback(
    async (
      id: string,
      operationName: "delete" | "deactivate" | "activate",
      pendingKey: string,
      action: (id: string) => Promise<{ error: string | null }>,
      failureKey: "deleteFailed" | "deactivateFailed" | "reactivateFailed",
      successKey: "deleted" | "deactivated" | "reactivated",
      update: (current: ExternalDJLink[]) => ExternalDJLink[],
    ) => {
      if (!isActiveRef.current) return;
      if (activeLifecycleLeasesRef.current.has(id)) return;
      const lease: LifecycleLease = {
        scopeKey: requestScopeKey,
        owner: Symbol(`link-lifecycle:${id}`),
      };
      activeLifecycleLeasesRef.current.set(id, lease);
      const operation = mutationGuard.beginOperation(
        requestScopeKey,
        `lifecycle:${id}`,
      );
      requestGuard.invalidateRequests();
      setIsFetching(false);
      setError(null);
      setSuccess(null);
      setLifecycleBusyIds((current) => ({ ...current, [id]: true }));
      setLoadingStates((current) => ({ ...current, [pendingKey]: true }));
      try {
        const result = await action(id);
        if (
          !isActiveRef.current ||
          !operation.isCurrent(currentScopeRef.current)
        )
          return;
        if (result.error) {
          console.error(`Failed to ${operationName}:`, result.error);
          setError(tRef.current(failureKey));
          setErrorScopeKey(operation.scopeKey);
        } else {
          requestGuard.invalidateRequests();
          setIsFetching(false);
          setLinks((current) => {
            const next = update(current);
            displayCacheRef.current = {
              scopeKey: operation.scopeKey,
              links: next,
            };
            return next;
          });
          setSuccess(tRef.current(successKey));
          setSuccessScopeKey(operation.scopeKey);
          await loadLinks();
        }
      } catch (mutationError) {
        if (
          !isActiveRef.current ||
          !operation.isCurrent(currentScopeRef.current)
        )
          return;
        console.error(`Failed to ${operationName}:`, mutationError);
        setError(tRef.current(failureKey));
        setErrorScopeKey(operation.scopeKey);
      } finally {
        const currentLease = activeLifecycleLeasesRef.current.get(id);
        if (
          currentLease?.owner === lease.owner &&
          currentLease.scopeKey === lease.scopeKey &&
          operation.finish(currentScopeRef.current)
        ) {
          activeLifecycleLeasesRef.current.delete(id);
          setLifecycleBusyIds((current) => ({ ...current, [id]: false }));
          setLoadingStates((current) => ({ ...current, [pendingKey]: false }));
          if (operationName === "delete") setPendingDeleteLink(null);
        }
      }
    },
    [loadLinks, mutationGuard, requestGuard, requestScopeKey],
  );

  const handleDeleteLink = useCallback(
    (id: string) =>
      completeMutation(
        id,
        "delete",
        `delete_${id}`,
        actionsRef.current.deleteLink,
        "deleteFailed",
        "deleted",
        (current) => current.filter((link) => link.id !== id),
      ),
    [completeMutation],
  );
  const handleDeactivateLink = useCallback(
    (id: string) =>
      completeMutation(
        id,
        "deactivate",
        `deactivate_${id}`,
        actionsRef.current.deactivateLink,
        "deactivateFailed",
        "deactivated",
        (current) =>
          current.map((link) =>
            link.id === id ? { ...link, active: false } : link,
          ),
      ),
    [completeMutation],
  );
  const handleActivateLink = useCallback(
    (id: string) =>
      completeMutation(
        id,
        "activate",
        `activate_${id}`,
        actionsRef.current.activateLink,
        "reactivateFailed",
        "reactivated",
        (current) =>
          current.map((link) =>
            link.id === id ? { ...link, active: true } : link,
          ),
      ),
    [completeMutation],
  );

  const shareOrCopyManagedLink = useCallback(
    async (url: string, id: string) => {
      if (!isActiveRef.current) return;
      const operation = shareGuard.beginOperation(
        requestScopeKey,
        `share:${id}`,
      );
      setLoadingStates((current) => ({ ...current, [`share_${id}`]: true }));
      setError(null);
      const result = await actionsRef.current.shareLink(
        toExternalLinkShareData(url),
        {
          share:
            typeof navigator.share === "function"
              ? (data) => navigator.share(data)
              : undefined,
          canShare:
            typeof navigator.canShare === "function"
              ? (data) => navigator.canShare(data)
              : undefined,
          copy: async (value) => {
            if (!navigator.clipboard?.writeText)
              throw new Error("Clipboard API is unavailable");
            await navigator.clipboard.writeText(value);
          },
        },
      );
      if (!isActiveRef.current || !operation.isCurrent(currentScopeRef.current))
        return;
      if (result === "shared" || result === "copied") {
        setLinkActionFeedback({ id, operationId: operation.id, result });
        window.setTimeout(
          () =>
            setLinkActionFeedback((current) =>
              current?.id === id && current.operationId === operation.id
                ? null
                : current,
            ),
          2000,
        );
        toastOwnerRef.current = operation.id;
        setLinkActionToast(
          result === "shared"
            ? tRef.current("guestLinkShared")
            : tRef.current("guestLinkCopied"),
        );
        window.setTimeout(() => {
          if (toastOwnerRef.current === operation.id) {
            toastOwnerRef.current = null;
            setLinkActionToast(null);
          }
        }, 2200);
      } else if (result === "failed") {
        setError(tRef.current("shareFailed"));
        setErrorScopeKey(operation.scopeKey);
      }
      if (operation.finish(currentScopeRef.current))
        setLoadingStates((current) => ({ ...current, [`share_${id}`]: false }));
    },
    [requestScopeKey, shareGuard],
  );

  const clearFeedbackForTemplateHandoff = useCallback(() => {
    setError(null);
    setErrorScopeKey("");
    setSuccess(null);
    setSuccessScopeKey("");
    setLinkActionFeedback(null);
    setLinkActionToast(null);
  }, []);
  const requestDeleteLink = useCallback((link: ExternalDJLink) => {
    if (activeLifecycleLeasesRef.current.has(link.id)) return;
    setError(null);
    setErrorScopeKey("");
    setSuccess(null);
    setSuccessScopeKey("");
    setPendingDeleteLink(link);
  }, []);
  const getGuestPageUrl = useCallback(
    (token: string, guestUrl?: string | null) =>
      guestUrl ??
      (typeof window === "undefined"
        ? ""
        : `${window.location.origin}/guest?token=${token}`),
    [],
  );
  return {
    manageScope,
    setManageScope,
    recentLimit,
    setRecentLimit,
    manageFilter,
    setManageFilter,
    manageSort,
    setManageSort,
    now,
    dashboardStats,
    sortedLinks,
    listState,
    isCurrentScopeFetching,
    scopedManageError: errorScopeKey === requestScopeKey ? error : null,
    scopedSuccess: successScopeKey === requestScopeKey ? success : null,
    linkActionFeedback,
    visibleLinkId,
    setVisibleLinkId,
    loadingStates,
    lifecycleBusyIds,
    linkActionToast,
    pendingDeleteLink,
    setPendingDeleteLink,
    loadLinks,
    handleDeleteLink,
    requestDeleteLink,
    handleDeactivateLink,
    handleActivateLink,
    shareOrCopyManagedLink,
    clearFeedbackForTemplateHandoff,
    getGuestPageUrl,
  };
}
