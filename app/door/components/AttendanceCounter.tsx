"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/components/AuthSessionProvider";
import {
  fetchDoorAttendanceSummary,
  reconcileDoorAttendance,
  syncDoorAttendanceMutations,
} from "@/lib/api/attendance";
import {
  MAX_ATTENDANCE_SYNC_BATCH,
  findLatestUndoableAttendanceKey,
  isAttendanceScopeEqual,
  pendingAttendanceDelta,
  type AttendanceScope,
  type OfflineAttendanceMutation,
} from "@/lib/attendance/domain";
import {
  clearResolvedAttendanceMutations,
  enqueueAttendanceMutation,
  getAttendanceDeviceId,
  groupAttendanceMutationsByDevice,
  listAttendanceMutations,
  removeAttendanceMutations,
  resolveAttendanceMutation,
} from "@/lib/attendance/offline-store";
import {
  beginAttendanceSummaryMutation,
  beginAttendanceSummaryRead,
  claimAttendanceSummaryMutation,
  createAttendanceSummaryAuthority,
  invalidateAttendanceSummaries,
  isAttendanceSummaryMutationClaimCurrent,
  isAttendanceSummaryReadCurrent,
} from "@/lib/attendance/summary-authority";
import type { DoorAttendanceSummary } from "@/lib/attendance/types";
import useMobileDockInset from "./useMobileDockInset";

interface AttendanceCounterProps {
  scope: AttendanceScope | null;
  currentBusinessDate: string;
  checkedInGuests: number;
  hasPendingGuestMutations: boolean;
}

type CounterNotice =
  | "loadFailed"
  | "queueFailed"
  | "syncFailed"
  | "adjustmentFailed"
  | "reconciliationStale"
  | "scopeClosed"
  | null;

function scopeKey(scope: AttendanceScope | null): string {
  return scope
    ? JSON.stringify([scope.venueId, scope.businessDate, scope.eventId])
    : "none";
}

export default function AttendanceCounter({
  scope,
  currentBusinessDate,
  checkedInGuests,
  hasPendingGuestMutations,
}: AttendanceCounterProps) {
  const t = useTranslations("Door.attendance");
  const { user } = useAuthSession();
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
  const mobileDockRef = useRef<HTMLElement>(null);
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

  const canAdjust = user?.role === "super_admin" || user?.role === "venue_admin";
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
    const next = await listAttendanceMutations(targetScope);
    if (currentScopeKeyRef.current === scopeKey(targetScope)) {
      setMutations(next);
      setIsStorageAvailable(true);
    }
    return next;
  }, []);

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
        deviceId = await getAttendanceDeviceId();
        if (currentScopeKeyRef.current === targetKey) {
          setIsStorageAvailable(true);
        }
      } catch {
        if (currentScopeKeyRef.current === targetKey) {
          setIsStorageAvailable(false);
        }
      }
      const response = await fetchDoorAttendanceSummary({
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
  }, []);

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
      const pending = (await listAttendanceMutations(targetScope)).filter(
        (mutation) => mutation.state === "queued",
      );
      if (pending.length === 0) return;
      hasVisibleSync = true;
      setIsSyncing(true);
      for (const group of groupAttendanceMutationsByDevice(pending)) {
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
          const response = await syncDoorAttendanceMutations({
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
              await resolveAttendanceMutation({
                idempotencyKey: result.idempotencyKey,
                state: result.state,
              });
            }
          }
          await removeAttendanceMutations(removable);
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
  }, [refreshLocalMutations]);

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
      await enqueueAttendanceMutation({ scope, action: "walk_in" });
      await refreshLocalMutations(scope);
      if (currentScopeKeyRef.current === targetKey) {
        setNotice(null);
        setAnnouncement(t("recordedAnnouncement"));
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
      await enqueueAttendanceMutation({
        scope,
        action: "reversal",
        reversesIdempotencyKey: undoableKey,
      });
      await refreshLocalMutations(scope);
      if (currentScopeKeyRef.current === targetKey) {
        setNotice(null);
        setAnnouncement(t("undoneAnnouncement"));
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
    if (!window.confirm(t("adjustment.confirm"))) return;
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
      : `admin-adjustment:${crypto.randomUUID()}`;
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
      const response = await reconcileDoorAttendance({
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
      setAnnouncement(t("scopeClosed"));
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
      await clearResolvedAttendanceMutations(scope);
      await refreshLocalMutations(scope);
      if (currentScopeKeyRef.current === targetKey) setNotice(null);
    } catch {
      setNotice("queueFailed");
    }
  };

  const statusText = isSyncing
    ? t("syncing")
    : queuedMutations.length > 0
      ? t("pending", { count: queuedMutations.length })
      : scopedSummary?.isFinalized
        ? t("finalized")
        : null;
  const unavailableText = !scope
    ? t("selectVenue")
    : !isCurrentDate || scopedSummary?.unavailableReason === "past_date"
      ? t("pastDate")
      : scopedSummary?.unavailableReason === "event_inactive"
        ? t("eventInactive")
        : scopedSummary?.unavailableReason === "scope_closed"
          ? t("scopeClosed")
          : null;

  useMobileDockInset(mobileDockRef);

  return (
    <>
      <section
        ref={mobileDockRef}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border-strong bg-canvas pb-[env(safe-area-inset-bottom)] md:sticky md:inset-x-auto md:bottom-auto md:top-[calc(var(--app-header-height)+1rem)] md:z-auto md:border"
        aria-labelledby="attendance-counter-title"
        aria-busy={isLoading || isSyncing}
      >
        <div className="mx-auto max-w-[1440px] px-3 py-1 sm:px-4 md:px-4 md:py-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
            <div className="min-w-0">
              <h2 id="attendance-counter-title" className="truncate text-xs font-semibold text-text-heading md:text-sm">
                {t("title")}
              </h2>
              {statusText && (
                <p className="mt-0.5 truncate text-[11px] leading-4 text-text-muted md:text-xs">
                  {statusText}
                </p>
              )}
            </div>
            <p className="shrink-0 text-[11px] leading-4 text-text-dim sm:text-xs md:hidden">
              {t("checkedInGuests")} {displayedCheckedInGuests} · {t("walkIns")} {walkIns}
            </p>
          </div>

          <dl className="mt-2 hidden grid-cols-2 gap-px bg-border-subtle text-center text-xs md:grid">
            <div className="bg-surface-raised px-2 py-2">
              <dt className="text-text-muted">{t("checkedInGuests")}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-text-heading">
                {displayedCheckedInGuests}
              </dd>
            </div>
            <div className="bg-surface-raised px-2 py-2">
              <dt className="text-text-muted">{t("walkIns")}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-text-heading">
                {walkIns}
              </dd>
            </div>
          </dl>

          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 md:mt-2 md:gap-2">
            <button
              type="button"
              onClick={() => void queueWalkIn()}
              disabled={!canRecord}
              aria-describedby={unavailableText ? "attendance-counter-unavailable" : undefined}
              className="pressable flex min-h-11 items-center justify-center gap-1.5 border border-action-primary bg-action-primary px-2 py-1 text-xs font-semibold text-action-text disabled:cursor-not-allowed disabled:opacity-50 md:min-h-14 md:gap-2 md:px-3 md:py-2 md:text-sm"
            >
              <span>{t("addWalkIn")}</span>
              <span className="font-mono text-xl leading-none md:text-2xl" aria-hidden="true">+1</span>
            </button>
            <button
              type="button"
              onClick={() => void queueUndo()}
              disabled={!canRecord || !undoableKey || isUndoing}
              className="pressable min-h-11 min-w-20 border border-border-default bg-surface-raised px-2 py-1 text-[11px] font-medium leading-tight text-text-heading disabled:cursor-not-allowed disabled:opacity-40 md:py-2 md:text-xs"
            >
              {t("undoLast")}
            </button>
          </div>
          {unavailableText && (
            <p
              id="attendance-counter-unavailable"
              className="mt-1 text-[11px] leading-4 text-text-dim md:text-xs md:leading-snug"
            >
              {unavailableText}
            </p>
          )}

          {notice && (
            <p className="mt-1 border-l-2 border-status-danger bg-status-danger/10 px-2 py-1.5 text-xs text-status-danger md:mt-1.5 md:px-3 md:py-2" role="alert">
              {t(`notice.${notice}`)}
            </p>
          )}
          {failedMutations.length > 0 && (
            <div className="mt-1 flex items-center justify-between gap-2 border-l-2 border-status-waiting bg-status-waiting/10 px-2 py-1.5 text-xs text-text-muted md:mt-1.5 md:gap-3 md:px-3 md:py-2">
              <span>{t("failedItems", { count: failedMutations.length })}</span>
              <button
                type="button"
                onClick={() => void clearFailedResults()}
                className="min-h-11 shrink-0 underline underline-offset-4"
              >
                {t("clearFailed")}
              </button>
            </div>
          )}
        </div>
      </section>

      {canAdjust && scope && (
        <details
          className="app-panel p-4 sm:p-5"
          onToggle={(event) => {
            if (event.currentTarget.open) void loadSummary(scope);
          }}
        >
          <summary className="pressable -mx-1 flex min-h-11 cursor-pointer list-none items-center px-1 text-sm font-semibold text-text-muted marker:hidden">
            {t("adjustment.title")}
          </summary>
          {scopedSummary?.isFinalized ? (
            <p className="mt-3 border-l-2 border-status-checked bg-status-checked/10 px-3 py-2 text-xs leading-relaxed text-text-muted" role="status">
              {t("adjustment.finalized")}
            </p>
          ) : scopedSummary && !scopedSummary.canFinalize ? (
            <p className="mt-3 border-l-2 border-status-waiting bg-status-waiting/10 px-3 py-2 text-xs leading-relaxed text-text-muted" role="status">
              {t("adjustment.eventMustBeClosed")}
            </p>
          ) : (
            <form onSubmit={submitAdjustment} className="mt-3 space-y-3">
            <p
              id="attendance-reconciliation-help"
              className="text-xs leading-relaxed text-text-dim"
            >
              {t("adjustment.help")}
            </p>
            {scopedSummary && (
              <p className="text-xs text-text-muted">
                {t("adjustment.current", {
                  checkedInGuests: serverCheckedInGuests,
                  walkIns: serverWalkIns,
                })}
              </p>
            )}
            <div>
              <label htmlFor="attendance-reconciliation-target" className="app-label">
                {t("adjustment.target")}
              </label>
              <input
                id="attendance-reconciliation-target"
                type="number"
                min={0}
                step={1}
                required
                name="manualTotalAttendance"
                autoComplete="off"
                inputMode="numeric"
                value={reconciliationTarget}
                aria-describedby="attendance-reconciliation-help attendance-reconciliation-feedback"
                aria-invalid={
                  isReconciliationTargetInvalid ||
                  isReconciliationBelowCheckedGuests ||
                  isReconciliationDeltaOutOfRange
                }
                onChange={(event) => {
                  reconciliationAttemptRef.current = null;
                  setReconciliationTarget(event.target.value);
                }}
                className="app-field"
              />
            </div>
            <p
              id="attendance-reconciliation-feedback"
              className={`text-xs ${
                isReconciliationBelowCheckedGuests ||
                isReconciliationDeltaOutOfRange
                  ? "text-status-danger"
                  : "text-text-muted"
              }`}
              role="status"
            >
              {!scopedSummary
                ? t("adjustment.currentUnavailable")
                : isReconciliationTargetInvalid
                  ? t("adjustment.invalidTarget")
                : isReconciliationBelowCheckedGuests
                  ? t("adjustment.belowCheckedGuests", {
                      checkedInGuests: serverCheckedInGuests,
                    })
                  : isReconciliationDeltaOutOfRange
                    ? t("adjustment.deltaLimit")
                    : reconciliationDelta === 0
                      ? t("adjustment.zeroDelta")
                    : reconciliationDelta !== null
                      ? t("adjustment.preview", {
                          delta: reconciliationDelta > 0
                            ? `+${reconciliationDelta}`
                            : reconciliationDelta,
                        })
                      : t("adjustment.enterTarget")}
            </p>
            <div>
              <label htmlFor="attendance-adjustment-reason" className="app-label">
                {t("adjustment.reason")}
              </label>
              <input
                id="attendance-adjustment-reason"
                type="text"
                maxLength={500}
                required
                name="manualAdjustmentReason"
                autoComplete="off"
                value={adjustmentReason}
                aria-describedby="attendance-adjustment-reason-help"
                onChange={(event) => {
                  reconciliationAttemptRef.current = null;
                  setAdjustmentReason(event.target.value);
                }}
                className="app-field"
              />
              <p
                id="attendance-adjustment-reason-help"
                className="mt-1 text-xs text-text-dim"
              >
                {t("adjustment.reasonHelp")}
              </p>
            </div>
            {hasPendingReconciliationMutations && (
              <p className="text-xs text-status-waiting" role="status">
                {t("adjustment.syncFirst")}
              </p>
            )}
            <button
              type="submit"
              disabled={
                isAdjusting ||
                !scopedSummary ||
                hasPendingReconciliationMutations ||
                reconciliationTarget === "" ||
                reconciliationDelta === null ||
                isReconciliationTargetInvalid ||
                isReconciliationDeltaOutOfRange ||
                isReconciliationBelowCheckedGuests ||
                adjustmentReason.trim() === ""
              }
              className="pressable min-h-11 w-full border border-border-strong bg-surface-raised px-4 py-2 text-sm font-semibold text-text-heading disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAdjusting ? t("adjustment.saving") : t("adjustment.save")}
            </button>
            </form>
          )}
        </details>
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}
