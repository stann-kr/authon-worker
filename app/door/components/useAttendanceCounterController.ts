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
  confirm: (message: string) => boolean;
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
  const currentScopeKeyRef = useRef(scopeKey(scope));
  const syncingRef = useRef(false);
  const pendingSyncScopeRef = useRef<AttendanceScope | null>(null);
  const summaryAuthorityRef = useRef(createAttendanceSummaryAuthority());
  const syncQueueRef = useRef<(
    targetScope: AttendanceScope,
  ) => Promise<void>>(async () => {});
  const undoingRef = useRef(false);
  const reconciliationAttemptRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  currentScopeKeyRef.current = scopeKey(scope);

  const scopedSummary = summary && scope && isAttendanceScopeEqual(summary, scope)
    ? summary
    : null;
  const scopedMutations = useMemo(
    () => scope
      ? mutations.filter((mutation) =>
          isAttendanceScopeEqual(mutation.scope, scope),
        )
      : [],
    [mutations, scope],
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
    scope &&
    isCurrentDate &&
    isStorageAvailable !== false &&
    (scopedSummary?.canRecord ?? true),
  );

  const refreshLocalMutations = useCallback(async (
    targetScope: AttendanceScope,
  ) => {
    const next = await dependencies.listAttendanceMutations(targetScope);
    if (currentScopeKeyRef.current === scopeKey(targetScope)) {
      setMutations(next);
      setIsStorageAvailable(true);
    }
    return next;
  }, [dependencies]);

  const loadSummary = useCallback(async (targetScope: AttendanceScope) => {
    const targetKey = scopeKey(targetScope);
    if (currentScopeKeyRef.current !== targetKey) return;
    const requestToken = beginAttendanceSummaryRead(summaryAuthorityRef.current);
    const isCurrentRequest = () =>
      currentScopeKeyRef.current === targetKey &&
      isAttendanceSummaryReadCurrent(
        summaryAuthorityRef.current,
        requestToken,
      );
    setIsLoading(true);
    try {
      let deviceId: string | null = null;
      try {
        deviceId = await dependencies.getAttendanceDeviceId();
        if (currentScopeKeyRef.current === targetKey) {
          setIsStorageAvailable(true);
        }
      } catch {
        if (currentScopeKeyRef.current === targetKey) {
          setIsStorageAvailable(false);
        }
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
    }
  }, [dependencies]);

  const syncQueue = useCallback(async (targetScope: AttendanceScope) => {
    if (syncingRef.current) {
      pendingSyncScopeRef.current = targetScope;
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    syncingRef.current = true;
    let hasVisibleSync = false;
    const targetKey = scopeKey(targetScope);
    try {
      const pending = (
        await dependencies.listAttendanceMutations(targetScope)
      ).filter((mutation) => mutation.state === "queued");
      if (pending.length === 0) return;
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
            currentScopeKeyRef.current === targetKey
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
            summaryMutationToken && currentScopeKeyRef.current === targetKey
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
          await refreshLocalMutations(targetScope);
          if (
            summaryMutationClaim &&
            currentScopeKeyRef.current === targetKey &&
            isAttendanceSummaryMutationClaimCurrent(
              summaryAuthorityRef.current,
              summaryMutationClaim,
            )
          ) {
            setSummary(response.data.summary);
          }
        }
      }
      if (currentScopeKeyRef.current === targetKey) {
        setNotice((current) => current === "syncFailed" ? null : current);
      }
    } catch {
      if (currentScopeKeyRef.current === targetKey) {
        if (hasVisibleSync) {
          setNotice("syncFailed");
        } else {
          setIsStorageAvailable(false);
          setNotice("queueFailed");
        }
      }
    } finally {
      syncingRef.current = false;
      if (hasVisibleSync) setIsSyncing(false);
      const pendingScope = pendingSyncScopeRef.current;
      pendingSyncScopeRef.current = null;
      if (
        pendingScope &&
        currentScopeKeyRef.current === scopeKey(pendingScope)
      ) {
        queueMicrotask(() => void syncQueueRef.current(pendingScope));
      }
    }
  }, [dependencies, refreshLocalMutations]);

  useEffect(() => {
    syncQueueRef.current = syncQueue;
  }, [syncQueue]);

  useEffect(() => {
    invalidateAttendanceSummaries(summaryAuthorityRef.current);
    setSummary(null);
    setMutations([]);
    setNotice(null);
    setAnnouncement("");
    setIsStorageAvailable(null);
    setReconciliationTarget("");
    setAdjustmentReason("");
    reconciliationAttemptRef.current = null;
    if (!scope) {
      setIsLoading(false);
      return;
    }
    const targetScope = scope;
    void Promise.all([
      refreshLocalMutations(targetScope).catch(() => {
        if (currentScopeKeyRef.current === scopeKey(targetScope)) {
          setIsStorageAvailable(false);
          setNotice("queueFailed");
        }
      }),
      loadSummary(targetScope),
    ]);
  }, [loadSummary, refreshLocalMutations, scope]);

  useEffect(() => {
    if (!scope || queuedMutations.length === 0) return;
    void syncQueue(scope);
  }, [queuedMutationKey, queuedMutations.length, scope, syncQueue]);

  useEffect(() => {
    if (!scope) return;
    const targetScope = scope;
    const handleOnline = () => {
      void syncQueue(targetScope);
      void loadSummary(targetScope);
    };
    window.addEventListener("online", handleOnline);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void syncQueue(targetScope);
        void loadSummary(targetScope);
      }
    }, 15_000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.clearInterval(interval);
    };
  }, [loadSummary, scope, syncQueue]);

  const queueWalkIn = async () => {
    if (!scope || !canRecord) return;
    const targetKey = scopeKey(scope);
    try {
      await dependencies.enqueueAttendanceMutation({
        scope,
        action: "walk_in",
      });
      await refreshLocalMutations(scope);
      if (currentScopeKeyRef.current === targetKey) {
        setNotice(null);
        setAnnouncement(translate("recordedAnnouncement"));
      }
    } catch {
      setIsStorageAvailable(false);
      setNotice("queueFailed");
    }
  };

  const queueUndo = async () => {
    if (!scope || !canRecord || !undoableKey || undoingRef.current) return;
    const targetKey = scopeKey(scope);
    undoingRef.current = true;
    setIsUndoing(true);
    try {
      await dependencies.enqueueAttendanceMutation({
        scope,
        action: "reversal",
        reversesIdempotencyKey: undoableKey,
      });
      await refreshLocalMutations(scope);
      if (currentScopeKeyRef.current === targetKey) {
        setNotice(null);
        setAnnouncement(translate("undoneAnnouncement"));
      }
    } catch {
      setIsStorageAvailable(false);
      setNotice("queueFailed");
    } finally {
      undoingRef.current = false;
      setIsUndoing(false);
    }
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
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
    if (!dependencies.confirm(translate("adjustment.confirm"))) return;
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
    const targetKey = scopeKey(scope);
    setIsAdjusting(true);
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
      const reconciliationClaim = currentScopeKeyRef.current === targetKey
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
          await loadSummary(scope);
        } else if (response.error === "ATTENDANCE_SCOPE_CLOSED") {
          reconciliationAttemptRef.current = null;
          setNotice("scopeClosed");
          await loadSummary(scope);
        } else {
          setNotice("adjustmentFailed");
        }
        return;
      }
      setSummary(response.data);
      setReconciliationTarget("");
      setAdjustmentReason("");
      reconciliationAttemptRef.current = null;
      setNotice(null);
      setAnnouncement(translate("scopeClosed"));
    } catch {
      const reconciliationClaim = currentScopeKeyRef.current === targetKey
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
      setIsAdjusting(false);
    }
  };

  const clearFailedResults = async () => {
    if (!scope) return;
    const targetKey = scopeKey(scope);
    try {
      await dependencies.clearResolvedAttendanceMutations(scope);
      await refreshLocalMutations(scope);
      if (currentScopeKeyRef.current === targetKey) setNotice(null);
    } catch {
      setNotice("queueFailed");
    }
  };

  const changeReconciliationTarget = (value: string) => {
    reconciliationAttemptRef.current = null;
    setReconciliationTarget(value);
  };

  const changeAdjustmentReason = (value: string) => {
    reconciliationAttemptRef.current = null;
    setAdjustmentReason(value);
  };

  const statusText = isSyncing
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

  return {
    adjustmentReason,
    announcement,
    canRecord,
    changeAdjustmentReason,
    changeReconciliationTarget,
    clearFailedResults,
    displayedCheckedInGuests,
    failedMutations,
    hasPendingReconciliationMutations,
    isAdjusting,
    isLoading,
    isReconciliationBelowCheckedGuests,
    isReconciliationDeltaOutOfRange,
    isReconciliationTargetInvalid,
    isSyncing,
    isUndoing,
    loadSummary,
    notice,
    queueUndo,
    queueWalkIn,
    reconciliationDelta,
    reconciliationTarget,
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
