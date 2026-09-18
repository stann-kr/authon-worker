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
import type { ExternalLinkPage, ExternalDJLink } from "@/lib/external-links/types";
import type { ManageFilter, ManageSort } from "./linkStatus";
import { LINK_PAGE_SIZE, type LinkListCursor, type LinkListOptions, type LinkListStats } from "@/lib/external-links/list-types";

const EMPTY_LINKS: ExternalDJLink[] = [];

export interface LinkManageControllerActions {
  fetchPage: (venueId: string, options: LinkListOptions) => Promise<{ data: ExternalLinkPage | null; error: string | null }>;
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
  actions,
}: Options) {
  const t = useTranslations("LinkAdmin");
  const [manageScope, setManageScope] = useState<"date" | "recent">("recent");
  const [manageFilter, setManageFilter] = useState<ManageFilter>("all");
  const [manageSort, setManageSort] = useState<ManageSort>("newest");
  const [now, setNow] = useState(() => Date.now());
  const [links, setLinks] = useState<ExternalDJLink[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<LinkListCursor | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [dashboardStats, setDashboardStats] = useState<LinkListStats>({ total: 0, active: 0, attention: 0 });
  const pagingRef = useRef(false);
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
  const requestScopeKey = `${venueId}:${manageScope}:${manageScope === "recent" ? "all" : selectedDate}:${scopedEventId ?? "general"}:${manageFilter}:${manageScope === "recent" ? "newest" : manageSort}`;
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
    setNextCursor(null);
    setLoadMoreError(null);
    setIsLoadingMore(false);
    pagingRef.current = false;
    setVisibleLinkId(null);
    setDashboardStats({ total: 0, active: 0, attention: 0 });
  }, [mutationGuard, requestGuard, requestScopeKey, shareGuard]);

  useEffect(() => {
    if (isActive) return;
    requestGuard.invalidateRequests();
    mutationGuard.invalidateOperations();
    shareGuard.invalidateOperations();
    activeLifecycleLeasesRef.current.clear();
    toastOwnerRef.current = null;
    setIsFetching(false);
    setIsLoadingMore(false);
    pagingRef.current = false;
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

  const pageOptions = useMemo<LinkListOptions>(() => ({
    ...(manageScope === "date" ? { date: selectedDate, eventId: scopedEventId } : {}),
    filter: manageFilter,
    sort: manageScope === "recent" ? "newest" : manageSort,
  }), [manageScope, selectedDate, scopedEventId, manageFilter, manageSort]);

  const loadLinks = useCallback(async () => {
    if (!isActiveRef.current || currentScopeRef.current !== requestScopeKey) return;
    const isLatestRequest = requestGuard.beginRequest();
    const current = () => isLatestRequest() && isActiveRef.current && currentScopeRef.current === requestScopeKey;
    pagingRef.current = true;
    setIsLoadingMore(false);
    setLoadMoreError(null);
    setIsFetching(true);
    setError(null);
    const cached = displayCacheRef.current.scopeKey === requestScopeKey ? displayCacheRef.current.links : [];
    try {
      const collected: ExternalDJLink[] = [];
      let cursor: LinkListCursor | null = null;
      let stats: LinkListStats = { total: 0, active: 0, attention: 0 };
      if (venueId) do {
        const result = await actionsRef.current.fetchPage(venueId, { ...pageOptions, cursor });
        if (!current()) return;
        if (result.error || !result.data) throw new Error("LINK_PAGE_UNAVAILABLE");
        collected.push(...result.data.links);
        cursor = result.data.nextCursor;
        stats = result.data.stats;
      } while (cursor && collected.length < Math.max(LINK_PAGE_SIZE, cached.length));
      if (!current()) return;
      setLinks(collected);
      setNextCursor(cursor);
      setDashboardStats(stats);
      setLoadedScopeKey(requestScopeKey);
      setLoadOutcome("success");
    } catch {
      if (!current()) return;
      setLinks(cached);
      setLoadedScopeKey(requestScopeKey);
      setNextCursor(null);
      setError(tRef.current("loadFailed"));
      setErrorScopeKey(requestScopeKey);
      setLoadOutcome(cached.length ? "partial" : "error");
    } finally {
      if (current()) { setIsFetching(false); pagingRef.current = false; }
    }
  }, [pageOptions, requestGuard, requestScopeKey, venueId]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || pagingRef.current || activeLifecycleLeasesRef.current.size ||
      !isActiveRef.current || currentScopeRef.current !== requestScopeKey) return;
    pagingRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    const isLatestRequest = requestGuard.beginRequest();
    const current = () => isLatestRequest() && isActiveRef.current && currentScopeRef.current === requestScopeKey;
    try {
      const result = await actionsRef.current.fetchPage(venueId, { ...pageOptions, cursor: nextCursor });
      if (!current()) return;
      if (result.error || !result.data) throw new Error("LINK_PAGE_UNAVAILABLE");
      const page = result.data;
      setLinks((existing) => {
        const ids = new Set(existing.map((link) => link.id));
        return [...existing, ...page.links.filter((link) => !ids.has(link.id))];
      });
      setNextCursor(page.nextCursor);
      setDashboardStats(page.stats);
    } catch {
      if (current()) setLoadMoreError(tRef.current("loadMoreFailed"));
    } finally {
      if (current()) { setIsLoadingMore(false); pagingRef.current = false; }
    }
  }, [nextCursor, pageOptions, requestGuard, requestScopeKey, venueId]);

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
  const sortedLinks = displayLinks;
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
    manageFilter,
    setManageFilter,
    manageSort,
    setManageSort,
    now,
    dashboardStats,
    sortedLinks,
    listState,
    isCurrentScopeFetching,
    isLoadingMore,
    hasMore: hasCurrentScopeData && Boolean(nextCursor),
    loadMoreError,
    loadMore,
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
