"use client";

import type { MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AnalyticsEventRow } from "@/lib/analytics/types";

export default function AnalyticsEvents({
  rows,
  venueId,
  onOpenEvent,
}: {
  rows: AnalyticsEventRow[];
  venueId: string;
  onOpenEvent: (eventId: string, businessDate: string) => void;
}) {
  const t = useTranslations("AdminAnalytics");
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const eventHref = (row: AnalyticsEventRow) => {
    const search = new URLSearchParams({
      tab: "events",
      view: "manage",
      venue: venueId,
      eventId: row.eventId,
      date: row.businessDate,
    });
    return `/admin?${search.toString()}`;
  };
  const handleEventClick = (
    event: MouseEvent<HTMLAnchorElement>,
    row: AnalyticsEventRow,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onOpenEvent(row.eventId, row.businessDate);
  };

  return (
    <section className="app-panel" aria-labelledby="analytics-events-title">
      <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
        <h3 id="analytics-events-title" className="type-panel-title">
          {t("events.title")}
          <span className="ml-2 font-mono text-xs font-normal text-text-dim">{rows.length}</span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{t("events.description")}</p>
      </div>
      <div className="grid gap-3 p-4 md:hidden">
        {rows.map((row) => (
          <article key={row.eventId} className="border border-border-default bg-canvas p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="break-words text-sm font-semibold text-text-heading">{row.name}</h4>
                <p className="mt-1 text-xs text-text-muted">
                  {row.businessDate}{" · "}
                  <span className={row.status === "drifted" ? "text-status-waiting" : ""}>
                    {t(`events.${row.status}`)}
                  </span>
                </p>
              </div>
              <a href={eventHref(row)} onClick={(event) => handleEventClick(event, row)} className="pressable flex min-h-11 shrink-0 items-center border border-border-default bg-surface-raised px-3 py-2 text-xs font-medium text-text-muted hover:text-text-heading">
                {t("events.open")}
              </a>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-text-dim">{t("summary.registered")}</dt><dd className="mt-1 font-mono tabular-nums">{numberFormat.format(row.registered)}</dd></div>
              <div><dt className="text-text-dim">{t("summary.checkedIn")}</dt><dd className="mt-1 font-mono tabular-nums">{numberFormat.format(row.checkedIn)}</dd></div>
              <div><dt className="text-text-dim">{t("summary.entryRatePercent")}</dt><dd className="mt-1 font-mono tabular-nums">{row.entryRatePercent === null ? "—" : `${numberFormat.format(row.entryRatePercent)}%`}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-canvas text-xs text-text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">{t("events.date")}</th>
              <th scope="col" className="px-4 py-3 font-medium">{t("events.event")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t("summary.registered")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t("summary.checkedIn")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t("summary.entryRatePercent")}</th>
              <th scope="col" className="px-4 py-3 font-medium">{t("events.status")}</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">{t("events.action")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.eventId} className="border-t border-border-subtle">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-text-muted">{row.businessDate}</td>
                <th scope="row" className="px-4 py-3 font-medium text-text-heading">{row.name}</th>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{numberFormat.format(row.registered)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{numberFormat.format(row.checkedIn)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{row.entryRatePercent === null ? "—" : `${numberFormat.format(row.entryRatePercent)}%`}</td>
                <td className={`px-4 py-3 text-xs ${row.status === "drifted" ? "text-status-waiting" : "text-text-muted"}`}>{t(`events.${row.status}`)}</td>
                <td className="px-4 py-2 text-right"><a href={eventHref(row)} onClick={(event) => handleEventClick(event, row)} className="pressable inline-flex min-h-11 items-center px-2 text-xs font-medium text-text-muted hover:text-text-heading">{t("events.open")}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
