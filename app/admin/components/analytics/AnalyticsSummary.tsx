"use client";

import { useLocale, useTranslations } from "next-intl";
import type {
  AnalyticsMetricComparison,
  AnalyticsSummary as AnalyticsSummaryDto,
} from "@/lib/analytics/types";

interface AnalyticsSummaryProps {
  summary: AnalyticsSummaryDto;
}

function signed(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1).replace(/\.0$/, "")}${suffix}`;
}

export default function AnalyticsSummary({ summary }: AnalyticsSummaryProps) {
  const t = useTranslations("AdminAnalytics");
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const items: Array<{
    id: keyof AnalyticsSummaryDto;
    metric: AnalyticsMetricComparison;
    suffix?: string;
  }> = [
    { id: "registered", metric: summary.registered },
    { id: "checkedIn", metric: summary.checkedIn },
    { id: "entryRatePercent", metric: summary.entryRatePercent, suffix: "%" },
    { id: "registeredPerEvent", metric: summary.registeredPerEvent },
  ];

  return (
    <section className="app-panel" aria-labelledby="analytics-summary-title">
      <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
        <h3 id="analytics-summary-title" className="type-panel-title">
          {t("summary.title")}
        </h3>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(({ id, metric, suffix = "" }, index) => {
          const hasValue = metric.value !== null;
          const comparison =
            metric.status === "not_calculable" || metric.delta === null
              ? t("comparison.notCalculable")
              : metric.status === "zero_baseline"
                ? `${signed(metric.delta, suffix)} · ${t("comparison.noBaseline")}`
                : metric.deltaKind === "percentage_point"
                  ? signed(metric.delta, t("comparison.percentagePoint"))
                  : `${signed(metric.delta, suffix)} (${signed(metric.relativeChangePercent ?? 0, "%")})`;
          return (
            <div
              key={id}
              className={`min-w-0 bg-surface p-4 sm:p-5 ${
                index > 0 ? "border-t border-border-subtle sm:border-t-0 sm:border-l" : ""
              } ${index === 2 ? "sm:border-l-0 xl:border-l" : ""} ${
                index >= 2 ? "sm:border-t xl:border-t-0" : ""
              }`}
            >
              <dt className="text-xs font-medium text-text-muted">
                {t(`summary.${id}`)}
              </dt>
              <dd className="mt-2 font-mono text-2xl font-semibold tabular-nums text-text-heading">
                {hasValue ? `${numberFormat.format(metric.value ?? 0)}${suffix}` : "—"}
              </dd>
              <p className="mt-2 min-h-5 text-xs leading-relaxed text-text-muted">
                {comparison}
              </p>
            </div>
          );
        })}
      </dl>
      <p className="border-t border-border-subtle px-4 py-3 text-xs leading-relaxed text-text-dim sm:px-5">
        {t("summary.registrationDefinition")}
      </p>
    </section>
  );
}
