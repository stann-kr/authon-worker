"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/components/AuthSessionProvider";
import {
  fetchDoorAttendanceSummary,
  reconcileDoorAttendance,
  syncDoorAttendanceMutations,
} from "@/lib/api/attendance";
import type { AttendanceScope } from "@/lib/attendance/domain";
import {
  clearResolvedAttendanceMutations,
  enqueueAttendanceMutation,
  getAttendanceDeviceId,
  groupAttendanceMutationsByDevice,
  listAttendanceMutations,
  removeAttendanceMutations,
  resolveAttendanceMutation,
} from "@/lib/attendance/offline-store";
import useAttendanceCounterController, {
  type AttendanceCounterDependencies,
} from "./useAttendanceCounterController";
import AttendanceReconciliationForm from "./AttendanceReconciliationForm";
import useMobileDockInset from "./useMobileDockInset";

interface AttendanceCounterProps {
  scope: AttendanceScope | null;
  currentBusinessDate: string;
  checkedInGuests: number;
  hasPendingGuestMutations: boolean;
}

const ATTENDANCE_COUNTER_DEPENDENCIES: AttendanceCounterDependencies =
  Object.freeze({
    fetchDoorAttendanceSummary,
    reconcileDoorAttendance,
    syncDoorAttendanceMutations,
    clearResolvedAttendanceMutations,
    enqueueAttendanceMutation,
    getAttendanceDeviceId,
    groupAttendanceMutationsByDevice,
    listAttendanceMutations,
    removeAttendanceMutations,
    resolveAttendanceMutation,
    confirm: (message: string) => window.confirm(message),
    randomUUID: () => crypto.randomUUID(),
  });

export default function AttendanceCounter({
  scope,
  currentBusinessDate,
  checkedInGuests,
  hasPendingGuestMutations,
}: AttendanceCounterProps) {
  const t = useTranslations("Door.attendance");
  const { user } = useAuthSession();
  const mobileDockRef = useRef<HTMLElement>(null);
  const canAdjust = user?.role === "super_admin" || user?.role === "venue_admin";
  const {
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
  } = useAttendanceCounterController({
    scope,
    currentBusinessDate,
    checkedInGuests,
    hasPendingGuestMutations,
    canAdjust,
    translate: t,
    dependencies: ATTENDANCE_COUNTER_DEPENDENCIES,
  });

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
        <AttendanceReconciliationForm
          scope={scope}
          scopedSummary={scopedSummary}
          serverCheckedInGuests={serverCheckedInGuests}
          serverWalkIns={serverWalkIns}
          reconciliationTarget={reconciliationTarget}
          reconciliationDelta={reconciliationDelta}
          adjustmentReason={adjustmentReason}
          hasPendingReconciliationMutations={hasPendingReconciliationMutations}
          isAdjusting={isAdjusting}
          isReconciliationTargetInvalid={isReconciliationTargetInvalid}
          isReconciliationBelowCheckedGuests={isReconciliationBelowCheckedGuests}
          isReconciliationDeltaOutOfRange={isReconciliationDeltaOutOfRange}
          changeReconciliationTarget={changeReconciliationTarget}
          changeAdjustmentReason={changeAdjustmentReason}
          loadSummary={loadSummary}
          submitAdjustment={submitAdjustment}
          translate={t}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}
