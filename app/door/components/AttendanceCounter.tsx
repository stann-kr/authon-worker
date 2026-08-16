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
  adjustDoorAttendance,
  fetchDoorAttendanceSummary,
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
import type { DoorAttendanceSummary } from "@/lib/attendance/types";

interface AttendanceCounterProps {
  scope: AttendanceScope | null;
  currentBusinessDate: string;
  checkedInGuests: number;
}

type CounterNotice =
  | "loadFailed"
  | "queueFailed"
  | "syncFailed"
  | "adjustmentFailed"
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
  const [adjustmentDelta, setAdjustmentDelta] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);
  const currentScopeKeyRef = useRef(scopeKey(scope));
  const syncingRef = useRef(false);
  const pendingSyncScopeRef = useRef<AttendanceScope | null>(null);
  const syncQueueRef = useRef<(
    targetScope: AttendanceScope,
  ) => Promise<void>>(async () => {});
  const undoingRef = useRef(false);
  const adjustmentIdempotencyKeyRef = useRef<string | null>(null);
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
      (mutation) => mutation.state === "conflict" || mutation.state === "rejected",
    ),
    [scopedMutations],
  );
  const localDelta = pendingAttendanceDelta(scopedMutations);
  const walkIns = Math.max(0, (scopedSummary?.walkIns ?? 0) + localDelta);
  const totalAttendance = checkedInGuests + walkIns;
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
      if (currentScopeKeyRef.current !== targetKey) return;
      if (response.error || !response.data) {
        setNotice("loadFailed");
      } else {
        setSummary(response.data);
        setNotice((current) => current === "loadFailed" ? null : current);
      }
    } catch {
      if (currentScopeKeyRef.current === targetKey) setNotice("loadFailed");
    } finally {
      if (currentScopeKeyRef.current === targetKey) setIsLoading(false);
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
          if (currentScopeKeyRef.current === targetKey) {
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
    setSummary(null);
    setMutations([]);
    setNotice(null);
    setAnnouncement("");
    setIsStorageAvailable(null);
    setAdjustmentDelta("");
    setAdjustmentReason("");
    adjustmentIdempotencyKeyRef.current = null;
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
        setAnnouncement(t("recordedAnnouncement", {
          count: totalAttendance + 1,
        }));
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
        setAnnouncement(t("undoneAnnouncement", {
          count: Math.max(0, totalAttendance - 1),
        }));
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
    if (!scope || !canAdjust || queuedMutations.length > 0) return;
    const delta = Number(adjustmentDelta);
    const idempotencyKey =
      adjustmentIdempotencyKeyRef.current ??
      `admin-adjustment:${crypto.randomUUID()}`;
    adjustmentIdempotencyKeyRef.current = idempotencyKey;
    const targetKey = scopeKey(scope);
    setIsAdjusting(true);
    try {
      const response = await adjustDoorAttendance({
        scope,
        delta,
        reason: adjustmentReason,
        idempotencyKey,
      });
      if (response.error || !response.data) {
        if (currentScopeKeyRef.current === targetKey) {
          setNotice("adjustmentFailed");
        }
        return;
      }
      if (currentScopeKeyRef.current !== targetKey) return;
      setSummary(response.data);
      setAdjustmentDelta("");
      setAdjustmentReason("");
      adjustmentIdempotencyKeyRef.current = null;
      setNotice(null);
      setAnnouncement(t("adjustedAnnouncement", {
        count: checkedInGuests + response.data.walkIns,
      }));
    } catch {
      if (currentScopeKeyRef.current === targetKey) {
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
      : t("confirmed");
  const unavailableText = !scope
    ? t("selectVenue")
    : !isCurrentDate || scopedSummary?.unavailableReason === "past_date"
      ? t("pastDate")
      : scopedSummary?.unavailableReason === "event_inactive"
        ? t("eventInactive")
        : null;

  return (
    <>
      <section
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border-strong bg-canvas pb-[env(safe-area-inset-bottom)] md:sticky md:inset-x-auto md:bottom-auto md:top-[calc(var(--app-header-height)+1rem)] md:z-auto md:border"
        aria-labelledby="attendance-counter-title"
        aria-busy={isLoading || isSyncing}
      >
        <div className="mx-auto max-w-[1440px] px-4 py-3 sm:px-6 md:px-4 md:py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="attendance-counter-title" className="text-sm font-semibold text-text-heading">
                {t("title")}
              </h2>
              <p className="mt-1 text-xs text-text-muted">{statusText}</p>
              <p className="mt-1 text-xs text-text-dim md:hidden">
                {t("checkedInGuests")} {checkedInGuests} · {t("walkIns")} {walkIns}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-muted">{t("totalAttendance")}</p>
              <p className="font-mono text-3xl font-semibold tabular-nums text-text-heading">
                {totalAttendance}
              </p>
            </div>
          </div>

          <dl className="mt-3 hidden grid-cols-2 gap-px bg-border-subtle text-center text-xs md:grid">
            <div className="bg-surface-raised px-2 py-2">
              <dt className="text-text-muted">{t("checkedInGuests")}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-text-heading">
                {checkedInGuests}
              </dd>
            </div>
            <div className="bg-surface-raised px-2 py-2">
              <dt className="text-text-muted">{t("walkIns")}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-text-heading">
                {walkIns}
              </dd>
            </div>
          </dl>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <button
              type="button"
              onClick={() => void queueWalkIn()}
              disabled={!canRecord}
              aria-describedby="attendance-counter-help"
              className="pressable flex min-h-[4.5rem] items-center justify-center gap-3 border border-action-primary bg-action-primary px-4 py-3 font-semibold text-action-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>{t("addWalkIn")}</span>
              <span className="font-mono text-3xl leading-none" aria-hidden="true">+1</span>
            </button>
            <button
              type="button"
              onClick={() => void queueUndo()}
              disabled={!canRecord || !undoableKey || isUndoing}
              className="pressable min-h-14 min-w-24 border border-border-default bg-surface-raised px-3 py-2 text-xs font-medium text-text-heading disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("undoLast")}
            </button>
          </div>
          <p id="attendance-counter-help" className="mt-2 text-xs leading-relaxed text-text-dim">
            {unavailableText ?? t("helper")}
          </p>

          {notice && (
            <p className="mt-2 border-l-2 border-status-danger bg-status-danger/10 px-3 py-2 text-xs text-status-danger" role="alert">
              {t(`notice.${notice}`)}
            </p>
          )}
          {failedMutations.length > 0 && (
            <div className="mt-2 flex items-center justify-between gap-3 border-l-2 border-status-waiting bg-status-waiting/10 px-3 py-2 text-xs text-text-muted">
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
        <details className="app-panel p-4 sm:p-5">
          <summary className="pressable -mx-1 flex min-h-11 cursor-pointer list-none items-center px-1 text-sm font-semibold text-text-muted marker:hidden">
            {t("adjustment.title")}
          </summary>
          <form onSubmit={submitAdjustment} className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-text-dim">
              {t("adjustment.help")}
            </p>
            <div>
              <label htmlFor="attendance-adjustment-delta" className="app-label">
                {t("adjustment.delta")}
              </label>
              <input
                id="attendance-adjustment-delta"
                type="number"
                min={-500}
                max={500}
                step={1}
                required
                value={adjustmentDelta}
                onChange={(event) => {
                  adjustmentIdempotencyKeyRef.current = null;
                  setAdjustmentDelta(event.target.value);
                }}
                className="app-field"
              />
            </div>
            <div>
              <label htmlFor="attendance-adjustment-reason" className="app-label">
                {t("adjustment.reason")}
              </label>
              <input
                id="attendance-adjustment-reason"
                type="text"
                maxLength={500}
                required
                value={adjustmentReason}
                onChange={(event) => {
                  adjustmentIdempotencyKeyRef.current = null;
                  setAdjustmentReason(event.target.value);
                }}
                className="app-field"
              />
            </div>
            {queuedMutations.length > 0 && (
              <p className="text-xs text-status-waiting" role="status">
                {t("adjustment.syncFirst")}
              </p>
            )}
            <button
              type="submit"
              disabled={
                isAdjusting ||
                queuedMutations.length > 0 ||
                adjustmentDelta === "" ||
                adjustmentReason.trim() === ""
              }
              className="pressable min-h-11 w-full border border-border-strong bg-surface-raised px-4 py-2 text-sm font-semibold text-text-heading disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAdjusting ? t("adjustment.saving") : t("adjustment.save")}
            </button>
          </form>
        </details>
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}
