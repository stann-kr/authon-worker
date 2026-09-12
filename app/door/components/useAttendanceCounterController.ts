"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ApiResponse } from "@/lib/api/response";
import {
  MAX_ATTENDANCE_SYNC_BATCH,
  findLatestUndoableAttendanceKey,
  isAttendanceScopeEqual,
  pendingAttendanceDelta,
  type AttendanceScope,
  type DoorAttendanceAction,
  type OfflineAttendanceMutation,
  type OfflineAttendanceMutationState,
} from "@/lib/attendance/domain";
import {
  beginAttendanceSummaryMutation,
  beginAttendanceSummaryRead,
  claimAttendanceSummaryMutation,
  createAttendanceSummaryAuthority,
  invalidateAttendanceSummaries,
  isAttendanceSummaryMutationClaimCurrent,
  isAttendanceSummaryReadCurrent,
} from "@/lib/attendance/summary-authority";
import type {
  AttendanceSyncResponse,
  DoorAttendanceSummary,
} from "@/lib/attendance/types";

type AttendanceCounterTranslate = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

type CounterNotice =
  | "loadFailed"
  | "queueFailed"
  | "syncFailed"
  | "adjustmentFailed"
  | "reconciliationStale"
  | "scopeClosed"
  | null;

function canRefreshAutomatically() {
  return navigator.onLine !== false && document.visibilityState === "visible";
}

export interface AttendanceCounterDependencies {
  fetchDoorAttendanceSummary: (params: {
    scope: AttendanceScope;
    deviceId?: string | null;
  }) => Promise<ApiResponse<DoorAttendanceSummary>>;
  reconcileDoorAttendance: (params: {
    scope: AttendanceScope;
    targetTotalAttendance: number;
    expectedCheckedInGuests: number;
    expectedWalkIns: number;
    expectedSourceActivityCount: number;
    reason: string;
    idempotencyKey: string;
  }) => Promise<ApiResponse<DoorAttendanceSummary>>;
  syncDoorAttendanceMutations: (params: {
    scope: AttendanceScope;
    deviceId: string;
    items: unknown[];
  }) => Promise<ApiResponse<AttendanceSyncResponse>>;
  clearResolvedAttendanceMutations: (
    scope: AttendanceScope,
  ) => Promise<void>;
  enqueueAttendanceMutation: (params: {
    scope: AttendanceScope;
    action: DoorAttendanceAction;
    reversesIdempotencyKey?: string | null;
  }) => Promise<OfflineAttendanceMutation>;
  getAttendanceDeviceId: () => Promise<string>;
  groupAttendanceMutationsByDevice: (
    mutations: readonly OfflineAttendanceMutation[],
  ) => Array<{
    deviceId: string;
    mutations: OfflineAttendanceMutation[];
  }>;
  listAttendanceMutations: (
    scope: AttendanceScope,
  ) => Promise<OfflineAttendanceMutation[]>;
  removeAttendanceMutations: (
    idempotencyKeys: readonly string[],
  ) => Promise<void>;
  resolveAttendanceMutation: (params: {
    idempotencyKey: string;
    state: Exclude<OfflineAttendanceMutationState, "queued">;
    resolution?: OfflineAttendanceMutation["resolution"];
  }) => Promise<void>;
  randomUUID: () => string;
}

interface UseAttendanceCounterControllerOptions {
  scope: AttendanceScope | null;
  currentBusinessDate: string;
  checkedInGuests: number;
  hasPendingGuestMutations: boolean;
  canAdjust: boolean;
  translate: AttendanceCounterTranslate;
  dependencies: AttendanceCounterDependencies;
}

function scopeKey(scope: AttendanceScope | null): string {
  return scope
    ? JSON.stringify([scope.venueId, scope.businessDate, scope.eventId])
    : "none";
}

interface AttendanceScopeOwnerToken {
  scopeKey: string;
}

interface SummaryReadOwner {
  scopeOwner: AttendanceScopeOwnerToken;
  pending: boolean;
  inFlight: { generation: number; promise: Promise<void> } | null;
}

function createSummaryReadOwner(scopeOwner: AttendanceScopeOwnerToken): SummaryReadOwner {
  return { scopeOwner, pending: false, inFlight: null };
}

export default function useAttendanceCounterController({
  scope,
  currentBusinessDate,
  checkedInGuests,
  hasPendingGuestMutations,
  canAdjust,
  translate,
  dependencies,
}: UseAttendanceCounterControllerOptions) {
  const [summary, setSummary] = useState<DoorAttendanceSummary | null>(null);
  const [mutations, setMutations] = useState<OfflineAttendanceMutation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isStorageAvailable, setIsStorageAvailable] = useState<boolean | null>(
    null,
  );
  const [isUndoing, setIsUndoing] = useState(false);
  const [notice, setNotice] = useState<CounterNotice>(null);
  const [announcement, setAnnouncement] = useState("");
  const [reconciliationTarget, setReconciliationTarget] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustmentConfirmation, setAdjustmentConfirmation] = useState<{
    owner: AttendanceScopeOwnerToken;
    fingerprint: string;
  } | null>(null);
  const renderedScopeKey = scopeKey(scope);
  const currentScopeKeyRef = useRef(renderedScopeKey);
  const scopeOwnerRef = useRef<AttendanceScopeOwnerToken>({
    scopeKey: renderedScopeKey,
  });
  const [scopeStateOwner, setScopeStateOwner] = useState(
    scopeOwnerRef.current,
  );
  const syncingRef = useRef(false);
  const pendingSyncScopeRef = useRef<{
    targetScope: AttendanceScope;
    scopeOwner: AttendanceScopeOwnerToken;
  } | null>(null);
  const summaryAuthorityRef = useRef(createAttendanceSummaryAuthority());
  const undoingRef = useRef(false);
  const nextUndoOperationIdRef = useRef(0);
  const activeUndoOperationsRef = useRef(new Map<string, number>());
  const nextAdjustmentOperationIdRef = useRef(0);
  const activeAdjustmentOperationsRef = useRef(new Map<string, number>());
  const reconciliationAttemptRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  if (scopeOwnerRef.current.scopeKey !== renderedScopeKey) {
    scopeOwnerRef.current = { scopeKey: renderedScopeKey };
  }
  currentScopeKeyRef.current = renderedScopeKey;
  const summaryReadOwnerRef = useRef(createSummaryReadOwner(scopeOwnerRef.current));
  const summaryWritesRef = useRef(new Map<AttendanceScopeOwnerToken, number>());
  const pendingGuestMutationsRef = useRef(hasPendingGuestMutations);
  pendingGuestMutationsRef.current = hasPendingGuestMutations;
  if (summaryReadOwnerRef.current.scopeOwner !== scopeOwnerRef.current) {
    summaryReadOwnerRef.current = createSummaryReadOwner(scopeOwnerRef.current);
  }
  useEffect(() => () => {
    summaryReadOwnerRef.current = createSummaryReadOwner(scopeOwnerRef.current);
    invalidateAttendanceSummaries(summaryAuthorityRef.current);
  }, []);
  const isScopeStateCurrent = scopeStateOwner === scopeOwnerRef.current;

  const scopedSummary =
    isScopeStateCurrent &&
    summary &&
    scope &&
    isAttendanceScopeEqual(summary, scope)
      ? summary
      : null;
  const scopedMutations = useMemo(
    () => isScopeStateCurrent && scope
      ? mutations.filter((mutation) =>
          isAttendanceScopeEqual(mutation.scope, scope),
        )
      : [],
    [isScopeStateCurrent, mutations, scope],
  );
  const queuedMutations = useMemo(
    () => scopedMutations.filter((mutation) => mutation.state === "queued"),
    [scopedMutations],
  );
  const queuedMutationKey = useMemo(
    () => queuedMutations.map((mutation) => mutation.idempotencyKey).join("\n"),
    [queuedMutations],
  );
  const failedMutations = useMemo(
    () => scopedMutations.filter(
      (mutation) =>
        mutation.state === "conflict" ||
        mutation.state === "rejected" ||
        mutation.state === "scope_closed",
    ),
    [scopedMutations],
  );
  const localDelta = pendingAttendanceDelta(scopedMutations);
  const displayedCheckedInGuests =
    scopedSummary?.checkedInGuests ?? checkedInGuests;
  const walkIns = scopedSummary?.isFinalized
    ? scopedSummary.walkIns
    : Math.max(0, (scopedSummary?.walkIns ?? 0) + localDelta);
  const serverCheckedInGuests = scopedSummary?.checkedInGuests ?? 0;
  const serverWalkIns = scopedSummary?.walkIns ?? 0;
  const serverTotalAttendance = serverCheckedInGuests + serverWalkIns;
  const parsedReconciliationTarget = reconciliationTarget === ""
    ? null
    : Number(reconciliationTarget);
  const isReconciliationTargetInvalid =
    reconciliationTarget !== "" &&
    (parsedReconciliationTarget === null ||
      !Number.isSafeInteger(parsedReconciliationTarget) ||
      parsedReconciliationTarget < 0);
  const reconciliationDelta =
    !isReconciliationTargetInvalid &&
    parsedReconciliationTarget !== null
      ? parsedReconciliationTarget - serverTotalAttendance
      : null;
  const isReconciliationBelowCheckedGuests =
    parsedReconciliationTarget !== null &&
    parsedReconciliationTarget < serverCheckedInGuests;
  const isReconciliationDeltaOutOfRange =
    reconciliationDelta !== null && Math.abs(reconciliationDelta) > 500;
  const hasPendingReconciliationMutations =
    queuedMutations.length > 0 || hasPendingGuestMutations;
  const adjustmentFingerprint = scope && scopedSummary
    ? JSON.stringify([
        scope.venueId,
        scope.businessDate,
        scope.eventId,
        reconciliationTarget,
        adjustmentReason,
        scopedSummary.checkedInGuests,
        scopedSummary.walkIns,
        scopedSummary.sourceActivityCount,
        scopedSummary.isFinalized,
        scopedSummary.canFinalize,
        hasPendingReconciliationMutations,
        canAdjust,
      ])
    : null;
  const isAdjustmentConfirmationOpen = Boolean(
    isScopeStateCurrent &&
      adjustmentConfirmation?.owner === scopeOwnerRef.current &&
      adjustmentConfirmation?.fingerprint === adjustmentFingerprint,
  );

  useEffect(() => {
    if (adjustmentConfirmation && !isAdjustmentConfirmationOpen) {
      setAdjustmentConfirmation(null);
    }
  }, [adjustmentConfirmation, isAdjustmentConfirmationOpen]);
  const queuedReversalTargets = useMemo(
    () => new Set(
      queuedMutations.flatMap((mutation) =>
        mutation.action === "reversal" && mutation.reversesIdempotencyKey
          ? [mutation.reversesIdempotencyKey]
          : [],
      ),
    ),
    [queuedMutations],
  );
  const localUndoableKey = findLatestUndoableAttendanceKey(scopedMutations);
  const serverUndoableKey = scopedSummary?.lastUndoableIdempotencyKey;
  const undoableKey = localUndoableKey ?? (
    serverUndoableKey && !queuedReversalTargets.has(serverUndoableKey)
      ? serverUndoableKey
      : null
  );
  const isCurrentDate = scope?.businessDate === currentBusinessDate;
  const canRecord = Boolean(
    isScopeStateCurrent &&
    scope &&
    isCurrentDate &&
    isStorageAvailable !== false &&
    (scopedSummary?.canRecord ?? true),
  );

  const refreshLocalMutations = useCallback(async (
    targetScope: AttendanceScope,
    scopeOwner: AttendanceScopeOwnerToken,
  ) => {
    const next = await dependencies.listAttendanceMutations(targetScope);
    if (scopeOwnerRef.current === scopeOwner) {
      setMutations(next);
      setIsStorageAvailable(true);
    }
    return next;
  }, [dependencies]);

  const loadSummaryForOwner = useCallback(async function readSummary(
    targetScope: AttendanceScope,
    scopeOwner: AttendanceScopeOwnerToken,
  ): Promise<void> {
    const targetKey = scopeKey(targetScope);
    if (currentScopeKeyRef.current !== targetKey) return;
    if (scopeOwnerRef.current !== scopeOwner) return;
    const reader = summaryReadOwnerRef.current;
    if (
      pendingGuestMutationsRef.current ||
      summaryWritesRef.current.has(scopeOwner)
    ) {
      reader.pending = true;
      return;
    }
    if (reader.inFlight) {
      reader.pending = reader.inFlight.generation !== summaryAuthorityRef.current.generation;
      return reader.inFlight.promise;
    }
    reader.pending = false;
    const requestToken = beginAttendanceSummaryRead(summaryAuthorityRef.current);
    const isCurrentRequest = () =>
      summaryReadOwnerRef.current === reader &&
      scopeOwnerRef.current === scopeOwner &&
      isAttendanceSummaryReadCurrent(
        summaryAuthorityRef.current,
        requestToken,
      );
    const read = { generation: requestToken.generation, promise: Promise.resolve() };
    reader.inFlight = read;
    setIsLoading(true);
    read.promise = (async () => {
      try {
        let deviceId: string | null = null;
        try {
          deviceId = await dependencies.getAttendanceDeviceId();
          if (scopeOwnerRef.current === scopeOwner) {
            setIsStorageAvailable(true);
          }
        } catch {
          if (scopeOwnerRef.current === scopeOwner) {
            setIsStorageAvailable(false);
          }
        }
        if (!isCurrentRequest()) return;
        if (summaryWritesRef.current.has(scopeOwner) || pendingGuestMutationsRef.current) {
          reader.pending = true;
          return;
        }
        const response = await dependencies.fetchDoorAttendanceSummary({
          scope: targetScope,
          deviceId,
        });
        if (!isCurrentRequest()) return;
        if (response.error || !response.data) {
          setNotice("loadFailed");
        } else {
          const nextSummary = response.data;
          setSummary(nextSummary);
          setNotice((current) => current === "loadFailed" ? null : current);
        }
      } catch {
        if (isCurrentRequest()) setNotice("loadFailed");
      } finally {
        if (isCurrentRequest()) setIsLoading(false);
        reader.inFlight = null;
        if (summaryReadOwnerRef.current === reader && reader.pending &&
          canRefreshAutomatically()) {
          await readSummary(targetScope, scopeOwner);
        }
      }
    })();
    return read.promise;
  }, [dependencies]);

  const suspendSummaryReads = useCallback((
    targetScope: AttendanceScope,
    scopeOwner: AttendanceScopeOwnerToken,
  ) => {
    const writes = summaryWritesRef.current;
    writes.set(scopeOwner, (writes.get(scopeOwner) ?? 0) + 1);
    return (published: boolean) => {
      const remaining = (writes.get(scopeOwner) ?? 1) - 1;
      if (remaining) writes.set(scopeOwner, remaining);
      else writes.delete(scopeOwner);
      const reader = summaryReadOwnerRef.current;
      if (reader.scopeOwner !== scopeOwner) return;
      if (published && !pendingGuestMutationsRef.current) reader.pending = false;
      if (!remaining && reader.pending && canRefreshAutomatically()) {
        void loadSummaryForOwner(targetScope, scopeOwner);
      }
    };
  }, [loadSummaryForOwner]);

  const loadSummary = useCallback(async (targetScope: AttendanceScope) => {
    await loadSummaryForOwner(targetScope, scopeOwnerRef.current);
  }, [loadSummaryForOwner]);

  useEffect(() => {
    if (!scope) return;
    if (hasPendingGuestMutations) {
      invalidateAttendanceSummaries(summaryAuthorityRef.current);
      summaryReadOwnerRef.current.pending = true;
      setIsLoading(false);
    } else if (summaryReadOwnerRef.current.pending && canRefreshAutomatically()) {
      void loadSummary(scope);
    }
  }, [hasPendingGuestMutations, loadSummary, scope]);

  const syncQueue = useCallback(async function coordinateAttendanceSync(
    targetScope: AttendanceScope,
    inheritedVisibleSync = false,
  ): Promise<boolean> {
    const requestedScopeKey = scopeKey(targetScope);
    if (currentScopeKeyRef.current !== requestedScopeKey) {
      if (inheritedVisibleSync) setIsSyncing(false);
      return false;
    }
    const requestedSync = {
      targetScope,
      scopeOwner: scopeOwnerRef.current,
    };
    if (syncingRef.current) {
      pendingSyncScopeRef.current = requestedSync;
      return false;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (inheritedVisibleSync) setIsSyncing(false);
      return false;
    }
    syncingRef.current = true;
    const releaseSummaryReads = suspendSummaryReads(targetScope, requestedSync.scopeOwner);
    let publishedSummary = false;
    let hasVisibleSync = inheritedVisibleSync;
    let hasScopeVisibleSync = false;
    try {
      const pending = (
        await dependencies.listAttendanceMutations(targetScope)
      ).filter((mutation) => mutation.state === "queued");
      if (pending.length === 0) return false;
      hasScopeVisibleSync = true;
      hasVisibleSync = true;
      setIsSyncing(true);
      for (const group of dependencies.groupAttendanceMutationsByDevice(pending)) {
        for (
          let offset = 0;
          offset < group.mutations.length;
          offset += MAX_ATTENDANCE_SYNC_BATCH
        ) {
          const batch = group.mutations.slice(
            offset,
            offset + MAX_ATTENDANCE_SYNC_BATCH,
          );
          const summaryMutationToken =
            scopeOwnerRef.current === requestedSync.scopeOwner
              ? beginAttendanceSummaryMutation(summaryAuthorityRef.current)
              : null;
          if (summaryMutationToken) setIsLoading(false);
          const response = await dependencies.syncDoorAttendanceMutations({
            scope: targetScope,
            deviceId: group.deviceId,
            items: batch.map((mutation) => ({
              idempotencyKey: mutation.idempotencyKey,
              sequence: mutation.sequence,
              action: mutation.action,
              reversesIdempotencyKey: mutation.reversesIdempotencyKey,
              occurredAt: mutation.queuedAt,
            })),
          });
          const summaryMutationClaim =
            summaryMutationToken &&
            scopeOwnerRef.current === requestedSync.scopeOwner
              ? claimAttendanceSummaryMutation(
                  summaryAuthorityRef.current,
                  summaryMutationToken,
                )
              : null;
          if (summaryMutationClaim) setIsLoading(false);
          if (response.error || !response.data) {
            throw new Error("ATTENDANCE_SYNC_FAILED");
          }
          const removable: string[] = [];
          for (const result of response.data.items) {
            if (result.state === "confirmed" || result.state === "replayed") {
              removable.push(result.idempotencyKey);
            } else {
              await dependencies.resolveAttendanceMutation({
                idempotencyKey: result.idempotencyKey,
                state: result.state,
              });
            }
          }
          await dependencies.removeAttendanceMutations(removable);
          await refreshLocalMutations(
            targetScope,
            requestedSync.scopeOwner,
          );
          if (
            summaryMutationClaim &&
            scopeOwnerRef.current === requestedSync.scopeOwner &&
            isAttendanceSummaryMutationClaimCurrent(
              summaryAuthorityRef.current,
              summaryMutationClaim,
            )
          ) {
            setSummary(response.data.summary);
            publishedSummary = true;
          }
        }
      }
      if (scopeOwnerRef.current === requestedSync.scopeOwner) {
        setNotice((current) => current === "syncFailed" ? null : current);
      }
    } catch {
      if (scopeOwnerRef.current === requestedSync.scopeOwner) {
        if (hasScopeVisibleSync) {
          setNotice("syncFailed");
        } else {
          setIsStorageAvailable(false);
          setNotice("queueFailed");
        }
      }
    } finally {
      try {
        const pendingSync = pendingSyncScopeRef.current;
        pendingSyncScopeRef.current = null;
        if (
          pendingSync &&
          scopeOwnerRef.current === pendingSync.scopeOwner
        ) {
          syncingRef.current = false;
          const nextPublished = await coordinateAttendanceSync(
            pendingSync.targetScope,
            hasVisibleSync,
          );
          return nextPublished || (
            pendingSync.scopeOwner === requestedSync.scopeOwner && publishedSummary
          );
        }
        syncingRef.current = false;
        if (hasVisibleSync) setIsSyncing(false);
      } finally {
        releaseSummaryReads(publishedSummary);
      }
    }
    return publishedSummary;
  }, [dependencies, refreshLocalMutations, suspendSummaryReads]);

  useEffect(() => {
    const scopeOwner = scopeOwnerRef.current;
    setScopeStateOwner(scopeOwner);
    invalidateAttendanceSummaries(summaryAuthorityRef.current);
    setSummary(null);
    setMutations([]);
    setNotice(null);
    setAnnouncement("");
    setIsStorageAvailable(null);
    const hasActiveUndo = Boolean(
      scope && activeUndoOperationsRef.current.has(renderedScopeKey),
    );
    undoingRef.current = hasActiveUndo;
    setIsUndoing(hasActiveUndo);
    setIsAdjusting(Boolean(
      scope && activeAdjustmentOperationsRef.current.has(renderedScopeKey),
    ));
    setReconciliationTarget("");
    setAdjustmentReason("");
    setAdjustmentConfirmation(null);
    reconciliationAttemptRef.current = null;
    if (!scope) {
      setIsLoading(false);
      return;
    }
    const targetScope = scope;
    void Promise.all([
      refreshLocalMutations(targetScope, scopeOwner).catch(() => {
        if (scopeOwnerRef.current === scopeOwner) {
          setIsStorageAvailable(false);
          setNotice("queueFailed");
        }
      }),
      loadSummaryForOwner(targetScope, scopeOwner),
    ]);
  }, [loadSummaryForOwner, refreshLocalMutations, renderedScopeKey, scope]);

  useEffect(() => {
    if (!scope || queuedMutations.length === 0) return;
    void syncQueue(scope);
  }, [queuedMutationKey, queuedMutations.length, scope, syncQueue]);

  useEffect(() => {
    if (!scope) return;
    const targetScope = scope;
    const scopeOwner = scopeOwnerRef.current;
    let active = true;
    const refresh = async () => {
      if (!canRefreshAutomatically()) return;
      const published = await syncQueue(targetScope);
      if (!active || scopeOwnerRef.current !== scopeOwner ||
        !canRefreshAutomatically()) return;
      if (!published) await loadSummaryForOwner(targetScope, scopeOwner);
    };
    const handleOnline = () => { void refresh(); };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleOnline);
    const interval = window.setInterval(handleOnline, 15_000);
    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleOnline);
      window.clearInterval(interval);
    };
  }, [loadSummaryForOwner, scope, syncQueue]);

  const queueWalkIn = async () => {
    if (!scope || !canRecord) return;
    const scopeOwner = scopeOwnerRef.current;
    try {
      await dependencies.enqueueAttendanceMutation({
        scope,
        action: "walk_in",
      });
      await refreshLocalMutations(scope, scopeOwner);
      if (scopeOwnerRef.current === scopeOwner) {
        setNotice(null);
        setAnnouncement(translate("recordedAnnouncement"));
      }
    } catch {
      if (scopeOwnerRef.current === scopeOwner) {
        setIsStorageAvailable(false);
        setNotice("queueFailed");
      }
    }
  };

  const queueUndo = async () => {
    if (!scope || !canRecord || !undoableKey) return;
    const targetKey = scopeKey(scope);
    if (
      undoingRef.current ||
      activeUndoOperationsRef.current.has(targetKey)
    ) return;
    const scopeOwner = scopeOwnerRef.current;
    const undoOperationId = ++nextUndoOperationIdRef.current;
    activeUndoOperationsRef.current.set(targetKey, undoOperationId);
    undoingRef.current = true;
    setIsUndoing(true);
    try {
      await dependencies.enqueueAttendanceMutation({
        scope,
        action: "reversal",
        reversesIdempotencyKey: undoableKey,
      });
      await refreshLocalMutations(scope, scopeOwner);
      if (scopeOwnerRef.current === scopeOwner) {
        setNotice(null);
        setAnnouncement(translate("undoneAnnouncement"));
      }
    } catch {
      if (scopeOwnerRef.current === scopeOwner) {
        setIsStorageAvailable(false);
        setNotice("queueFailed");
      }
    } finally {
      if (
        activeUndoOperationsRef.current.get(targetKey) === undoOperationId
      ) {
        activeUndoOperationsRef.current.delete(targetKey);
        if (currentScopeKeyRef.current === targetKey) {
          undoingRef.current = false;
          setIsUndoing(false);
        }
      }
    }
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !isScopeStateCurrent ||
      !scope ||
      !canAdjust ||
      !scopedSummary ||
      scopedSummary.isFinalized ||
      !scopedSummary.canFinalize ||
      isReconciliationTargetInvalid ||
      isReconciliationBelowCheckedGuests ||
      isReconciliationDeltaOutOfRange ||
      reconciliationTarget === "" ||
      adjustmentReason.trim() === "" ||
      hasPendingReconciliationMutations
    ) return;
    const targetKey = scopeKey(scope);
    if (activeAdjustmentOperationsRef.current.has(targetKey)) return;
    if (!adjustmentFingerprint) return;
    if (!isAdjustmentConfirmationOpen) {
      setAdjustmentConfirmation({
        owner: scopeOwnerRef.current,
        fingerprint: adjustmentFingerprint,
      });
      return;
    }
    setAdjustmentConfirmation(null);
    const scopeOwner = scopeOwnerRef.current;
    const adjustmentOperationId = ++nextAdjustmentOperationIdRef.current;
    activeAdjustmentOperationsRef.current.set(
      targetKey,
      adjustmentOperationId,
    );
    const targetTotalAttendance = Number(reconciliationTarget);
    const attemptFingerprint = JSON.stringify([
      scope.venueId,
      scope.businessDate,
      scope.eventId,
      targetTotalAttendance,
      scopedSummary.checkedInGuests,
      scopedSummary.walkIns,
      scopedSummary.sourceActivityCount,
      adjustmentReason.trim(),
    ]);
    const existingAttempt = reconciliationAttemptRef.current;
    const idempotencyKey = existingAttempt?.fingerprint === attemptFingerprint
      ? existingAttempt.idempotencyKey
      : `admin-adjustment:${dependencies.randomUUID()}`;
    reconciliationAttemptRef.current = {
      fingerprint: attemptFingerprint,
      idempotencyKey,
    };
    setIsAdjusting(true);
    const releaseSummaryReads = suspendSummaryReads(scope, scopeOwner);
    let publishedSummary = false;
    const reconciliationToken = beginAttendanceSummaryMutation(
      summaryAuthorityRef.current,
    );
    setIsLoading(false);
    try {
      const response = await dependencies.reconcileDoorAttendance({
        scope,
        targetTotalAttendance,
        expectedCheckedInGuests: scopedSummary.checkedInGuests,
        expectedWalkIns: scopedSummary.walkIns,
        expectedSourceActivityCount: scopedSummary.sourceActivityCount,
        reason: adjustmentReason,
        idempotencyKey,
      });
      const reconciliationClaim = scopeOwnerRef.current === scopeOwner
        ? claimAttendanceSummaryMutation(
            summaryAuthorityRef.current,
            reconciliationToken,
          )
        : null;
      if (!reconciliationClaim) return;
      setIsLoading(false);
      if (response.error || !response.data) {
        if (response.error === "ATTENDANCE_RECONCILIATION_STALE") {
          reconciliationAttemptRef.current = null;
          setNotice("reconciliationStale");
          await loadSummaryForOwner(scope, scopeOwner);
        } else if (response.error === "ATTENDANCE_SCOPE_CLOSED") {
          reconciliationAttemptRef.current = null;
          setNotice("scopeClosed");
          await loadSummaryForOwner(scope, scopeOwner);
        } else {
          setNotice("adjustmentFailed");
        }
        return;
      }
      setSummary(response.data);
      publishedSummary = true;
      setReconciliationTarget("");
      setAdjustmentReason("");
      reconciliationAttemptRef.current = null;
      setNotice(null);
      setAnnouncement(translate("scopeClosed"));
    } catch {
      const reconciliationClaim = scopeOwnerRef.current === scopeOwner
        ? claimAttendanceSummaryMutation(
            summaryAuthorityRef.current,
            reconciliationToken,
          )
        : null;
      if (reconciliationClaim) {
        setIsLoading(false);
        setNotice("adjustmentFailed");
      }
    } finally {
      releaseSummaryReads(publishedSummary);
      if (
        activeAdjustmentOperationsRef.current.get(targetKey) ===
          adjustmentOperationId
      ) {
        activeAdjustmentOperationsRef.current.delete(targetKey);
        if (currentScopeKeyRef.current === targetKey) {
          setIsAdjusting(false);
        }
      }
    }
  };

  const clearFailedResults = async () => {
    if (!scope || !isScopeStateCurrent) return;
    const scopeOwner = scopeOwnerRef.current;
    try {
      await dependencies.clearResolvedAttendanceMutations(scope);
      await refreshLocalMutations(scope, scopeOwner);
      if (scopeOwnerRef.current === scopeOwner) setNotice(null);
    } catch {
      if (scopeOwnerRef.current === scopeOwner) setNotice("queueFailed");
    }
  };

  const changeReconciliationTarget = (value: string) => {
    if (!isScopeStateCurrent) return;
    reconciliationAttemptRef.current = null;
    setAdjustmentConfirmation(null);
    setReconciliationTarget(value);
  };

  const changeAdjustmentReason = (value: string) => {
    if (!isScopeStateCurrent) return;
    reconciliationAttemptRef.current = null;
    setAdjustmentConfirmation(null);
    setAdjustmentReason(value);
  };

  const visibleIsSyncing = isScopeStateCurrent && isSyncing;
  const statusText = visibleIsSyncing
    ? translate("syncing")
    : queuedMutations.length > 0
      ? translate("pending", { count: queuedMutations.length })
      : scopedSummary?.isFinalized
        ? translate("finalized")
        : null;
  const unavailableText = !scope
    ? translate("selectVenue")
    : !isCurrentDate || scopedSummary?.unavailableReason === "past_date"
      ? translate("pastDate")
      : scopedSummary?.unavailableReason === "event_inactive"
        ? translate("eventInactive")
        : scopedSummary?.unavailableReason === "scope_closed"
          ? translate("scopeClosed")
          : null;
  const visibleAdjustmentReason = isScopeStateCurrent ? adjustmentReason : "";
  const visibleAnnouncement = isScopeStateCurrent ? announcement : "";
  const visibleNotice = isScopeStateCurrent ? notice : null;
  const visibleReconciliationTarget = isScopeStateCurrent
    ? reconciliationTarget
    : "";

  return {
    adjustmentReason: visibleAdjustmentReason,
    announcement: visibleAnnouncement,
    canRecord,
    cancelAdjustmentConfirmation: () => setAdjustmentConfirmation(null),
    changeAdjustmentReason,
    changeReconciliationTarget,
    clearFailedResults,
    displayedCheckedInGuests,
    failedMutations,
    hasPendingReconciliationMutations,
    isAdjustmentConfirmationOpen,
    isAdjusting: isScopeStateCurrent && isAdjusting,
    isLoading: isScopeStateCurrent && isLoading,
    isReconciliationBelowCheckedGuests:
      isScopeStateCurrent && isReconciliationBelowCheckedGuests,
    isReconciliationDeltaOutOfRange:
      isScopeStateCurrent && isReconciliationDeltaOutOfRange,
    isReconciliationTargetInvalid:
      isScopeStateCurrent && isReconciliationTargetInvalid,
    isSyncing: visibleIsSyncing,
    isUndoing: isScopeStateCurrent && isUndoing,
    loadSummary,
    notice: visibleNotice,
    queueUndo,
    queueWalkIn,
    reconciliationDelta: isScopeStateCurrent ? reconciliationDelta : null,
    reconciliationTarget: visibleReconciliationTarget,
    scopedSummary,
    serverCheckedInGuests,
    serverWalkIns,
    statusText,
    submitAdjustment,
    unavailableText,
    undoableKey,
    walkIns,
  };
}
