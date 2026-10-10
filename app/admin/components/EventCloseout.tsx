"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import Skeleton from "@/components/Skeleton";
import { useToast } from "@/components/feedback/ToastProvider";
import {
  confirmEventCloseout,
  fetchEventCloseout,
  type EventCloseoutView,
} from "@/lib/api/closeout";
import { nightCloseoutToCsv } from "@/lib/closeout/domain";
import { useLatestRequestGuard } from "@/lib/hooks";
import { DEFAULT_VENUE_TIMEZONE, isValidTimeZone } from "@/lib/date";
import type { Event } from "@/lib/events/types";

interface EventCloseoutProps {
  eventId: string;
  eventState: Event["state"];
  timeZone?: string | null;
}

export default function EventCloseout({ eventId, eventState, timeZone }: EventCloseoutProps) {
  const t = useTranslations("EventCloseout");
  const locale = useLocale();
  const showToast = useToast();
  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return "—";
    if (seconds < 60) return t("durationSeconds", { seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("durationMinutes", { minutes });
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? t("durationHoursMinutes", { hours, minutes: remainingMinutes })
      : t("durationHours", { hours });
  };
  const [view, setView] = useState<EventCloseoutView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
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
    setConfirmError(null);
    void load();
  }, [load, eventState]);

  const confirm = async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      const response = await confirmEventCloseout(eventId);
      if (response.error || !response.data) {
        setConfirmError(t("confirmFailed"));
      } else {
        setView(response.data);
        showToast({ message: t("confirmed") });
        setConfirmOpen(false);
      }
    } catch {
      setConfirmError(t("confirmFailed"));
    } finally {
      setIsConfirming(false);
    }
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
              <Button
                size="sm"
                variant="outline"
                onClick={downloadCsv}
                disabled={isLoading}
              >
                {t("downloadCsv")}
              </Button>
              <Button
                size="sm"
                onClick={() => { setConfirmError(null); setConfirmOpen(true); }}
                isLoading={isConfirming}
                disabled={!canConfirm}
              >
                {report.status === "confirmed" ? t("confirmedLabel") : t("confirm")}
              </Button>
            </>
          ) : null
        }
      />

      <div className="p-4 sm:p-5">
        {error && <Alert type="error" message={error} />}
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

            <dl className="record-detail-grid">
              {[
                [t("registered"), report.registered],
                [t("checkedIn"), report.checkedIn],
                [t("noShow"), report.noShow],
                [t("entryRate"), `${report.entryRatePercent}%`],
              ].map(([label, value]) => (
                <div key={String(label)} className="py-2">
                  <dt className="text-xs text-text-muted">{label}</dt>
                  <dd className="mt-1 font-mono text-lg text-text-heading">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="record-detail-grid">
              <p className="rounded-control bg-surface-raised p-3 text-sm text-text-body">
                <span className="block text-xs text-text-muted">{t("peak15")}</span>
                <strong className="mt-1 block font-mono text-text-heading">
                  {report.peak15Minutes
                    ? t("peakValue", {
                        count: report.peak15Minutes.entries,
                        time: new Intl.DateTimeFormat(locale, {
                          hour: "2-digit", minute: "2-digit", hourCycle: "h23",
                          timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_VENUE_TIMEZONE,
                        }).format(new Date(report.peak15Minutes.startedAt)),
                      })
                    : "—"}
                </strong>
              </p>
              <p className="rounded-control bg-surface-raised p-3 text-sm text-text-body">
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
              <p className="rounded-control bg-surface-raised p-3 text-sm text-text-body">
                <span className="block text-xs text-text-muted">{t("preparationTime")}</span>
                <strong className="mt-1 block font-mono text-text-heading">
                  {formatDuration(report.timing.preparationSeconds)}
                </strong>
              </p>
              <p className="rounded-control bg-surface-raised p-3 text-sm text-text-body">
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
        onCancel={() => { setConfirmError(null); setConfirmOpen(false); }}
        isLoading={isConfirming}
      >
        {confirmError && <Alert type="error" message={confirmError} />}
      </ConfirmDialog>
    </section>
  );
}
