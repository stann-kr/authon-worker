"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@/components/Alert";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import RoleLabel from "@/components/RoleLabel";
import Skeleton from "@/components/Skeleton";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import {
  decideGuestLimitRequest,
  fetchGuestLimitRequests,
} from "@/lib/api/guest-limits";
import type { GuestLimitRequestView } from "@/lib/api/types";
import { useLatestRequestGuard } from "@/lib/hooks";
import { useTranslations } from "next-intl";
import { useSectionLoadingTask } from "@/components/RouteTransitionProvider";
import {
  deriveAsyncListState,
  shouldShowEmptyState,
} from "@/lib/ui/async-list-state";

const EMPTY_REQUESTS: GuestLimitRequestView[] = [];

export default function GuestLimitRequestManagement({
  eventId,
  businessDate,
}: {
  eventId: string | null;
  businessDate: string;
}) {
  const t = useTranslations("GuestLimitAdmin");
  const {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
  } = useVenueSelector();
  const [requests, setRequests] = useState<GuestLimitRequestView[]>([]);
  const [approvedAmounts, setApprovedAmounts] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [loadError, setLoadError] = useState("");
  const [loadedVenueId, setLoadedVenueId] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const requestGuard = useLatestRequestGuard();
  const currentVenueIdRef = useRef(venueId);

  useEffect(() => {
    currentVenueIdRef.current = venueId;
    setLoadOutcome("idle");
  }, [venueId]);

  const scopedRequests = loadedVenueId === venueId ? requests : EMPTY_REQUESTS;
  const isCurrentVenueLoading = isLoading || loadedVenueId !== venueId;
  useSectionLoadingTask(isCurrentVenueLoading);

  const loadRequests = useCallback(async () => {
    const requestedVenueId = venueId;
    if (currentVenueIdRef.current !== requestedVenueId) return;
    const isLatestRequest = requestGuard.beginRequest();
    if (!venueId) {
      setRequests([]);
      setLoadedVenueId("");
      setLoadOutcome("success");
      setLoadError("");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const { data, error } = await fetchGuestLimitRequests(
        venueId,
        eventId,
        businessDate,
      );
      if (!isLatestRequest() || currentVenueIdRef.current !== requestedVenueId) return;
      if (error) {
        setLoadError(t("loadFailed"));
        setRequests([]);
        setApprovedAmounts({});
        setLoadOutcome("error");
      } else {
        const nextRequests = data ?? [];
        setRequests(nextRequests);
        setApprovedAmounts(
          Object.fromEntries(nextRequests.map((request) => [request.id, request.requestedExtra])),
        );
        setLoadOutcome("success");
      }
    } catch {
      if (!isLatestRequest() || currentVenueIdRef.current !== requestedVenueId) return;
      setLoadError(t("loadFailed"));
      setRequests([]);
      setApprovedAmounts({});
      setLoadOutcome("error");
    } finally {
      if (isLatestRequest() && currentVenueIdRef.current === requestedVenueId) {
        setLoadedVenueId(requestedVenueId);
        setIsLoading(false);
      }
    }
  }, [businessDate, eventId, requestGuard, t, venueId]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const pending = useMemo(
    () => scopedRequests.filter((request) => request.status === "pending"),
    [scopedRequests],
  );
  const decided = useMemo(
    () => scopedRequests.filter((request) => request.status !== "pending"),
    [scopedRequests],
  );
  const listState = deriveAsyncListState({
    hasStarted: isLoading || loadOutcome !== "idle",
    isLoading: isCurrentVenueLoading,
    itemCount: pending.length,
    hasError: loadOutcome === "error",
  });

  const handleDecision = async (
    request: GuestLimitRequestView,
    decision: "approve" | "reject",
  ) => {
    setBusyId(request.id);
    setFeedback(null);
    const { error } = await decideGuestLimitRequest({
      requestId: request.id,
      decision,
      approvedExtra:
        decision === "approve" ? approvedAmounts[request.id] : undefined,
    });
    if (error) {
      setFeedback({ type: "error", message: t("decisionFailed") });
    } else {
      setFeedback({
        type: "success",
        message: decision === "approve" ? t("approved") : t("rejected"),
      });
      await loadRequests();
    }
    setBusyId(null);
  };

  return (
    <div className="space-y-4">
      {isSuperAdmin && venues.length > 0 && (
        <VenueSelector
          venues={venues}
          selectedVenueId={selectedVenueId}
          onVenueChange={setSelectedVenueId}
          className="app-panel p-4 sm:p-5"
        />
      )}
      <section className="app-panel" aria-labelledby="guest-limit-requests-title">
        <PanelHeader
          title={t("title")}
          headingId="guest-limit-requests-title"
          count={pending.length}
          onRefresh={loadRequests}
          isLoading={isCurrentVenueLoading}
        />
        <div className="space-y-4 p-4 sm:p-5">
          {loadError && <Alert type="error" message={loadError} />}
          {feedback && <Alert type={feedback.type} message={feedback.message} />}
          {!venueId ? (
            <p className="border border-border-default bg-canvas p-4 text-sm text-text-muted">
              {t("selectVenue")}
            </p>
          ) : listState === "loading" ? (
            <Skeleton rows={4} />
          ) : shouldShowEmptyState(listState) ? (
            <EmptyState icon="user" message={t("noPending")} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {pending.map((request) => (
                <article key={request.id} className="border border-border-default bg-canvas p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="type-row-title break-words">{request.userName}</h3>
                    <p className="mt-1 text-xs text-text-muted">
                      <RoleLabel role={request.userRole} /> · {request.date}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-lg text-text-heading">
                    +{request.requestedExtra}
                  </span>
                </div>
                <p className="mt-3 min-h-5 break-words text-sm text-text-body">
                  {request.reason || t("noReason")}
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <div>
                    <label htmlFor={`approved-extra-${request.id}`} className="sr-only">
                      {t("approvedCount")}
                    </label>
                    <input
                      id={`approved-extra-${request.id}`}
                      name={`approved-extra-${request.id}`}
                      type="number"
                      min="1"
                      max={request.requestedExtra}
                      value={approvedAmounts[request.id] ?? request.requestedExtra}
                      onChange={(event) =>
                        setApprovedAmounts((current) => ({
                          ...current,
                          [request.id]: Number.parseInt(event.target.value, 10),
                        }))
                      }
                      className="app-field"
                      autoComplete="off"
                      disabled={busyId === request.id}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDecision(request, "approve")}
                    disabled={
                      busyId === request.id ||
                      !Number.isInteger(approvedAmounts[request.id]) ||
                      approvedAmounts[request.id] < 1 ||
                      approvedAmounts[request.id] > request.requestedExtra
                    }
                    className="min-h-11 bg-action-primary px-4 py-2 text-xs font-semibold text-action-text disabled:opacity-50"
                  >
                    {t("approve")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecision(request, "reject")}
                    disabled={busyId === request.id}
                    className="min-h-11 border border-status-danger/70 bg-status-danger/10 px-4 py-2 text-xs font-semibold text-status-danger disabled:opacity-50"
                  >
                    {t("reject")}
                  </button>
                </div>
                </article>
              ))}
            </div>
          )}

          {decided.length > 0 && (
            <details className="border-t border-border-default pt-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text-heading">
              {t("history", { count: decided.length })}
            </summary>
            <div className="mt-3 divide-y divide-border-subtle border border-border-default bg-canvas">
              {decided.slice(0, 20).map((request) => (
                <div key={request.id} className="flex items-start justify-between gap-3 p-3 text-xs">
                  <span className="min-w-0 break-words text-text-body">
                    {request.userName} · {request.date}
                  </span>
                  <span className="shrink-0 text-right font-mono text-text-muted">
                    {request.status === "approved"
                      ? t("approvedHistory", { count: request.approvedExtra })
                      : t("rejectedHistory")}
                  </span>
                </div>
              ))}
            </div>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}
