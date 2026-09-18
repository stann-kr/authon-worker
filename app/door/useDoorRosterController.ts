"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useGuestPolling,
  useLatestRef,
  useLatestRequestGuard,
  useScopedOperationGuard,
} from "@/lib/hooks";
import {
  applyQueuedDoorMutation,
  createOfflineDoorRosterSnapshot,
  type OfflineDoorAction,
  type OfflineDoorGuest,
  type OfflineDoorMutation,
  type OfflineDoorMutationState,
  type OfflineDoorRosterSnapshot,
  type OfflineDoorScope,
} from "@/lib/door/offline-domain";
import {
  groupOfflineDoorMutationsByDevice,
  type OfflineDoorSyncResult,
} from "@/lib/door/offline-sync";
import type { ApiResponse } from "@/lib/api/response";
import type { ExternalLinkDirectoryEntry } from "@/lib/external-links/types";
import type { GuestOperationsSnapshot } from "@/lib/guest-snapshots/types";
import type { Guest } from "@/lib/guests/types";
import type { UserDirectoryEntry } from "@/lib/users/types";
import { subscribeToRouteTransitionStart } from "@/lib/route-transition-events";

const EMPTY_DISPLAY_DATA = {
  guests: [] as Guest[],
  users: [] as UserDirectoryEntry[],
  externalLinks: [] as ExternalLinkDirectoryEntry[],
};

const STALE_OFFLINE_STORE_TASK = Symbol("STALE_OFFLINE_STORE_TASK");

type OfflineStoreTaskResult<T> = T | typeof STALE_OFFLINE_STORE_TASK;
type OwnershipCheck = () => boolean;

interface DoorScopeToken {
  key: string;
}

interface DoorRefreshOwner {
  scopeToken: DoorScopeToken;
  revision: number;
  mutations: Set<number>;
  queued: "foreground" | "background" | null;
  inFlight: { revision: number; background: boolean; promise: Promise<void> } | null;
}

function createRefreshOwner(scopeToken: DoorScopeToken): DoorRefreshOwner {
  return { scopeToken, revision: 0, mutations: new Set(), queued: null, inFlight: null };
}

interface OfflineSyncRequest {
  scope: OfflineDoorScope;
  scopeToken: DoorScopeToken;
  syncToken: number;
}

export interface DoorRosterDependencies {
  fetchGuestsByDate: (
    date: string,
    venueId?: string,
    eventId?: string | null,
  ) => Promise<ApiResponse<Guest[]>>;
  updateGuestStatus: (
    guestId: string,
    status: "pending" | "checked",
    idempotencyKey: string,
  ) => Promise<ApiResponse<Guest>>;
  deleteGuest: (guestId: string) => Promise<ApiResponse<Guest>>;
  fetchGuestOperationsSnapshot: (
    date: string,
    venueId: string,
    eventId?: string | null,
  ) => Promise<ApiResponse<GuestOperationsSnapshot>>;
  fetchOfflineDoorRoster: (
    scope: OfflineDoorScope,
  ) => Promise<ApiResponse<OfflineDoorGuest[]>>;
  syncOfflineDoorMutations: (
    params: OfflineDoorScope & { deviceId: string; items: unknown[] },
  ) => Promise<ApiResponse<OfflineDoorSyncResult[]>>;
  clearResolvedOfflineDoorMutations: (
    scope: OfflineDoorScope,
  ) => Promise<void>;
  enqueueOfflineDoorMutation: (params: {
    scope: OfflineDoorScope;
    guestId: string;
    action: OfflineDoorAction;
  }) => Promise<OfflineDoorMutation>;
  listOfflineDoorMutations: (
    scope: OfflineDoorScope,
  ) => Promise<OfflineDoorMutation[]>;
  loadOfflineDoorRoster: (
    scope: OfflineDoorScope,
  ) => Promise<OfflineDoorRosterSnapshot | null>;
  removeOfflineDoorRoster: (scope: OfflineDoorScope) => Promise<void>;
  resolveOfflineDoorMutation: (params: {
    scope: OfflineDoorScope;
    idempotencyKey: string;
    state: Exclude<OfflineDoorMutationState, "queued">;
    resolution?: OfflineDoorMutation["resolution"];
  }) => Promise<void>;
  saveOfflineDoorRoster: (snapshot: OfflineDoorRosterSnapshot) => Promise<void>;
  randomUUID: () => string;
}

interface UseDoorRosterControllerOptions {
  canDeleteGuests?: boolean;
  venueId: string;
  selectedDate: string;
  selectedEventId: string | null;
  translate: (key: string) => string;
  dependencies: DoorRosterDependencies;
}

export default function useDoorRosterController({
  canDeleteGuests = false,
  venueId,
  selectedDate,
  selectedEventId,
  translate,
  dependencies,
}: UseDoorRosterControllerOptions) {
  const translateRef = useLatestRef(translate);
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [externalLinks, setExternalLinks] =
    useState<ExternalLinkDirectoryEntry[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deleteFailure, setDeleteFailure] = useState<{ scopeKey: string; guestId: string; message: string } | null>(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [offlineMutations, setOfflineMutations] = useState<
    OfflineDoorMutation[]
  >([]);
  const [isOfflineSyncing, setIsOfflineSyncing] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<
    "queued" | "syncFailed" | "scopeClosed" | null
  >(null);
  const offlineStoreTailRef = useRef<Promise<void>>(Promise.resolve());
  const syncRequestTokenRef = useRef(0);
  const latestSyncRequestTokenRef = useRef(0);
  const syncCoordinatorRef = useRef<{
    isRunning: boolean;
    pending: OfflineSyncRequest | null;
  }>({ isRunning: false, pending: null });

  const displayCacheRef = useRef<{
    scopeKey: string;
    guests: Guest[];
    users: UserDirectoryEntry[];
    externalLinks: ExternalLinkDirectoryEntry[];
  }>({
    scopeKey: "",
    guests: [],
    users: [],
    externalLinks: [],
  });

  const requestScopeKey = `${venueId}:${selectedDate}:${selectedEventId ?? "general"}`;
  const offlineScope = useMemo<OfflineDoorScope | null>(
    () =>
      venueId && selectedEventId
        ? {
            venueId,
            eventId: selectedEventId,
            businessDate: selectedDate,
          }
        : null,
    [selectedDate, selectedEventId, venueId],
  );
  const requestGuard = useLatestRequestGuard();
  const pollingGuard = useLatestRequestGuard();
  const mutationGuard = useScopedOperationGuard();
  const currentScopeKeyRef = useRef(requestScopeKey);
  const currentScopeOwnerRef = useRef<DoorScopeToken>({ key: requestScopeKey });
  if (currentScopeOwnerRef.current.key !== requestScopeKey) {
    currentScopeOwnerRef.current = { key: requestScopeKey };
  }
  const currentScopeToken = currentScopeOwnerRef.current;
  currentScopeKeyRef.current = requestScopeKey;
  const refreshOwnerRef = useRef(createRefreshOwner(currentScopeToken));
  if (refreshOwnerRef.current.scopeToken !== currentScopeToken) {
    refreshOwnerRef.current = createRefreshOwner(currentScopeToken);
  }
  useEffect(() => {
    const cancelRefresh = () => {
      refreshOwnerRef.current.queued = null;
      refreshOwnerRef.current = createRefreshOwner(currentScopeOwnerRef.current);
    };
    const unsubscribe = subscribeToRouteTransitionStart(cancelRefresh);
    return () => { unsubscribe(); cancelRefresh(); };
  }, []);

  const runOfflineStoreTask = useCallback(
    <T,>(
      isCurrent: OwnershipCheck,
      task: () => Promise<T>,
    ): Promise<OfflineStoreTaskResult<T>> => {
      const result = offlineStoreTailRef.current.then(
        async (): Promise<OfflineStoreTaskResult<T>> => {
          if (!isCurrent()) return STALE_OFFLINE_STORE_TASK;
          return task();
        },
      );
      offlineStoreTailRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [],
  );

  const resolveOfflineRoster = useCallback(async (
    scope: OfflineDoorScope,
    snapshot: GuestOperationsSnapshot | null,
  ): Promise<ApiResponse<OfflineDoorGuest[]>> => {
    // Preserve compatibility with an older server during a rolling deployment.
    if (!snapshot?.offlineRosterStatus) return dependencies.fetchOfflineDoorRoster(scope);
    if (snapshot.offlineRosterStatus === "unavailable") {
      return { data: null, error: "OFFLINE_DOOR_EVENT_UNAVAILABLE" };
    }
    if (snapshot.failedSections.includes("guests")) {
      return { data: null, error: "OFFLINE_DOOR_ROSTER_FAILED" };
    }
    const roster: OfflineDoorGuest[] = [];
    for (const guest of snapshot.guests) {
      if (guest.venueId !== scope.venueId || guest.eventId !== scope.eventId ||
          (guest.status !== "pending" && guest.status !== "checked")) continue;
      roster.push({
        id: guest.id,
        name: guest.name,
        status: guest.status,
        checkInTime: guest.checkInTime ?? null,
      });
    }
    return { data: roster, error: null };
  }, [dependencies]);

  useEffect(() => {
    if (!isFetching && loadedScopeKey === requestScopeKey) {
      displayCacheRef.current = {
        scopeKey: requestScopeKey,
        guests,
        users,
        externalLinks,
      };
    }
  }, [externalLinks, guests, isFetching, loadedScopeKey, requestScopeKey, users]);

  const hasCurrentScopeData = loadedScopeKey === requestScopeKey;
  const isCurrentScopeFetching = isFetching || !hasCurrentScopeData;
  const displayData = !hasCurrentScopeData
    ? EMPTY_DISPLAY_DATA
    : isFetching && displayCacheRef.current.scopeKey === requestScopeKey
      ? displayCacheRef.current
      : { guests, users, externalLinks };

  useEffect(() => {
    setLoadOutcome("idle");
  }, [requestScopeKey]);

  const refreshOfflineMutations = useCallback(
    async (scope: OfflineDoorScope | null, isCurrent: OwnershipCheck) => {
      if (!scope) {
        if (isCurrent()) setOfflineMutations([]);
        return [];
      }
      try {
        const mutations = await runOfflineStoreTask(isCurrent, () =>
          dependencies.listOfflineDoorMutations(scope),
        );
        if (mutations === STALE_OFFLINE_STORE_TASK || !isCurrent()) return [];
        setOfflineMutations(mutations);
        return mutations;
      } catch {
        if (isCurrent()) setOfflineMutations([]);
        return [];
      }
    },
    [dependencies, runOfflineStoreTask],
  );

  const loadCachedOfflineRoster = useCallback(
    async (
      scope: OfflineDoorScope,
      isCurrent: OwnershipCheck,
    ): Promise<boolean> => {
      try {
        const snapshot = await runOfflineStoreTask(isCurrent, () =>
          dependencies.loadOfflineDoorRoster(scope),
        );
        if (
          snapshot === STALE_OFFLINE_STORE_TASK ||
          !snapshot ||
          !isCurrent()
        )
          return false;
        const mutations = await runOfflineStoreTask(isCurrent, () =>
          dependencies.listOfflineDoorMutations(scope),
        );
        if (mutations === STALE_OFFLINE_STORE_TASK || !isCurrent()) return false;
        const cachedGuests = mutations
          .filter(
            (mutation) =>
              mutation.state === "queued" || mutation.state === "confirmed",
          )
          .reduce(
            (current, mutation) => applyQueuedDoorMutation(current, mutation),
            snapshot.guests,
          );
        setGuests(
          cachedGuests.map((guest) => ({
            id: guest.id,
            venueId: scope.venueId,
            eventId: scope.eventId,
            name: guest.name,
            status: guest.status,
            checkInTime: guest.checkInTime,
            date: scope.businessDate,
            createdAt: snapshot.cachedAt,
            updatedAt: snapshot.cachedAt,
          })),
        );
        setUsers([]);
        setExternalLinks([]);
        setOfflineMutations(mutations);
        setIsOfflineMode(true);
        setLoadOutcome("success");
        return true;
      } catch {
        return false;
      }
    },
    [dependencies, runOfflineStoreTask],
  );

  const runOfflineSync = useCallback(
    async (request: OfflineSyncRequest) => {
      const offlineScope = request.scope;
      const isCurrent = () =>
        currentScopeOwnerRef.current === request.scopeToken &&
        latestSyncRequestTokenRef.current === request.syncToken;
      if (
        !isCurrent() ||
        (typeof navigator !== "undefined" && !navigator.onLine)
      )
        return;
      try {
        const mutations = await runOfflineStoreTask(isCurrent, () =>
          dependencies.listOfflineDoorMutations(offlineScope),
        );
        if (mutations === STALE_OFFLINE_STORE_TASK || !isCurrent()) return;
        const queued = mutations.filter(
          (mutation) => mutation.state === "queued",
        );
        if (queued.length === 0) {
          setOfflineMutations(mutations);
          return;
        }
        const syncResults: OfflineDoorSyncResult[] = [];
        let hasSyncFailure = false;
        for (const group of groupOfflineDoorMutationsByDevice(queued)) {
          if (!isCurrent()) return;
          const response = await dependencies.syncOfflineDoorMutations({
            ...offlineScope,
            deviceId: group.deviceId,
            items: group.mutations.map((mutation) => ({
              idempotencyKey: mutation.idempotencyKey,
              sequence: mutation.sequence,
              guestId: mutation.guestId,
              action: mutation.action,
              queuedAt: mutation.queuedAt,
            })),
          });
          if (!isCurrent()) return;
          if (response.error || !response.data) {
            hasSyncFailure = true;
            continue;
          }
          syncResults.push(...response.data);
        }
        if (syncResults.length === 0 && hasSyncFailure) {
          setOfflineNotice("syncFailed");
          return;
        }
        for (const result of syncResults) {
          const resolution = await runOfflineStoreTask(isCurrent, () =>
            dependencies.resolveOfflineDoorMutation({
              scope: offlineScope,
              idempotencyKey: result.idempotencyKey,
              state: result.state,
              resolution: result.resolution,
            }),
          );
          if (resolution === STALE_OFFLINE_STORE_TASK || !isCurrent()) return;
        }
        await loadCachedOfflineRoster(offlineScope, isCurrent);
        if (!isCurrent()) return;
        setGuests((current) => {
          let next = current;
          for (const result of syncResults) {
            if (result.status === null) continue;
            next = next.map((guest) =>
              guest.id === result.guestId
                ? {
                    ...guest,
                    status: result.status ?? guest.status,
                    checkInTime: result.checkInTime,
                  }
                : guest,
            );
          }
          return next;
        });
        try {
          const authoritative =
            await dependencies.fetchGuestOperationsSnapshot(
              offlineScope.businessDate,
              offlineScope.venueId,
              offlineScope.eventId,
            );
          if (!isCurrent()) return;
          if (authoritative.data) {
            setGuests(authoritative.data.guests);
            setUsers(authoritative.data.users);
            setExternalLinks(authoritative.data.externalLinks);
            setIsOfflineMode(false);
          }
          const cacheableRoster = await resolveOfflineRoster(offlineScope, authoritative.data);
          if (!isCurrent()) return;
          if (cacheableRoster?.data) {
            try {
              await runOfflineStoreTask(isCurrent, () =>
                dependencies.saveOfflineDoorRoster(
                  createOfflineDoorRosterSnapshot({
                    scope: offlineScope,
                    guests: cacheableRoster.data ?? [],
                  }),
                ),
              );
            } catch {
              // The server result remains authoritative if local persistence is unavailable.
            }
          } else if (
            cacheableRoster?.error === "OFFLINE_DOOR_EVENT_UNAVAILABLE"
          ) {
            try {
              await runOfflineStoreTask(isCurrent, () =>
                dependencies.removeOfflineDoorRoster(offlineScope),
              );
            } catch {
              // A stale snapshot will still expire locally and cannot sync into a closed Event.
            }
          }
        } catch {
          // Resolved queue states remain visible until a later authoritative refresh.
        }
        if (!isCurrent()) return;
        const hasScopeClosedResult = syncResults.some(
          (result) => result.state === "scope_closed",
        );
        setOfflineNotice(
          hasSyncFailure
            ? "syncFailed"
            : hasScopeClosedResult
              ? "scopeClosed"
              : null,
        );
        await refreshOfflineMutations(offlineScope, isCurrent);
      } catch {
        if (isCurrent()) setOfflineNotice("syncFailed");
      }
    },
    [
      dependencies,
      loadCachedOfflineRoster,
      refreshOfflineMutations,
      resolveOfflineRoster,
      runOfflineStoreTask,
    ],
  );

  const syncOfflineQueue = useCallback(async () => {
    if (
      !offlineScope ||
      currentScopeOwnerRef.current !== currentScopeToken ||
      (typeof navigator !== "undefined" && !navigator.onLine)
    )
      return;
    const request: OfflineSyncRequest = {
      scope: offlineScope,
      scopeToken: currentScopeToken,
      syncToken: ++syncRequestTokenRef.current,
    };
    latestSyncRequestTokenRef.current = request.syncToken;
    const coordinator = syncCoordinatorRef.current;
    if (coordinator.isRunning) {
      coordinator.pending = request;
      setIsOfflineSyncing(true);
      return;
    }
    coordinator.isRunning = true;
    setIsOfflineSyncing(true);
    let nextRequest: OfflineSyncRequest | null = request;
    try {
      while (nextRequest) {
        coordinator.pending = null;
        await runOfflineSync(nextRequest);
        nextRequest = coordinator.pending as OfflineSyncRequest | null;
        if (
          nextRequest &&
          currentScopeOwnerRef.current !== nextRequest.scopeToken
        ) {
          nextRequest = null;
        }
      }
    } finally {
      coordinator.isRunning = false;
      coordinator.pending = null;
      setIsOfflineSyncing(false);
    }
  }, [
    currentScopeToken,
    offlineScope,
    runOfflineSync,
  ]);

  const readData = useCallback(async (background: boolean, owner: DoorRefreshOwner, revision: number) => {
    pollingGuard.invalidateRequests();
    const isLatestRequest = requestGuard.beginRequest();
    const ownsRequest = () =>
      isLatestRequest() &&
      refreshOwnerRef.current === owner &&
      currentScopeOwnerRef.current === currentScopeToken;
    const isCurrent = () => ownsRequest() && owner.revision === revision && owner.mutations.size === 0;
    if (!venueId) {
      if (!isCurrent()) return;
      setGuests([]);
      setUsers([]);
      setExternalLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setLoadOutcome("success");
      setIsFetching(false);
      return;
    }
    if (!background) {
      setIsFetching(true);
      setFeedback(null);
    }
    try {
      const operationsResponse =
        await dependencies.fetchGuestOperationsSnapshot(
          selectedDate,
          venueId,
          selectedEventId,
        );
      const { data, error } = operationsResponse;
      if (!isCurrent()) return;
      if (!data) {
        if (background) {
          setFeedback(translateRef.current("loadFailed"));
          setLoadOutcome("partial");
          return;
        }
        const usedCache = offlineScope
          ? await loadCachedOfflineRoster(offlineScope, isCurrent)
          : false;
        if (!isCurrent()) return;
        if (!usedCache) {
          setGuests([]);
          setUsers([]);
          setExternalLinks([]);
          setFeedback(translateRef.current("loadFailed"));
          setLoadOutcome("error");
          setIsOfflineMode(false);
        }
      } else {
        if (error) {
          setFeedback(translateRef.current("partialLoadFailed"));
          setLoadOutcome("partial");
        } else {
          setFeedback(null);
          setLoadOutcome("success");
        }
        if (!background || !data.failedSections.includes("guests")) setGuests(data.guests);
        if (!background || !data.failedSections.includes("users")) setUsers(data.users);
        if (!background || !data.failedSections.includes("externalLinks")) setExternalLinks(data.externalLinks);
        setIsOfflineMode(false);
        setLoadedScopeKey(requestScopeKey);
        if (offlineScope) {
          void (async () => {
            try {
              const offlineRosterResponse = await resolveOfflineRoster(offlineScope, data);
              if (!isCurrent()) return;
              if (offlineRosterResponse?.data) {
                await runOfflineStoreTask(isCurrent, () =>
                  dependencies.saveOfflineDoorRoster(
                    createOfflineDoorRosterSnapshot({
                      scope: offlineScope,
                      guests: offlineRosterResponse.data ?? [],
                    }),
                  ),
                );
                if (isCurrent()) {
                  await refreshOfflineMutations(offlineScope, isCurrent);
                }
              } else if (
                offlineRosterResponse?.error ===
                "OFFLINE_DOOR_EVENT_UNAVAILABLE"
              ) {
                await runOfflineStoreTask(isCurrent, () =>
                  dependencies.removeOfflineDoorRoster(offlineScope),
                );
                if (isCurrent()) {
                  await refreshOfflineMutations(offlineScope, isCurrent);
                }
              }
            } catch {
              if (isCurrent()) setOfflineMutations([]);
            }
            if (isCurrent()) void syncOfflineQueue();
          })();
        }
      }
      if (!data) setLoadedScopeKey(requestScopeKey);
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Failed to load data:", error);
      if (background) {
        setFeedback(translateRef.current("loadFailed"));
        setLoadOutcome("partial");
        return;
      }
      const usedCache = offlineScope
        ? await loadCachedOfflineRoster(offlineScope, isCurrent)
        : false;
      if (!isCurrent()) return;
      setLoadedScopeKey(requestScopeKey);
      if (!usedCache) {
        setGuests([]);
        setUsers([]);
        setExternalLinks([]);
        setFeedback(translateRef.current("loadFailed"));
        setLoadOutcome("error");
        setIsOfflineMode(false);
      }
    } finally {
      if (ownsRequest() && !background) setIsFetching(false);
    }
  }, [
    currentScopeToken,
    dependencies,
    loadCachedOfflineRoster,
    offlineScope,
    pollingGuard,
    refreshOfflineMutations,
    requestGuard,
    requestScopeKey,
    resolveOfflineRoster,
    runOfflineStoreTask,
    selectedDate,
    selectedEventId,
    syncOfflineQueue,
    translateRef,
    venueId,
  ]);

  const requestRefresh = useCallback(async (background: boolean) => {
    const owner = refreshOwnerRef.current;
    if (owner.scopeToken !== currentScopeToken) return;
    if (owner.inFlight?.revision === owner.revision && owner.mutations.size === 0) {
      return owner.inFlight.promise;
    }
    owner.queued = !background || owner.queued === "foreground" ? "foreground" : "background";
    if (owner.inFlight || owner.mutations.size > 0) return;
    const running = { revision: owner.revision, background, promise: Promise.resolve() };
    owner.inFlight = running;
    running.promise = (async () => {
      try {
        while (refreshOwnerRef.current === owner && owner.queued && owner.mutations.size === 0) {
          running.background = owner.queued === "background";
          running.revision = owner.revision;
          owner.queued = null;
          await readData(running.background, owner, running.revision);
        }
      } finally {
        owner.inFlight = null;
      }
    })();
    return running.promise;
  }, [currentScopeToken, readData]);

  const loadData = useCallback(() => requestRefresh(false), [requestRefresh]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const isCurrent = () => currentScopeOwnerRef.current === currentScopeToken;
    setOfflineNotice(null);
    setIsOfflineMode(false);
    setOfflineMutations([]);
    void refreshOfflineMutations(offlineScope, isCurrent);
  }, [
    currentScopeToken,
    offlineScope,
    refreshOfflineMutations,
  ]);

  useEffect(() => {
    const handleOnline = () => {
      void loadData();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [loadData]);

  const pollData = useCallback(async () => {
    if (!venueId || loadedScopeKey !== requestScopeKey) return;
    if (refreshOwnerRef.current.inFlight || refreshOwnerRef.current.mutations.size > 0) return;
    const isLatestRequest = pollingGuard.beginRequest();
    const { data } = await dependencies.fetchGuestsByDate(
      selectedDate,
      venueId,
      selectedEventId,
    );
    if (isLatestRequest() && loadedScopeKey === requestScopeKey && data) {
      setGuests(data);
    }
  }, [
    dependencies,
    loadedScopeKey,
    pollingGuard,
    requestScopeKey,
    selectedDate,
    selectedEventId,
    venueId,
  ]);

  const pollingCoordinator = useGuestPolling(
    pollData,
    15000,
    !!venueId && !isOfflineMode && !isFetching,
  );

  useEffect(() => {
    mutationGuard.invalidateOperations();
    pollingGuard.invalidateRequests();
    pollingCoordinator.clearSuspensions();
    setLoadingStates({});
    setFeedback(null);
  }, [mutationGuard, pollingCoordinator, pollingGuard, requestScopeKey]);

  const queueOfflineStatusChange = useCallback(
    async (
      guestId: string,
      status: "pending" | "checked",
    ): Promise<boolean> => {
      if (!offlineScope) return false;
      const isCurrent = () => currentScopeOwnerRef.current === currentScopeToken;
      try {
        const mutation = await runOfflineStoreTask(isCurrent, () =>
          dependencies.enqueueOfflineDoorMutation({
            scope: offlineScope,
            guestId,
            action: status === "pending" ? "cancel_check_in" : "check_in",
          }),
        );
        if (mutation === STALE_OFFLINE_STORE_TASK || !isCurrent()) return false;
        setGuests((current) =>
          current.map((guest) =>
            guest.id === guestId
              ? {
                  ...guest,
                  status,
                  checkInTime: status === "checked" ? mutation.queuedAt : null,
                }
              : guest,
            ),
        );
        await refreshOfflineMutations(offlineScope, isCurrent);
        if (!isCurrent()) return false;
        setIsOfflineMode(true);
        setOfflineNotice("queued");
        setFeedback(null);
        return true;
      } catch {
        if (isCurrent()) setFeedback(translate("offlineQueueFailed"));
        return false;
      }
    },
    [
      currentScopeToken,
      dependencies,
      offlineScope,
      refreshOfflineMutations,
      runOfflineStoreTask,
      translate,
    ],
  );

  const handleStatusChange = async (
    id: string,
    newStatus: Guest["status"],
    action: string,
  ) => {
    const reportFailure = (message: string) => {
      setFeedback(message);
      if (newStatus === "deleted") setDeleteFailure({ scopeKey: requestScopeKey, guestId: id, message });
    };
    if (newStatus === "deleted") {
      if (!canDeleteGuests) return;
      if (isOfflineMode || (typeof navigator !== "undefined" && !navigator.onLine) ||
          isOfflineSyncing || offlineMutations.some((mutation) => mutation.state === "queued")) {
        reportFailure(translate("deleteRequiresOnline"));
        return;
      }
    }
    if (newStatus === "deleted") setDeleteFailure(null);
    const operationScopeKey = requestScopeKey;
    const busyKey = `${id}_${action}`;
    const operation = mutationGuard.beginOperation(
      operationScopeKey,
      busyKey,
    );
    const refreshOwner = refreshOwnerRef.current;
    refreshOwner.mutations.add(operation.id);
    refreshOwner.revision += 1;
    if (refreshOwner.inFlight) {
      refreshOwner.queued = refreshOwner.inFlight.background ? "background" : "foreground";
    }
    const releasePolling = pollingCoordinator.suspend();
    pollingGuard.invalidateRequests();
    setLoadingStates((prev) => ({ ...prev, [busyKey]: true }));
    let queuedOffline = false;

    try {
      if (
        newStatus !== "deleted" &&
        offlineScope &&
        (isOfflineMode ||
          (typeof navigator !== "undefined" && !navigator.onLine))
      ) {
        queuedOffline = await queueOfflineStatusChange(id, newStatus);
        return;
      }
      const { data, error } =
        newStatus === "deleted"
          ? await dependencies.deleteGuest(id)
          : await dependencies.updateGuestStatus(
              id,
              newStatus,
              dependencies.randomUUID(),
            );

      let cacheInvalidationFailed = false;
      if (newStatus === "deleted" && !error && data && offlineScope) {
        // A confirmed deletion invalidates its original scope even after navigation.
        try {
          await runOfflineStoreTask(() => true, () => dependencies.removeOfflineDoorRoster(offlineScope));
        } catch { cacheInvalidationFailed = true; }
      }
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      if (!error && data) {
        setGuests((prev) => newStatus === "deleted"
          ? prev.filter((guest) => guest.id !== id)
          : prev.map((guest) => (guest.id === id ? data : guest)));
        setFeedback(cacheInvalidationFailed ? translate("offlineStorageFailed") : null);
        refreshOwner.queued ??= "background";
      } else {
        console.error("Failed to update guest status:", error);
        reportFailure(
          error === "ATTENDANCE_SCOPE_CLOSED"
            ? translate("attendanceScopeClosed")
            : translate("updateFailed"),
        );
      }
    } catch (error) {
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      console.error("Failed to update guest status:", error);
      const queued =
        newStatus !== "deleted" && offlineScope
          ? await queueOfflineStatusChange(id, newStatus)
          : false;
      queuedOffline = Boolean(queued);
      if (!queued && operation.isCurrent(currentScopeKeyRef.current)) {
        reportFailure(translate("updateFailed"));
      }
    } finally {
      refreshOwner.mutations.delete(operation.id);
      if (queuedOffline) refreshOwner.queued = null;
      releasePolling();
      if (operation.finish(currentScopeKeyRef.current)) {
        setLoadingStates((prev) => ({ ...prev, [busyKey]: false }));
      }
      if (refreshOwnerRef.current === refreshOwner && refreshOwner.queued && refreshOwner.mutations.size === 0) {
        void requestRefresh(refreshOwner.queued === "background");
      }
    }
  };

  const handleClearResolvedOfflineMutations = async () => {
    if (!offlineScope) return;
    const isCurrent = () => currentScopeOwnerRef.current === currentScopeToken;
    try {
      const snapshot = await runOfflineStoreTask(isCurrent, () =>
        dependencies.loadOfflineDoorRoster(offlineScope),
      );
      if (snapshot === STALE_OFFLINE_STORE_TASK || !isCurrent()) return;
      const mutations = await runOfflineStoreTask(isCurrent, () =>
        dependencies.listOfflineDoorMutations(offlineScope),
      );
      if (mutations === STALE_OFFLINE_STORE_TASK || !isCurrent()) return;
      if (snapshot) {
        const confirmedRoster = mutations
          .filter((mutation) => mutation.state === "confirmed")
          .reduce(
            (current, mutation) => applyQueuedDoorMutation(current, mutation),
            snapshot.guests,
          );
        const saved = await runOfflineStoreTask(isCurrent, () =>
          dependencies.saveOfflineDoorRoster(
            createOfflineDoorRosterSnapshot({
              scope: offlineScope,
              guests: confirmedRoster,
            }),
          ),
        );
        if (saved === STALE_OFFLINE_STORE_TASK || !isCurrent()) return;
      }
      const cleared = await runOfflineStoreTask(isCurrent, () =>
        dependencies.clearResolvedOfflineDoorMutations(offlineScope),
      );
      if (cleared === STALE_OFFLINE_STORE_TASK || !isCurrent()) return;
      await refreshOfflineMutations(offlineScope, isCurrent);
    } catch {
      if (isCurrent()) setFeedback(translate("offlineStorageFailed"));
    }
  };

  const offlineQueueCounts = offlineMutations.reduce(
    (counts, mutation) => ({
      ...counts,
      [mutation.state]: counts[mutation.state] + 1,
    }),
    { queued: 0, confirmed: 0, conflict: 0, rejected: 0, scope_closed: 0 },
  );
  const hasResolvedOfflineMutations =
    offlineQueueCounts.confirmed +
      offlineQueueCounts.conflict +
      offlineQueueCounts.rejected +
      offlineQueueCounts.scope_closed >
    0;

  return {
    displayData,
    feedback,
    deleteFailure: deleteFailure?.scopeKey === requestScopeKey ? deleteFailure : null,
    guests,
    handleClearResolvedOfflineMutations,
    handleStatusChange,
    hasCurrentScopeData,
    hasPendingGuestMutations: refreshOwnerRef.current.mutations.size > 0 || offlineQueueCounts.queued > 0,
    hasResolvedOfflineMutations,
    isCurrentScopeFetching,
    isFetching,
    isOfflineMode,
    isOfflineSyncing,
    loadData,
    loadOutcome,
    loadingStates,
    offlineNotice,
    offlineQueueCounts,
    offlineScope,
    requestScopeKey,
    syncOfflineQueue,
  };
}
