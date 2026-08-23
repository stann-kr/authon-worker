"use client";

import Button from "@/components/Button";
import DisclosureSection from "@/components/DisclosureSection";
import type { GuestLimitRequest } from "@/lib/guest-limits/types";
import type useGuestLimitRequestController from "./useGuestLimitRequestController";

type GuestLimitRequestTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

interface GuestLimitRequestPanelProps {
  requestScopeKey: string;
  pendingRequest: GuestLimitRequest | null;
  translate: GuestLimitRequestTranslate;
  controller: ReturnType<typeof useGuestLimitRequestController>;
}

export default function GuestLimitRequestPanel({
  requestScopeKey,
  pendingRequest,
  translate: t,
  controller,
}: GuestLimitRequestPanelProps) {
  const {
    isRequestDisclosureDisabled,
    isRequestSubmissionDisabled,
    isRequestingExtra,
    isCurrentScopeFetching,
    requestDraft,
    requestSectionMeta,
    requestSectionState,
    handleExtraRequest,
    setPendingRequestStatusElement,
    setRequestSummaryElement,
    updateRequestDraft,
  } = controller;

  if (requestSectionState === "hidden") return null;

  return (
    <>
      <DisclosureSection
        key={requestScopeKey}
        title={t("requestExtra")}
        summaryElementRef={(element) =>
          setRequestSummaryElement(requestScopeKey, element)
        }
        meta={
          requestSectionMeta ? (
            <span role="status" aria-live="polite">
              {requestSectionMeta}
            </span>
          ) : undefined
        }
        disabled={isRequestDisclosureDisabled}
        isLoading={
          requestSectionState === "loading" || isCurrentScopeFetching
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="extra-guest-count" className="app-label">
              {t("requestCount")}
            </label>
            <input
              id="extra-guest-count"
              name="extra-guest-count"
              type="number"
              min="1"
              max="10"
              value={requestDraft.requestedExtra}
              onChange={(event) =>
                updateRequestDraft({ requestedExtra: event.target.value })
              }
              disabled={isRequestDisclosureDisabled}
              autoComplete="off"
              className="app-field"
            />
          </div>
          <div>
            <label htmlFor="extra-guest-reason" className="app-label">
              {t("requestReasonOptional")}
            </label>
            <textarea
              id="extra-guest-reason"
              name="extra-guest-reason"
              value={requestDraft.requestReason}
              onChange={(event) =>
                updateRequestDraft({ requestReason: event.target.value })
              }
              maxLength={200}
              rows={2}
              disabled={isRequestDisclosureDisabled}
              autoComplete="off"
              className="app-field"
            />
          </div>
          <Button
            type="button"
            onClick={handleExtraRequest}
            isLoading={isRequestingExtra}
            disabled={
              isRequestSubmissionDisabled ||
              !Number.isInteger(Number(requestDraft.requestedExtra)) ||
              Number(requestDraft.requestedExtra) < 1 ||
              Number(requestDraft.requestedExtra) > 10
            }
            fullWidth
          >
            {t("submitRequest")}
          </Button>
        </div>
      </DisclosureSection>

      {requestSectionState === "pending" && pendingRequest ? (
        <div
          ref={(element) =>
            setPendingRequestStatusElement(requestScopeKey, element)
          }
          role="status"
          aria-live="polite"
          aria-atomic="true"
          tabIndex={-1}
          className="mt-2 bg-status-waiting/10 px-3 py-3 text-xs leading-relaxed text-status-waiting"
        >
          {t("requestPending", { count: pendingRequest.requestedExtra })}
        </div>
      ) : null}
    </>
  );
}
