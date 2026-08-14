"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import Skeleton from "@/components/Skeleton";
import {
  confirmEventCloseout,
  fetchEventCloseout,
  type EventCloseoutView,
} from "@/lib/api/closeout";
import { nightCloseoutToCsv } from "@/lib/closeout/domain";
import { useLatestRequestGuard } from "@/lib/hooks";

interface EventCloseoutProps {
  eventId: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export default function EventCloseout({ eventId }: EventCloseoutProps) {
  const t = useTranslations("EventCloseout");
  const [view, setView] = useState<EventCloseoutView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const requestGuard = useLatestRequestGuard();

  const load = useCallback(async () => {
    const isLatest = requestGuard.beginRequest();
    setIsLoading(true);
    setError(null);
    const response = await fetchEventCloseout(eventId);
    if (!isLatest()) return;
    if (response.error || !response.data) {
      setView(null);
      setError(t("loadFailed"));
    } else {
      setView(response.data);
    }
    setIsLoading(false);
  }, [eventId, requestGuard, t]);

  useEffect(() => {
    setView(null);
    setFeedback(null);
    void load();
  }, [load]);

  const confirm = async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    setFeedback(null);
    const response = await confirmEventCloseout(eventId);
    if (response.error || !response.data) {
      setFeedback(t("confirmFailed"));
    } else {
      setView(response.data);
      setFeedback(t("confirmed"));
      setConfirmOpen(false);
    }
    setIsConfirming(false);
  };

  const downloadCsv = () => {
    if (!view) return;
    const csv = nightCloseoutToCsv(view.report);
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `authon-closeout-${eventId.slice(0, 12)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const report = view?.report ?? null;
  const canConfirm = Boolean(
    report &&
      report.status === "ready" &&
      report.ledger.invariantMismatchCount === 0 &&
      report.ledger.untrackedGuestCount === 0,
  );

  return (
    <section className="app-panel" aria-labelledby="event-closeout-title">
      <PanelHeader
        title={t("title")}
        headingId="event-closeout-title"
        isLoading={isLoading}
        onRefresh={load}
        actions={
          report ? (
            <>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={isLoading}
                className="min-h-11 border border-border-default bg-surface-raised px-3 py-2 text-xs font-semibold text-text-body disabled:opacity-50"
              >
                {t("downloadCsv")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!canConfirm || isConfirming}
                className="min-h-11 bg-action-primary px-3 py-2 text-xs font-semibold text-action-text disabled:opacity-50"
              >
                {report.status === "confirmed" ? t("confirmedLabel") : t("confirm")}
              </button>
            </>
          ) : null
        }
      />

      <div className="p-4 sm:p-5">
        {error && <Alert type="error" message={error} />}
        {feedback && (
          <p
            role="status"
            aria-live="polite"
            className="mb-4 border-l-2 border-action-primary bg-surface-raised px-3 py-2 text-sm text-text-body"
          >
            {feedback}
          </p>
        )}
        {isLoading ? (
          <Skeleton rows={5} />
        ) : !report ? (
          <EmptyState icon="database" message={t("empty")} />
        ) : (
          <div className="space-y-5">
            {report.status === "provisional" && (
              <p
                role="status"
                className="border-l-2 border-action-primary bg-surface-raised px-3 py-2 text-sm text-text-body"
              >
                {t("provisional")}
              </p>
            )}
            {(report.status === "inconsistent" ||
              view?.confirmationIntegrity === "drifted") && (
              <Alert type="error" message={t("inconsistent")} />
            )}
            {report.ledger.untrackedGuestCount > 0 && (
              <p
                role="alert"
                className="border-l-2 border-status-waiting bg-status-waiting/10 px-3 py-2 text-sm text-status-waiting"
              >
                {t("untracked", { count: report.ledger.untrackedGuestCount })}
              </p>
            )}

            <dl className="grid grid-cols-2 gap-px border border-border-default bg-border-default sm:grid-cols-4">
              {[
                [t("registered"), report.registered],
                [t("checkedIn"), report.checkedIn],
                [t("noShow"), report.noShow],
                [t("entryRate"), `${report.entryRatePercent}%`],
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-canvas p-3 text-center">
                  <dt className="text-xs text-text-muted">{label}</dt>
                  <dd className="mt-1 font-mono text-xl text-text-heading">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <p className="border border-border-default p-3 text-sm text-text-body">
                <span className="block text-xs text-text-muted">{t("peak15")}</span>
                <strong className="mt-1 block font-mono text-text-heading">
                  {report.peak15Minutes
                    ? t("peakValue", {
                        count: report.peak15Minutes.entries,
                        time: report.peak15Minutes.startedAt.slice(11, 16),
                      })
                    : "—"}
                </strong>
              </p>
              <p className="border border-border-default p-3 text-sm text-text-body">
                <span className="block text-xs text-text-muted">{t("operations")}</span>
                <strong className="mt-1 block font-mono text-text-heading">
                  {t("operationValue", {
                    removals: report.guestRemovals,
                    cancellations: report.checkInCancellations,
                    reentries: report.reEntries,
                    onsite: report.onSiteAdds,
                  })}
                </strong>
              </p>
              <p className="border border-border-default p-3 text-sm text-text-body">
                <span className="block text-xs text-text-muted">{t("preparationTime")}</span>
                <strong className="mt-1 block font-mono text-text-heading">
                  {formatDuration(report.timing.preparationSeconds)}
                </strong>
              </p>
              <p className="border border-border-default p-3 text-sm text-text-body">
                <span className="block text-xs text-text-muted">{t("confirmationTime")}</span>
                <strong className="mt-1 block font-mono text-text-heading">
                  {formatDuration(report.timing.confirmationSeconds)}
                </strong>
              </p>
            </div>

            <div>
              <h4 className="type-row-title mb-2">{t("contributors")}</h4>
              {report.contributors.length === 0 ? (
                <p className="text-sm text-text-muted">{t("noContributors")}</p>
              ) : (
                <ul className="divide-y divide-border-subtle border-y border-border-default">
                  {report.contributors.map((contributor) => (
                    <li
                      key={`${contributor.kind}:${contributor.id ?? "none"}`}
                      className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-text-heading">
                          {contributor.label}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">
                          {t("sample", { count: contributor.sampleSize })} · {t("limitUsage", {
                            used: contributor.used,
                            limit:
                              contributor.effectiveLimit === null
                                ? t("unlimited")
                                : contributor.effectiveLimit,
                          })}
                        </p>
                      </div>
                      <p className="font-mono text-sm text-text-body">
                        {contributor.checkedIn}/{contributor.registered} · {contributor.entryRatePercent}%
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={t("confirmDescription")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmOpen(false)}
        isLoading={isConfirming}
      />
    </section>
  );
}
