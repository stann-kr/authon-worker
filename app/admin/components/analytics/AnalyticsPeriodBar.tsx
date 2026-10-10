"use client";

import { useLocale, useTranslations } from "next-intl";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import Spinner from "@/components/Spinner";
import { FULL_CALENDAR_DATE, formatCalendarDate } from "@/lib/ui/date-format";
import type {
  AdminAnalyticsView,
  AnalyticsGranularity,
} from "@/lib/analytics/types";

interface AnalyticsPeriodBarProps {
  granularity: AnalyticsGranularity;
  view: AdminAnalyticsView | null;
  isLoading: boolean;
  /** The requested period; labels it while its data is still loading. */
  anchorDate?: string;
  onGranularityChange: (granularity: AnalyticsGranularity) => void;
  onAnchorDateChange: (anchorDate: string) => void;
  onRefresh: () => void;
}

function inclusiveEndDate(endDateExclusive: string): string {
  const date = new Date(`${endDateExclusive}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function formatPeriodLabel(
  locale: string,
  granularity: AnalyticsGranularity,
  dateInPeriod: string,
): string {
  const [year, month] = dateInPeriod.split("-").map(Number);
  if (granularity === "year") {
    return new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, 0, 1)));
  }
  if (granularity === "quarter") {
    const quarter = Math.floor((month - 1) / 3) + 1;
    return locale === "ko" ? `${year}년 ${quarter}분기` : `Q${quarter} ${year}`;
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export default function AnalyticsPeriodBar({
  granularity,
  view,
  isLoading,
  anchorDate,
  onGranularityChange,
  onAnchorDateChange,
  onRefresh,
}: AnalyticsPeriodBarProps) {
  const t = useTranslations("AdminAnalytics");
  const locale = useLocale();
  const granularities: AnalyticsGranularity[] = ["month", "quarter", "year"];
  // Unavailable controls stay focusable (aria-disabled) so a refetch never drops keyboard focus.
  const previousAnchorDate = isLoading ? null : view?.navigation.previousAnchorDate ?? null;
  const nextAnchorDate = isLoading ? null : view?.navigation.nextAnchorDate ?? null;
  const canRefresh = Boolean(view) && !isLoading;
  const periodLabel = isLoading && anchorDate
    ? formatPeriodLabel(locale, granularity, anchorDate)
    : view
      ? formatPeriodLabel(locale, view.period.granularity, view.period.startDate)
      : t("period.loading");
  const formatDate = (value: string) => formatCalendarDate(locale, value, FULL_CALENDAR_DATE);

  return (
    <div className="context-bar analytics-period-bar">
      <div className="grid gap-3 xl:grid-cols-[auto_minmax(16rem,1fr)] xl:items-end">
        <fieldset className="min-w-0">
          <legend className="type-context-title">{t("period.granularity")}</legend>
          <div className="grid grid-cols-3 gap-2">
            {granularities.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={granularity === item}
                onClick={() => onGranularityChange(item)}
                className={`pressable min-h-11 rounded-control border px-4 py-2 text-sm font-medium ${
                  granularity === item
                    ? "border-border-strong bg-surface-active text-text-heading"
                    : "border-border-default bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text-heading"
                }`}
              >
                {t(`period.${item}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="min-w-0">
          <span className="type-context-title">{t("period.selected")}</span>
          <div className="flex gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] rounded-control border border-border-default bg-canvas">
            <button
              type="button"
              aria-label={t("period.previous")}
              aria-disabled={!previousAnchorDate}
              onClick={() =>
                previousAnchorDate && onAnchorDateChange(previousAnchorDate)
              }
              className="pressable flex min-h-11 items-center justify-center rounded-none rounded-l-[calc(var(--app-radius-control)_-_1px)] border-r border-border-default text-text-muted hover:bg-surface-hover hover:text-text-heading aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              <Icon name="chevron-left" size={18} />
            </button>
            <div className="flex min-h-11 min-w-0 items-center justify-center px-3 py-2 text-center">
              <span className="truncate text-sm font-semibold text-text-heading">
                {periodLabel}
              </span>
              {!isLoading && view?.period.status === "in_progress" && (
                <span className="ml-2 shrink-0 text-xs text-status-waiting">
                  {t("period.inProgress")}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label={t("period.next")}
              aria-disabled={!nextAnchorDate}
              onClick={() =>
                nextAnchorDate && onAnchorDateChange(nextAnchorDate)
              }
              className="pressable flex min-h-11 items-center justify-center rounded-none rounded-r-[calc(var(--app-radius-control)_-_1px)] border-l border-border-default text-text-muted hover:bg-surface-hover hover:text-text-heading aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              <Icon name="chevron-right" size={18} />
            </button>
          </div>
          <Button
            variant="secondary"
            onClick={() => canRefresh && onRefresh()}
            aria-disabled={!canRefresh}
            aria-busy={isLoading}
            aria-label={t("refresh")}
            title={t("refresh")}
            className={`w-11 shrink-0 px-0 ${!view ? "aria-disabled:cursor-not-allowed aria-disabled:opacity-50" : ""}`}
          >
            {isLoading ? <Spinner mode="button" /> : <Icon name="refresh" size={16} />}
          </Button>
          </div>
        </div>
      </div>
      {view && (
        // The previous period's coverage would contradict the new label, so a refetch shows its own status.
        // Each fact wraps as a unit so a narrow screen never splits a count from its unit.
        <p className={`break-keep text-xs leading-relaxed text-text-muted ${isLoading ? "opacity-50" : ""}`} aria-live="polite">
          {isLoading ? t("period.loading") : <>
            <span className="inline-block">
              {t("coverage.summary", { days: view.coverage.operatingDays })}
            </span>{" · "}
            <span className="inline-block">
              {t("period.comparison", {
                start: formatDate(view.comparisonPeriod.startDate),
                end: formatDate(inclusiveEndDate(view.comparisonPeriod.endDateExclusive)),
              })}
            </span>
          </>}
        </p>
      )}
    </div>
  );
}
