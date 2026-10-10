"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatePicker from "@/components/DatePicker";
import DisclosureSection from "@/components/DisclosureSection";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import RoleLabel from "@/components/RoleLabel";
import Skeleton from "@/components/Skeleton";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import { useToast } from "@/components/feedback/ToastProvider";
import {
  decideGuestLimitRequest,
  fetchGuestLimitRequests,
} from "@/lib/api/guest-limits";
import type { GuestLimitRequestView } from "@/lib/guest-limits/types";
import { useGuestPolling, useLatestRequestGuard } from "@/lib/hooks";
import { useLocale, useTranslations } from "next-intl";
import { formatDateDisplay, formatVenueDateTime } from "@/lib/date";
import {
  deriveAsyncListState,
  shouldShowEmptyState,
} from "@/lib/ui/async-list-state";

const EMPTY_REQUESTS: GuestLimitRequestView[] = [];
const HISTORY_LIMIT = 20;

function isValidApprovedAmount(value: string | undefined, max: number): boolean {
  const amount = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isInteger(amount) && amount >= 1 && amount <= max;
}

export default function GuestLimitRequestManagement({
  eventId,
  selectedDate,
  onDateChange,
  businessDate,
  scopeSelector,
  onPendingCountChange,
}: {
  eventId: string | null;
  selectedDate: string;
  onDateChange: (date: string) => void;
  businessDate: string;
  scopeSelector?: (controls: ReactNode, disabled?: boolean) => ReactNode;
  /** Receives the venue-wide pending count after each successful load, for the navigation badge. */
  onPendingCountChange?: (count: number) => void;
}) {
  const t = useTranslations("GuestLimitAdmin");
  const commonT = useTranslations("Common");
  const locale = useLocale() as "en" | "ko";
  const showToast = useToast();
  const {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    currentVenue,
  } = useVenueSelector();
  const [requests, setRequests] = useState<GuestLimitRequestView[]>([]);
  const [approvedAmounts, setApprovedAmounts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [loadError, setLoadError] = useState("");
  const scope = useMemo(() => ({ venueId, eventId, selectedDate }), [venueId, eventId, selectedDate]);
  const [loadedScope, setLoadedScope] = useState<typeof scope | null>(null);
  // Success goes to the global toast; a failed decision stays on the request that failed.
  const [decisionError, setDecisionError] = useState<{ requestId: string; message: string } | null>(null);
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const requestGuard = useLatestRequestGuard();
  const currentScopeRef = useRef(scope);
  const activeDecisionRef = useRef<symbol | null>(null);

  useLayoutEffect(() => {
    currentScopeRef.current = scope;
    setLoadOutcome("idle");
    setDecisionError(null);
    setPendingRejectId(null);
  }, [scope]);
  useEffect(() => () => { activeDecisionRef.current = null; }, []);

  const scopedRequests = loadedScope === scope ? requests : EMPTY_REQUESTS;
  const isCurrentScopeLoading = isLoading || loadedScope !== scope;

  const loadRequests = useCallback(async (options?: { silent?: boolean }) => {
    if (currentScopeRef.current !== scope) return;
    const isLatestRequest = requestGuard.beginRequest();
    if (!venueId) {
      setRequests([]);
      setLoadedScope(scope);
      setLoadOutcome("success");
      setLoadError("");
      setIsLoading(false);
      return;
    }
    if (!options?.silent) setIsLoading(true);
    setLoadError("");
    try {
      const { data, error } = await fetchGuestLimitRequests(
        venueId,
        eventId,
        selectedDate,
      );
      if (!isLatestRequest() || currentScopeRef.current !== scope) return;
      if (error) {
        setLoadError(t("loadFailed"));
        if (!options?.silent) {
          setRequests([]);
          setApprovedAmounts({});
        }
        setLoadOutcome("error");
      } else {
        const nextRequests = data ?? [];
        setRequests(nextRequests);
        onPendingCountChange?.(nextRequests.filter((request) => request.status === "pending").length);
        setApprovedAmounts(current => Object.fromEntries(nextRequests.map((request) => [
          request.id, current[request.id] ?? String(request.requestedExtra),
        ])));
        setLoadOutcome("success");
      }
    } catch {
      if (!isLatestRequest() || currentScopeRef.current !== scope) return;
      setLoadError(t("loadFailed"));
      if (!options?.silent) {
        setRequests([]);
        setApprovedAmounts({});
      }
      setLoadOutcome("error");
    } finally {
      if (isLatestRequest() && currentScopeRef.current === scope) {
        setLoadedScope(scope);
        setIsLoading(false);
      }
    }
  }, [selectedDate, eventId, onPendingCountChange, requestGuard, t, venueId, scope]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);
  const pollRequests = useCallback(() => loadRequests({ silent: true }), [loadRequests]);
  useGuestPolling(pollRequests, 15000, Boolean(venueId) && !isCurrentScopeLoading && busyId === null);

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
    isLoading: isCurrentScopeLoading,
    itemCount: pending.length,
    hasError: loadOutcome === "error",
  });

  const handleDecision = async (
    request: GuestLimitRequestView,
    decision: "approve" | "reject",
  ) => {
    if (activeDecisionRef.current || isCurrentScopeLoading || !pending.includes(request)) return;
    const rawAmount = approvedAmounts[request.id] ?? String(request.requestedExtra);
    const approvedExtra = Number(rawAmount);
    if (decision === "approve" && !isValidApprovedAmount(rawAmount, request.requestedExtra)) return;
    if (decision === "reject" && pendingRejectId !== request.id) return;
    const operation = Symbol();
    activeDecisionRef.current = operation;
    requestGuard.invalidateRequests();
    setBusyId(request.id);
    setDecisionError(null);
    try {
      const { error } = await decideGuestLimitRequest({
        requestId: request.id,
        decision,
        approvedExtra: decision === "approve" ? approvedExtra : undefined,
      });
      if (activeDecisionRef.current !== operation || currentScopeRef.current !== scope) return;
      if (error) {
        setDecisionError({ requestId: request.id, message: t("decisionFailed") });
      } else {
        setPendingRejectId(null);
        showToast({ message: decision === "approve" ? t("approved") : t("rejected") });
        await loadRequests();
      }
    } catch {
      if (activeDecisionRef.current === operation && currentScopeRef.current === scope) {
        setDecisionError({ requestId: request.id, message: t("decisionFailed") });
      }
    } finally {
      if (activeDecisionRef.current === operation) {
        activeDecisionRef.current = null;
        setBusyId(null);
      }
    }
  };

  const isDeciding = busyId !== null;
  const scopeControls = <>
    <DatePicker compact value={selectedDate} onChange={onDateChange}
      businessDate={businessDate} disabled={isDeciding} />
    {isSuperAdmin && venues.length > 0 && <VenueSelector
      venues={venues} selectedVenueId={selectedVenueId}
      onVenueChange={setSelectedVenueId} disabled={isDeciding} className="scope-venue" />}
  </>;

  return (
    <div className="space-y-4">
      {scopeSelector ? scopeSelector(scopeControls, isDeciding) : <div className="operations-scope">{scopeControls}</div>}
      <section className="record-collection" aria-labelledby="guest-limit-requests-title">
        <PanelHeader
          title={t("title")}
          headingId="guest-limit-requests-title"
          count={pending.length}
          onRefresh={loadRequests}
          isLoading={isCurrentScopeLoading || isDeciding}
        />
        <div className="record-collection-body space-y-4">
          <p className="app-helper">{t("pendingScopeHint")}</p>
          {loadError && <Alert type="error" message={loadError} />}
          {!venueId ? (
            <p className="py-4 text-sm text-text-muted">
              {t("selectVenue")}
            </p>
          ) : listState === "loading" ? (
            <Skeleton rows={4} />
          ) : shouldShowEmptyState(listState) ? (
            <EmptyState icon="user" message={t("noPending")} />
          ) : (
            <div className="record-list">
              {pending.map((request) => {
                const amountId = `approved-extra-${request.id}`;
                const amountErrorId = `${amountId}-error`;
                const amount = approvedAmounts[request.id] ?? String(request.requestedExtra);
                const amountValid = isValidApprovedAmount(amount, request.requestedExtra);
                const showAmountError = !amountValid && amount.trim() !== "";
                const rowError = decisionError?.requestId === request.id ? decisionError.message : null;
                const rowDisabled = isDeciding || isCurrentScopeLoading;
                return (
                <article key={request.id} className="record-review-row" aria-busy={busyId === request.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="type-row-title break-words">{request.userName}</h3>
                    <p className="mt-1 text-xs text-text-muted">
                      <RoleLabel role={request.userRole} /> · <time dateTime={request.date}>{formatDateDisplay(request.date, locale)}</time>{request.eventName ? ` · ${request.eventName}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-lg text-text-heading">
                    +{request.requestedExtra}
                  </span>
                </div>
                <p className="mt-3 min-h-5 break-words text-sm text-text-body">
                  {request.reason || t("noReason")}
                </p>
                <div className="mt-4">
                  <label htmlFor={amountId} className="app-label">
                    {t("approvedCount", { max: request.requestedExtra })}
                  </label>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <input
                      id={amountId}
                      name={amountId}
                      type="number"
                      min="1"
                      max={request.requestedExtra}
                      step="1"
                      value={amount}
                      onChange={(event) =>
                        setApprovedAmounts((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))
                      }
                      className="app-field"
                      autoComplete="off"
                      aria-invalid={showAmountError || undefined}
                      aria-describedby={showAmountError ? amountErrorId : undefined}
                      disabled={rowDisabled}
                    />
                  <Button
                    size="sm"
                    onClick={() => handleDecision(request, "approve")}
                    isLoading={busyId === request.id && pendingRejectId !== request.id}
                    disabled={rowDisabled || !amountValid || pendingRejectId === request.id}
                  >
                    {t("approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-expanded={pendingRejectId === request.id}
                    onClick={() => { setDecisionError(null); setPendingRejectId(request.id); }}
                    disabled={rowDisabled}
                  >
                    {t("reject")}
                  </Button>
                  </div>
                  {showAmountError && (
                    <p id={amountErrorId} className="mt-1 text-xs text-status-danger">
                      {t("approvedCountInvalid", { max: request.requestedExtra })}
                    </p>
                  )}
                  {rowError && pendingRejectId !== request.id && <Alert type="error" message={rowError} className="mt-3" />}
                <ConfirmDialog
                  open={pendingRejectId === request.id}
                  title={t("rejectTitle", { name: request.userName })}
                  description={t("rejectDescription")}
                  confirmLabel={t("reject")}
                  cancelLabel={commonT("cancel")}
                  onConfirm={() => void handleDecision(request, "reject")}
                  onCancel={() => { setDecisionError(null); setPendingRejectId(null); }}
                  isLoading={busyId === request.id}
                >
                  {rowError && <Alert type="error" message={rowError} />}
                </ConfirmDialog>
                </div>
                </article>
                );
              })}
            </div>
          )}

          {decided.length > 0 && (
            <DisclosureSection title={decided.length > HISTORY_LIMIT
              ? t("historyTruncated", { shown: HISTORY_LIMIT, total: decided.length })
              : t("history", { count: decided.length })}>
            <div className="divide-y divide-border-subtle border-y border-border-subtle">
              {decided.slice(0, HISTORY_LIMIT).map((request) => {
                const decidedAt = request.decidedAt
                  ? formatVenueDateTime(request.decidedAt, {
                      locale: locale === "ko" ? "ko-KR" : "en-US",
                      timeZone: currentVenue?.timezone,
                    })
                  : null;
                return (
                <div key={request.id} className="flex items-start justify-between gap-3 p-3 text-xs">
                  <span className="min-w-0 break-words text-text-body">
                    {request.userName} · <time dateTime={request.date}>{formatDateDisplay(request.date, locale)}</time>
                    {decidedAt && request.decidedAt && (
                      <span className="mt-1 block text-text-muted">
                        {t("decidedAt")} <time dateTime={request.decidedAt}>{decidedAt}</time>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right font-mono text-text-muted">
                    {request.status === "approved"
                      ? t("approvedHistory", { count: request.approvedExtra })
                      : t("rejectedHistory")}
                  </span>
                </div>
                );
              })}
            </div>
            </DisclosureSection>
          )}
        </div>
      </section>
    </div>
  );
}
