import type { FocusEvent, FormEvent, Ref } from "react";
import type { AttendanceScope } from "@/lib/attendance/domain";
import type { DoorAttendanceSummary } from "@/lib/attendance/types";

type AttendanceReconciliationTranslate = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

interface AttendanceReconciliationFormProps {
  scope: AttendanceScope;
  scopedSummary: DoorAttendanceSummary | null;
  serverCheckedInGuests: number;
  serverWalkIns: number;
  reconciliationTarget: string;
  reconciliationDelta: number | null;
  adjustmentReason: string;
  hasPendingReconciliationMutations: boolean;
  isAdjusting: boolean;
  isAdjustmentConfirmationOpen: boolean;
  cancelAdjustmentConfirmation: () => void;
  adjustmentSubmitRef: Ref<HTMLButtonElement>;
  adjustmentCancelRef: Ref<HTMLButtonElement>;
  isReconciliationTargetInvalid: boolean;
  isReconciliationBelowCheckedGuests: boolean;
  isReconciliationDeltaOutOfRange: boolean;
  changeReconciliationTarget: (value: string) => void;
  changeAdjustmentReason: (value: string) => void;
  loadSummary: (scope: AttendanceScope) => Promise<void>;
  submitAdjustment: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reconciliationStatusRef: Ref<HTMLParagraphElement>;
  markReconciliationFormFocused: () => void;
  markReconciliationFormBlurred: (
    event: FocusEvent<HTMLFormElement>,
  ) => void;
  translate: AttendanceReconciliationTranslate;
}

export default function AttendanceReconciliationForm({
  scope,
  scopedSummary,
  serverCheckedInGuests,
  serverWalkIns,
  reconciliationTarget,
  reconciliationDelta,
  adjustmentReason,
  hasPendingReconciliationMutations,
  isAdjusting,
  isAdjustmentConfirmationOpen,
  cancelAdjustmentConfirmation,
  adjustmentSubmitRef,
  adjustmentCancelRef,
  isReconciliationTargetInvalid,
  isReconciliationBelowCheckedGuests,
  isReconciliationDeltaOutOfRange,
  changeReconciliationTarget,
  changeAdjustmentReason,
  loadSummary,
  submitAdjustment,
  reconciliationStatusRef,
  markReconciliationFormFocused,
  markReconciliationFormBlurred,
  translate: t,
}: AttendanceReconciliationFormProps) {
  return (
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
        <p
          ref={reconciliationStatusRef}
          tabIndex={-1}
          className="mt-3 border-l-2 border-status-checked bg-status-checked/10 px-3 py-2 text-xs leading-relaxed text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          role="status"
        >
          {t("adjustment.finalized")}
        </p>
      ) : scopedSummary && !scopedSummary.canFinalize ? (
        <p
          ref={reconciliationStatusRef}
          tabIndex={-1}
          className="mt-3 border-l-2 border-status-waiting bg-status-waiting/10 px-3 py-2 text-xs leading-relaxed text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          role="status"
        >
          {t("adjustment.eventMustBeClosed")}
        </p>
      ) : (
        <form
          onSubmit={submitAdjustment}
          onFocusCapture={markReconciliationFormFocused}
          onBlurCapture={markReconciliationFormBlurred}
          onKeyDown={(event) => {
            if (event.key === "Escape" && isAdjustmentConfirmationOpen && !isAdjusting) {
              event.preventDefault();
              event.stopPropagation();
              cancelAdjustmentConfirmation();
            }
          }}
          className="mt-3 space-y-3"
        >
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
              onChange={(event) =>
                changeReconciliationTarget(event.target.value)
              }
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
              onChange={(event) => changeAdjustmentReason(event.target.value)}
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
          {isAdjustmentConfirmationOpen && (
            <p id="attendance-reconciliation-confirm" className="text-sm text-text-muted" role="status">
              {t("adjustment.confirm", { total: reconciliationTarget })}
            </p>
          )}
          {isAdjustmentConfirmationOpen && (
            <button
              ref={adjustmentCancelRef}
              type="button"
              onClick={cancelAdjustmentConfirmation}
              disabled={isAdjusting}
              className="pressable min-h-11 w-full border border-border-default px-4 py-2 text-sm font-semibold text-text-heading disabled:opacity-50"
            >
              {t("adjustment.cancel")}
            </button>
          )}
          <button
            ref={adjustmentSubmitRef}
            type="submit"
            aria-describedby={isAdjustmentConfirmationOpen ? "attendance-reconciliation-confirm" : undefined}
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
            {isAdjusting
              ? t("adjustment.saving")
              : isAdjustmentConfirmationOpen
                ? t("adjustment.save")
                : t("adjustment.review")}
          </button>
        </form>
      )}
    </details>
  );
}
