"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsTrendPoint } from "@/lib/analytics/types";

export default function AnalyticsTrend({ points }: { points: AnalyticsTrendPoint[] }) {
  const t = useTranslations("AdminAnalytics");
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale);
  const formatDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: day === 1 ? undefined : "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };

  return (
    <section className="app-panel" aria-labelledby="analytics-trend-title">
      <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
        <h3 id="analytics-trend-title" className="type-panel-title">
          {t("trend.title")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          {t("trend.description")}
        </p>
      </div>
      <div className="p-3 sm:p-5">
        <div aria-hidden="true" className="h-64 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="var(--app-border-subtle)" vertical={false} />
              <XAxis
                dataKey="bucketStartDate"
                tickFormatter={formatDate}
                stroke="var(--app-border-strong)"
                tick={{ fill: "var(--app-text-muted)", fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                stroke="var(--app-border-strong)"
                tick={{ fill: "var(--app-text-muted)", fontSize: 11 }}
              />
              <Tooltip
                labelFormatter={(value) => formatDate(String(value))}
                formatter={(value, name) => [
                  numberFormat.format(Number(value)),
                  name === "registered" ? t("summary.registered") : t("summary.checkedIn"),
                ]}
                contentStyle={{
                  border: "1px solid var(--app-border)",
                  borderRadius: 0,
                  background: "var(--app-surface-raised)",
                  color: "var(--app-text)",
                  fontSize: 12,
                }}
              />
              <Legend
                formatter={(value) =>
                  value === "registered" ? t("summary.registered") : t("summary.checkedIn")
                }
              />
              <Line
                type="linear"
                dataKey="registered"
                stroke="var(--app-action)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--app-action)" }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="checkedIn"
                stroke="var(--app-text-muted)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 3, fill: "var(--app-surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 border-t border-border-subtle pt-3">
          <p className="mb-2 text-xs font-medium text-text-muted">
            {t("trend.tableTitle")}
          </p>
          <div className="mb-px grid grid-cols-3 bg-canvas px-3 py-2 text-xs font-medium text-text-dim">
            <span>{t("trend.date")}</span>
            <span className="text-right">{t("summary.registered")}</span>
            <span className="text-right">{t("summary.checkedIn")}</span>
          </div>
          <div className="grid gap-px bg-border-subtle sm:grid-cols-2 xl:grid-cols-3">
            {points.map((point) => (
              <dl key={point.bucketStartDate} className="grid grid-cols-3 bg-surface px-3 py-2 text-xs">
                <div>
                  <dt className="sr-only">{t("trend.date")}</dt>
                  <dd className="font-medium text-text-heading">{formatDate(point.bucketStartDate)}</dd>
                </div>
                <div className="text-right">
                  <dt className="sr-only">{t("summary.registered")}</dt>
                  <dd className="font-mono tabular-nums text-text-body">{numberFormat.format(point.registered)}</dd>
                </div>
                <div className="text-right">
                  <dt className="sr-only">{t("summary.checkedIn")}</dt>
                  <dd className="font-mono tabular-nums text-text-muted">{numberFormat.format(point.checkedIn)}</dd>
                </div>
              </dl>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
