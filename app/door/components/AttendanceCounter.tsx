"use client";

import { fetchDoorAttendanceSummary } from "@/lib/attendance/client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/components/AuthSessionProvider";
import {
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
import Sheet from "@/components/overlays/Sheet";
import Button from "@/components/Button";

interface AttendanceCounterProps {
  scope: AttendanceScope | null;
  currentBusinessDate: string;
  checkedInGuests: number;
  hasPendingGuestMutations: boolean;
  children: (actions: ReactNode, details: ReactNode) => ReactNode;
  dependencies?: AttendanceCounterDependencies;
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
    randomUUID: () => crypto.randomUUID(),
  });

export default function AttendanceCounter({
  scope,
  currentBusinessDate,
  checkedInGuests,
  hasPendingGuestMutations,
  children,
  dependencies = ATTENDANCE_COUNTER_DEPENDENCIES,
}: AttendanceCounterProps) {
  const t = useTranslations("Door.attendance");
  const { user } = useAuthSession();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const reconciliationStatusRef = useRef<HTMLParagraphElement>(null);
  const adjustmentSubmitRef = useRef<HTMLButtonElement>(null);
  const adjustmentCancelRef = useRef<HTMLButtonElement>(null);
  const reconciliationFormHadFocusRef = useRef(false);
  const reconciliationFormWasVisibleRef = useRef(false);
  const canAdjust = user?.role === "super_admin" || user?.role === "venue_admin";
  const {
    adjustmentReason,
    announcement,
    canRecord,
    cancelAdjustmentConfirmation,
    changeAdjustmentReason,
    changeReconciliationTarget,
    clearFailedResults,
    displayedCheckedInGuests,
    failedMutations,
    hasPendingReconciliationMutations,
    isAdjusting,
    isAdjustmentConfirmationOpen,
    isLoading,
    isReconciliationBelowCheckedGuests,
    isReconciliationDeltaOutOfRange,
    isReconciliationTargetInvalid,
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
    dependencies,
  });


  useLayoutEffect(() => {
    if (isAdjustmentConfirmationOpen) adjustmentCancelRef.current?.focus();
  }, [isAdjustmentConfirmationOpen]);

  const isReconciliationFormVisible = Boolean(
    !scopedSummary ||
      (!scopedSummary.isFinalized && scopedSummary.canFinalize),
  );

  useLayoutEffect(() => {
    if (isReconciliationFormVisible) {
      reconciliationFormWasVisibleRef.current = true;
      return;
    }

    const shouldMoveFocus =
      reconciliationFormWasVisibleRef.current &&
      reconciliationFormHadFocusRef.current;
    reconciliationFormWasVisibleRef.current = false;
    reconciliationFormHadFocusRef.current = false;
    if (!shouldMoveFocus) return;

    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement !== document.body &&
      activeElement.isConnected
    ) {
      return;
    }
    reconciliationStatusRef.current?.focus({ preventScroll: true });
  }, [isReconciliationFormVisible]);

  const actions = <>
    <button type="button" className="workspace-action workspace-action-primary" onClick={() => void queueWalkIn()}
      disabled={!canRecord} aria-describedby={unavailableText ? "attendance-counter-unavailable" : undefined}>
      {t("addWalkIn")} +1
    </button>
    <button type="button" className="workspace-action" onClick={() => setDetailsOpen(true)} aria-haspopup="dialog">
      {t("title")} · {isLoading ? "—" : displayedCheckedInGuests + walkIns}
    </button>
  </>;
  const details = <>
    {unavailableText && <p id="attendance-counter-unavailable" className="text-xs text-text-muted">{unavailableText}</p>}
    {statusText && <p className="text-xs text-text-muted" role="status">{statusText}</p>}
    {notice && <p className="text-sm text-status-danger" role="alert">{t(`notice.${notice}`)}</p>}
    {failedMutations.length > 0 && <button type="button" className="text-left text-xs text-status-waiting" onClick={() => setDetailsOpen(true)}>
      {t("failedItems", { count: failedMutations.length })}
    </button>}
    <Sheet open={detailsOpen} title={t("title")} onClose={() => setDetailsOpen(false)}
      busy={isAdjusting} protectEdits>
      <dl className="product-detail-list">
        <div><dt>{t("checkedInGuests")}</dt><dd>{displayedCheckedInGuests}</dd></div>
        <div><dt>{t("walkIns")}</dt><dd>{walkIns}</dd></div>
      </dl>
      <Button variant="outline" onClick={() => void queueUndo()} disabled={!canRecord || !undoableKey || isUndoing}>
        {t("undoLast")}
      </Button>
      {notice && <p className="text-sm text-status-danger" role="alert">{t(`notice.${notice}`)}</p>}
      {failedMutations.length > 0 && <div className="space-y-2">
        <p className="text-sm text-status-waiting">{t("failedItems", { count: failedMutations.length })}</p>
        <Button variant="outline" onClick={() => void clearFailedResults()}>{t("clearFailed")}</Button>
      </div>}
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
          isAdjustmentConfirmationOpen={isAdjustmentConfirmationOpen}
          adjustmentSubmitRef={adjustmentSubmitRef}
          adjustmentCancelRef={adjustmentCancelRef}
          cancelAdjustmentConfirmation={() => {
            cancelAdjustmentConfirmation();
            adjustmentSubmitRef.current?.focus({ preventScroll: true });
          }}
          isReconciliationTargetInvalid={isReconciliationTargetInvalid}
          isReconciliationBelowCheckedGuests={isReconciliationBelowCheckedGuests}
          isReconciliationDeltaOutOfRange={isReconciliationDeltaOutOfRange}
          changeReconciliationTarget={changeReconciliationTarget}
          changeAdjustmentReason={changeAdjustmentReason}
          loadSummary={loadSummary}
          submitAdjustment={submitAdjustment}
          reconciliationStatusRef={reconciliationStatusRef}
          markReconciliationFormFocused={() => {
            reconciliationFormHadFocusRef.current = true;
          }}
          markReconciliationFormBlurred={(event) => {
            const nextTarget = event.relatedTarget;
            if (
              nextTarget instanceof Node &&
              !event.currentTarget.contains(nextTarget)
            ) {
              reconciliationFormHadFocusRef.current = false;
            }
          }}
          translate={t}
        />
      )}


    </Sheet>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
  </>;
  return children(actions, details);
}
