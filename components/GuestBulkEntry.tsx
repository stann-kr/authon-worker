"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Button from "./Button";
import Icon from "./Icon";
import type {
  ApiResponse,
  BulkGuestCreateInput,
  BulkGuestCreateResult,
  BulkGuestCreateStatus,
} from "@/lib/api/types";
import {
  MAX_BULK_INPUT_CHARACTERS,
  parseBulkGuestInput,
  toRetainedBulkGuestLineText,
  toStoredGuestName,
} from "@/lib/guests/bulk-entry";

interface GuestBulkEntryProps {
  existingNames: string[];
  remaining: number | null;
  disabled?: boolean;
  onSubmitChunk: (
    guests: BulkGuestCreateInput[],
  ) => Promise<ApiResponse<BulkGuestCreateResult>>;
  onSubmissionComplete?: () => Promise<void> | void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
}

type FeedbackTone = "success" | "warning" | "error";

interface FeedbackState {
  tone: FeedbackTone;
  message: string;
  invalidInput?: boolean;
}

function feedbackClasses(tone: FeedbackTone): string {
  if (tone === "success") {
    return "border-status-checked/70 bg-status-checked/10 text-status-checked";
  }
  if (tone === "warning") {
    return "border-status-waiting/70 bg-status-waiting/10 text-status-waiting";
  }
  return "border-status-danger/70 bg-status-danger/10 text-status-danger";
}

export default function GuestBulkEntry({
  existingNames,
  remaining,
  disabled = false,
  onSubmitChunk,
  onSubmissionComplete,
  onSubmittingChange,
}: GuestBulkEntryProps) {
  const t = useTranslations("BulkGuestEntry");
  const fieldId = useId();
  const helperId = `${fieldId}-helper`;
  const previewStatusId = `${fieldId}-preview-status`;
  const overflowWarningId = `${fieldId}-overflow-warning`;
  const capacityWarningId = `${fieldId}-capacity-warning`;
  const feedbackId = `${fieldId}-feedback`;
  const [rawInput, setRawInput] = useState("");
  const [duplicateOverrides, setDuplicateOverrides] = useState<Set<number>>(
    () => new Set(),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const isMountedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldRestoreFocusRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const preview = useMemo(
    () => parseBulkGuestInput(rawInput, existingNames),
    [existingNames, rawInput],
  );

  const validLines = preview.lines.filter(
    (line) => line.inPasteLimit && line.error === null,
  );
  const duplicateLines = validLines.filter(
    (line) => line.isDuplicateExisting || line.isDuplicateInInput,
  );
  const invalidLines = preview.lines.filter(
    (line) => line.inPasteLimit && line.error !== null,
  );
  const confirmedLines = validLines.filter(
    (line) =>
      (!line.isDuplicateExisting && !line.isDuplicateInInput) ||
      duplicateOverrides.has(line.lineNumber),
  );
  const submittableLines =
    remaining === null
      ? confirmedLines
      : confirmedLines.slice(0, Math.max(0, remaining));
  const heldForCapacity = Math.max(0, confirmedLines.length - submittableLines.length);

  const setSubmittingState = (value: boolean) => {
    setIsSubmitting(value);
    onSubmittingChange?.(value);
  };

  const handleRawInputChange = (value: string) => {
    const wasTruncated = value.length > MAX_BULK_INPUT_CHARACTERS;
    setRawInput(value.slice(0, MAX_BULK_INPUT_CHARACTERS));
    setDuplicateOverrides(new Set());
    setFeedback(
      wasTruncated
        ? {
          tone: "warning",
          message: t("inputTruncated", {
            count: MAX_BULK_INPUT_CHARACTERS,
          }),
        }
        : null,
    );
  };

  const focusTextarea = () => {
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const toggleDuplicateOverride = (lineNumber: number) => {
    setDuplicateOverrides((current) => {
      const next = new Set(current);
      if (next.has(lineNumber)) {
        next.delete(lineNumber);
      } else {
        next.add(lineNumber);
      }
      return next;
    });
    setFeedback(null);
  };

  const handleSubmit = async () => {
    if (submittableLines.length === 0 || isSubmitting || disabled) return;

    textareaRef.current?.focus();
    setSubmittingState(true);
    setFeedback(null);

    const createdLineNumbers = new Set<number>();
    const failureStatuses = new Set<BulkGuestCreateStatus>();
    let infrastructureError: string | null = null;

    try {
      const response = await onSubmitChunk(
        submittableLines.map((line) => ({
          name: toStoredGuestName(line.name),
          allowDuplicate:
            line.isDuplicateExisting || line.isDuplicateInInput
              ? duplicateOverrides.has(line.lineNumber)
              : false,
        })),
      );

      if (response.error || !response.data) {
        infrastructureError = response.error ?? "UNKNOWN_ERROR";
      } else if (response.data.items.length !== submittableLines.length) {
        infrastructureError = "INVALID_RESPONSE";
      } else {
        response.data.items.forEach((result) => {
          const line = submittableLines[result.index];
          if (!line) return;
          if (result.status === "created") {
            createdLineNumbers.add(line.lineNumber);
          } else {
            failureStatuses.add(result.status);
          }
        });
      }

      if (!isMountedRef.current) return;

      const retainedLines = preview.lines.filter(
        (line) => !createdLineNumbers.has(line.lineNumber),
      );

      try {
        await onSubmissionComplete?.();
      } catch (refreshError) {
        console.error("Failed to refresh guests after bulk submit:", refreshError);
      }
      if (!isMountedRef.current) return;

      setRawInput(retainedLines.map(toRetainedBulkGuestLineText).join("\n"));
      setDuplicateOverrides(new Set());
      shouldRestoreFocusRef.current = true;

      if (infrastructureError === "RATE_LIMITED") {
        setFeedback({ tone: "warning", message: t("rateLimited") });
      } else if (infrastructureError && createdLineNumbers.size > 0) {
        setFeedback({
          tone: "warning",
          message: t("partialSuccess", {
            count: createdLineNumbers.size,
            remaining: retainedLines.length,
          }),
        });
      } else if (infrastructureError) {
        setFeedback({ tone: "error", message: t("submitFailed") });
      } else if (
        failureStatuses.has("duplicate_requires_confirmation") ||
        failureStatuses.has("batch_changed")
      ) {
        setFeedback({
          tone: createdLineNumbers.size > 0 ? "warning" : "error",
          message: t("duplicateChanged", { count: createdLineNumbers.size }),
        });
      } else if (failureStatuses.has("limit_reached")) {
        setFeedback({
          tone: createdLineNumbers.size > 0 ? "warning" : "error",
          message: t("capacityChanged", { count: createdLineNumbers.size }),
        });
      } else if (failureStatuses.has("invalid_name")) {
        setFeedback({
          tone: createdLineNumbers.size > 0 ? "warning" : "error",
          message: t("validationChanged"),
          invalidInput: true,
        });
      } else if (createdLineNumbers.size > 0 && retainedLines.length > 0) {
        setFeedback({
          tone: "warning",
          message: t("partialSuccess", {
            count: createdLineNumbers.size,
            remaining: retainedLines.length,
          }),
        });
      } else if (createdLineNumbers.size > 0) {
        setFeedback({
          tone: "success",
          message: t("success", { count: createdLineNumbers.size }),
        });
      }
    } catch (submissionError) {
      if (!isMountedRef.current) return;
      console.error("Failed to submit bulk guests:", submissionError);
      const retainedLines = preview.lines.filter(
        (line) => !createdLineNumbers.has(line.lineNumber),
      );
      try {
        await onSubmissionComplete?.();
      } catch (refreshError) {
        console.error("Failed to refresh guests after bulk submit:", refreshError);
      }
      if (!isMountedRef.current) return;

      setRawInput(retainedLines.map(toRetainedBulkGuestLineText).join("\n"));
      setDuplicateOverrides(new Set());
      shouldRestoreFocusRef.current = true;
      if (createdLineNumbers.size > 0) {
        setFeedback({
          tone: "warning",
          message: t("partialSuccess", {
            count: createdLineNumbers.size,
            remaining: retainedLines.length,
          }),
        });
      } else {
        setFeedback({ tone: "error", message: t("submitFailed") });
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
        if (shouldRestoreFocusRef.current) {
          shouldRestoreFocusRef.current = false;
          focusTextarea();
        }
      }
      onSubmittingChange?.(false);
    }
  };

  const clearInput = () => {
    setRawInput("");
    setDuplicateOverrides(new Set());
    setFeedback(null);
    focusTextarea();
  };

  return (
    <details className="group mt-4 border-t border-border-subtle pt-2">
      <summary className="pressable -mx-1 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-1 py-2 text-sm font-medium text-text-muted hover:text-text-heading group-open:text-text-heading [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{t("title")}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-text-dim group-open:text-text-muted">
            {preview.lines.length > 0
              ? t("nameCount", { count: preview.lines.length })
              : t("optional")}
          </span>
          <Icon
            name="chevron-down"
            size={16}
            className="shrink-0 group-open:rotate-180"
          />
        </span>
      </summary>

      <div className="pb-1 pt-2">
        <label htmlFor={fieldId} className="app-label">
          {t("fieldLabel")}
        </label>
        <textarea
          id={fieldId}
          ref={textareaRef}
          value={rawInput}
          onChange={(event) => handleRawInputChange(event.target.value)}
          rows={5}
          disabled={disabled}
          readOnly={isSubmitting}
          aria-busy={isSubmitting}
          aria-describedby={[
            helperId,
            preview.lines.length > 0 ? previewStatusId : null,
            preview.overflowCount > 0 ? overflowWarningId : null,
            heldForCapacity > 0 ? capacityWarningId : null,
            feedback ? feedbackId : null,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-invalid={
            invalidLines.length > 0 || feedback?.invalidInput
              ? true
              : undefined
          }
          placeholder={t("placeholder")}
          autoComplete="off"
          className="app-field min-h-32 resize-y leading-relaxed read-only:cursor-wait read-only:opacity-70"
        />
        <p id={helperId} className="app-helper">
          {t("helper")}
        </p>

        {preview.lines.length > 0 && (
          <div className="mt-4">
            <div
              id={previewStatusId}
              className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="font-medium text-text-heading">
                {t("readyCount", { count: submittableLines.length })}
              </span>
              {duplicateLines.length > 0 && (
                <span className="text-status-waiting">
                  {t("duplicateCount", { count: duplicateLines.length })}
                </span>
              )}
              {invalidLines.length > 0 && (
                <span className="text-status-danger">
                  {t("invalidCount", { count: invalidLines.length })}
                </span>
              )}
              {preview.blankLineCount > 0 && (
                <span className="text-text-dim">
                  {t("blankCount", { count: preview.blankLineCount })}
                </span>
              )}
            </div>

            {preview.overflowCount > 0 && (
              <div
                id={overflowWarningId}
                className="mb-2 border-l-2 border-status-waiting bg-status-waiting/10 px-3 py-2 text-xs leading-relaxed text-status-waiting"
              >
                {t("pasteLimit", { count: preview.overflowCount })}
              </div>
            )}
            {heldForCapacity > 0 && (
              <div
                id={capacityWarningId}
                className="mb-2 border-l-2 border-status-waiting bg-status-waiting/10 px-3 py-2 text-xs leading-relaxed text-status-waiting"
              >
                {t("capacityHold", { count: heldForCapacity })}
              </div>
            )}

            <ol className="divide-y divide-border-subtle border-y border-border-default lg:max-h-56 lg:overflow-y-auto">
              {preview.lines.filter((line) => line.inPasteLimit).map((line) => {
                const isDuplicate =
                  line.isDuplicateExisting || line.isDuplicateInInput;
                const isConfirmed = duplicateOverrides.has(line.lineNumber);

                return (
                  <li
                    key={`${line.lineNumber}:${line.key}`}
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 px-3 py-2"
                  >
                    <span className="pt-0.5 font-mono text-xs tabular-nums text-text-dim">
                      {String(line.lineNumber).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-text-heading">
                        {line.error === "CONTROL_CHARACTER" ||
                        line.error === "FORMAT_CHARACTER"
                          ? t("unsafePreview")
                          : toStoredGuestName(line.name)}
                      </p>

                      {line.error !== null ? (
                        <p className="mt-1 text-xs text-status-danger">
                          {line.error === "TOO_LONG"
                            ? t("tooLong")
                            : t("invalidName")}
                        </p>
                      ) : isDuplicate ? (
                        <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 text-xs text-status-waiting">
                          <input
                            type="checkbox"
                            checked={isConfirmed}
                            onChange={() => toggleDuplicateOverride(line.lineNumber)}
                            disabled={disabled || isSubmitting}
                            className="h-4 w-4 accent-action-primary"
                          />
                          <span>
                            {line.isDuplicateExisting
                              ? t("duplicateExisting")
                              : t("duplicateInPaste")}
                            {isConfirmed ? ` ${t("includeConfirmed")}` : ""}
                          </span>
                        </label>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submittableLines.length === 0 || disabled}
                isLoading={isSubmitting}
                fullWidth
              >
                {t("submit", { count: submittableLines.length })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={clearInput}
                disabled={isSubmitting || disabled}
                className="sm:min-w-20"
              >
                {t("clear")}
              </Button>
            </div>
          </div>
        )}

        {feedback && (
          <div
            id={feedbackId}
            className={`mt-3 border px-3 py-2 text-sm leading-relaxed ${feedbackClasses(feedback.tone)}`}
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live={feedback.tone === "error" ? "assertive" : "polite"}
            aria-atomic="true"
          >
            {feedback.message}
          </div>
        )}
      </div>
    </details>
  );
}
