"use client";

import { useLocale, useTranslations } from "next-intl";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import type {
  AdminAnalyticsView,
  AnalyticsGranularity,
} from "@/lib/analytics/types";

interface AnalyticsPeriodBarProps {
  granularity: AnalyticsGranularity;
  view: AdminAnalyticsView | null;
  isLoading: boolean;
  onGranularityChange: (granularity: AnalyticsGranularity) => void;
  onAnchorDateChange: (anchorDate: string) => void;
  onRefresh: () => void;
}

function formatPeriodLabel(
  locale: string,
  view: AdminAnalyticsView,
): string {
  const [year, month] = view.period.startDate.split("-").map(Number);
  if (view.period.granularity === "year") {
    return new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, 0, 1)));
  }
  if (view.period.granularity === "quarter") {
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
  onGranularityChange,
  onAnchorDateChange,
  onRefresh,
}: AnalyticsPeriodBarProps) {
  const t = useTranslations("AdminAnalytics");
  const locale = useLocale();
  const granularities: AnalyticsGranularity[] = ["month", "quarter", "year"];

  return (
    <div className="context-bar analytics-period-bar">
      <div className="grid gap-3 xl:grid-cols-[auto_minmax(16rem,1fr)_auto] xl:items-end">
        <fieldset className="min-w-0">
          <legend className="type-context-title">{t("period.granularity")}</legend>
          <div className="grid grid-cols-3 border border-border-default bg-canvas">
            {granularities.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={granularity === item}
                onClick={() => onGranularityChange(item)}
                className={`pressable min-h-11 border-r border-border-default px-3 py-2 text-sm font-medium last:border-r-0 ${
                  granularity === item
                    ? "bg-action-primary text-action-text"
                    : "bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text-heading"
                }`}
              >
                {t(`period.${item}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="min-w-0">
          <span className="type-context-title">{t("period.selected")}</span>
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] border border-border-default bg-canvas">
            <button
              type="button"
              aria-label={t("period.previous")}
              disabled={!view || isLoading}
              onClick={() =>
                view && onAnchorDateChange(view.navigation.previousAnchorDate)
              }
              className="pressable flex min-h-11 items-center justify-center border-r border-border-default text-text-muted hover:bg-surface-hover hover:text-text-heading disabled:opacity-40"
            >
              <Icon name="chevron-left" size={18} />
            </button>
            <div className="flex min-h-11 min-w-0 items-center justify-center px-3 py-2 text-center">
              <span className="truncate text-sm font-semibold text-text-heading">
                {view ? formatPeriodLabel(locale, view) : t("period.loading")}
              </span>
              {view?.period.status === "in_progress" && (
                <span className="ml-2 shrink-0 text-xs text-status-waiting">
                  {t("period.inProgress")}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label={t("period.next")}
              disabled={!view?.navigation.nextAnchorDate || isLoading}
              onClick={() =>
                view?.navigation.nextAnchorDate &&
                onAnchorDateChange(view.navigation.nextAnchorDate)
              }
              className="pressable flex min-h-11 items-center justify-center border-l border-border-default text-text-muted hover:bg-surface-hover hover:text-text-heading disabled:opacity-40"
            >
              <Icon name="chevron-right" size={18} />
            </button>
          </div>
        </div>

        <Button
          variant="secondary"
          onClick={onRefresh}
          disabled={!view}
          isLoading={isLoading}
          leftIcon={<Icon name="refresh" size={16} />}
          className="w-full xl:w-auto"
        >
          {t("refresh")}
        </Button>
      </div>
      {view && (
        <p className="text-xs leading-relaxed text-text-muted" aria-live="polite">
          {t("coverage.summary", {
            confirmed: view.coverage.confirmedEvents,
            days: view.coverage.operatingDays,
            unconfirmed: view.coverage.unconfirmedClosedEvents,
          })}{" · "}
          {t("period.comparison", {
            start: view.comparisonPeriod.startDate,
            end: view.comparisonPeriod.endDateExclusive,
          })}
        </p>
      )}
    </div>
  );
}
