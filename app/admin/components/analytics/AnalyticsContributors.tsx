"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AnalyticsContributorRow } from "@/lib/analytics/types";

type SortKey =
  | "registered"
  | "checkedIn"
  | "entryRatePercent"
  | "operatingDays";

export default function AnalyticsContributors({
  rows,
}: {
  rows: AnalyticsContributorRow[];
}) {
  const t = useTranslations("AdminAnalytics");
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const [sortKey, setSortKey] = useState<SortKey>("registered");
  const [isAscending, setIsAscending] = useState(false);
  const contributorLabel = useCallback((row: AnalyticsContributorRow): string => {
    if (row.sourceStatus === "mapped") return row.displayName;
    if (row.sourceStatus === "deleted") return t("contributors.deleted");
    return row.source?.kind === "external_link"
      ? row.displayName
        ? t("contributors.unmappedLinkWithName", { name: row.displayName })
        : t("contributors.unmappedLink")
      : row.source?.kind === "user"
        ? row.displayName
          ? t("contributors.unmappedUserWithName", { name: row.displayName })
          : t("contributors.unmappedUser")
        : t("contributors.unattributed");
  }, [t]);
  const sortedRows = useMemo(() => {
    const direction = isAscending ? 1 : -1;
    return [...rows].sort((left, right) => {
      const leftValue = left[sortKey] ?? -1;
      const rightValue = right[sortKey] ?? -1;
      return (
        (leftValue - rightValue) * direction ||
        contributorLabel(left).localeCompare(contributorLabel(right), locale)
      );
    });
  }, [contributorLabel, isAscending, locale, rows, sortKey]);
  const maxRegistered = Math.max(1, ...rows.map((row) => row.registered));
  const changeSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setIsAscending((value) => !value);
    } else {
      setSortKey(nextKey);
      setIsAscending(false);
    }
  };
  const ariaSort = (
    key: SortKey,
  ): "ascending" | "descending" | "none" =>
    sortKey === key ? (isAscending ? "ascending" : "descending") : "none";

  return (
    <section className="app-panel" aria-labelledby="analytics-contributors-title">
      <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
        <h3 id="analytics-contributors-title" className="type-panel-title">
          {t("contributors.title")}
          <span className="ml-2 font-mono text-xs font-normal text-text-dim">{rows.length}</span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          {t("contributors.description")}
        </p>
      </div>
      <div className="border-b border-border-subtle p-4 sm:p-5">
        <div className="grid gap-3">
          {rows.slice(0, 10).map((row) => (
            <div key={row.contributorId ?? `${row.source?.kind}:${row.source?.id}`} className="grid gap-1.5 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)_4rem] sm:items-center sm:gap-3">
              <span className="truncate text-xs font-medium text-text-heading">{contributorLabel(row)}</span>
              <div className="h-2 bg-canvas" aria-hidden="true">
                <div className="h-full bg-action-primary" style={{ width: `${(row.registered / maxRegistered) * 100}%` }} />
              </div>
              <span className="font-mono text-xs tabular-nums text-text-muted sm:text-right">{numberFormat.format(row.registered)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-4 md:hidden">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-medium text-text-muted">
            <span className="mb-1 block">{t("contributors.sort")}</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="app-field py-2">
              <option value="registered">{t("summary.registered")}</option>
              <option value="checkedIn">{t("summary.checkedIn")}</option>
              <option value="entryRatePercent">{t("summary.entryRatePercent")}</option>
              <option value="operatingDays">{t("contributors.operatingDays")}</option>
            </select>
          </label>
          <button type="button" aria-pressed={isAscending} onClick={() => setIsAscending((value) => !value)} className="pressable mt-[1.25rem] min-h-11 border border-border-default bg-surface-raised px-3 py-2 text-xs font-medium text-text-muted">
            {isAscending ? t("contributors.ascending") : t("contributors.descending")}
          </button>
        </div>
        {sortedRows.map((row) => (
          <article key={row.contributorId ?? `${row.source?.kind}:${row.source?.id}`} className="border border-border-default bg-canvas p-3">
            <h4 className="text-sm font-semibold text-text-heading">{contributorLabel(row)}</h4>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
              {(["registered", "checkedIn", "operatingDays"] as const).map((key) => (
                <div key={key}>
                  <dt className="text-text-dim">{key === "operatingDays" ? t("contributors.operatingDays") : t(`summary.${key}`)}</dt>
                  <dd className="mt-1 font-mono tabular-nums text-text-body">{numberFormat.format(row[key])}</dd>
                </div>
              ))}
              <div>
                <dt className="text-text-dim">{t("summary.entryRatePercent")}</dt>
                <dd className="mt-1 font-mono tabular-nums text-text-body">{row.entryRatePercent === null ? "—" : `${numberFormat.format(row.entryRatePercent)}%`}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-canvas text-xs text-text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">{t("contributors.name")}</th>
              {(["registered", "checkedIn", "entryRatePercent", "operatingDays"] as const).map((key) => (
                <th key={key} scope="col" aria-sort={ariaSort(key)} className="px-3 py-2 text-right font-medium">
                  <button type="button" onClick={() => changeSort(key)} className="min-h-11 px-1 text-xs text-text-muted hover:text-text-heading">
                    {key === "operatingDays" ? t("contributors.operatingDays") : t(`summary.${key}`)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.contributorId ?? `${row.source?.kind}:${row.source?.id}`} className="border-t border-border-subtle">
                <th scope="row" className="px-4 py-3 text-sm font-medium text-text-heading">{contributorLabel(row)}</th>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{numberFormat.format(row.registered)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{numberFormat.format(row.checkedIn)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{row.entryRatePercent === null ? "—" : `${numberFormat.format(row.entryRatePercent)}%`}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{numberFormat.format(row.operatingDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
