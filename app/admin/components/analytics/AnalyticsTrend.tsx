"use client";

import { useLocale, useTranslations } from "next-intl";
import DisclosureSection from "@/components/DisclosureSection";
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
import { formatBucketDate } from "@/lib/ui/date-format";

export default function AnalyticsTrend({ points }: { points: AnalyticsTrendPoint[] }) {
  const t = useTranslations("AdminAnalytics");
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale);
  const formatDate = (value: string) => formatBucketDate(locale, value);

  return (
    <section className="app-panel" aria-labelledby="analytics-trend-title">
      <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
        <h3 id="analytics-trend-title" className="type-panel-title">
          {t("trend.title")}
        </h3>
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
                  borderRadius: "var(--app-radius-panel)",
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
        <DisclosureSection title={t("trend.tableTitle")}>
          <div className="overflow-x-auto rounded-control border border-border-subtle">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="sr-only">{t("trend.tableTitle")}</caption>
              <thead className="bg-canvas text-text-dim">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{t("trend.date")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("summary.registered")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("summary.checkedIn")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle bg-surface">
                {points.map((point) => (
                  <tr key={point.bucketStartDate} className="even:bg-[var(--app-row-stripe)]">
                    <th scope="row" className="px-3 py-2 font-medium text-text-heading">{formatDate(point.bucketStartDate)}</th>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-text-body">{numberFormat.format(point.registered)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-text-muted">{numberFormat.format(point.checkedIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DisclosureSection>
      </div>
    </section>
  );
}
