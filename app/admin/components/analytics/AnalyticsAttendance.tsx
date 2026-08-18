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
import type {
  AnalyticsAttendanceSummary,
  AnalyticsAttendanceView,
  AnalyticsMetricComparison,
} from "@/lib/analytics/types";

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1).replace(/\.0$/, "")}`;
}

export default function AnalyticsAttendance({
  attendance,
}: {
  attendance: AnalyticsAttendanceView;
}) {
  const t = useTranslations("AdminAnalytics");
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  });
  const formatDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: day === 1 ? undefined : "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };
  const items: Array<{
    id: keyof AnalyticsAttendanceSummary;
    metric: AnalyticsMetricComparison;
  }> = [
    {
      id: "totalAttendance",
      metric: attendance.summary.totalAttendance,
    },
    {
      id: "checkedInGuests",
      metric: attendance.summary.checkedInGuests,
    },
    { id: "walkIns", metric: attendance.summary.walkIns },
    {
      id: "attendancePerOperatingDay",
      metric: attendance.summary.attendancePerOperatingDay,
    },
  ];
  const metricLabel = (key: string) => t(`attendance.${key}`);

  return (
    <section className="app-panel" aria-labelledby="analytics-attendance-title">
      <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
        <h3 id="analytics-attendance-title" className="type-panel-title">
          {t("attendance.title")}
        </h3>
        <p className="mt-1 max-w-[75ch] text-xs leading-relaxed text-text-muted">
          {t("attendance.description")}
        </p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(({ id, metric }, index) => {
          const comparison =
            metric.status === "not_calculable" || metric.delta === null
              ? t("comparison.notCalculable")
              : metric.status === "zero_baseline"
                ? `${signed(metric.delta)} · ${t("comparison.noBaseline")}`
                : `${signed(metric.delta)} (${signed(metric.relativeChangePercent ?? 0)}%)`;
          return (
            <div
              key={id}
              className={`min-w-0 bg-surface p-4 sm:p-5 ${
                index > 0
                  ? "border-t border-border-subtle sm:border-t-0 sm:border-l"
                  : ""
              } ${index === 2 ? "sm:border-l-0 xl:border-l" : ""} ${
                index >= 2 ? "sm:border-t xl:border-t-0" : ""
              }`}
            >
              <dt className="text-xs font-medium text-text-muted">
                {metricLabel(id)}
              </dt>
              <dd className="mt-2 font-mono text-2xl font-semibold tabular-nums text-text-heading">
                {metric.value === null
                  ? "—"
                  : numberFormat.format(metric.value)}
              </dd>
              <p className="mt-2 min-h-5 text-xs leading-relaxed text-text-muted">
                {comparison}
              </p>
            </div>
          );
        })}
      </dl>

      <div className="border-t border-border-subtle p-3 sm:p-5">
        <h4 className="text-sm font-semibold text-text-heading">
          {t("attendance.trendTitle")}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          {t("attendance.trendDescription")}
        </p>

        {attendance.trend.length === 0 ? (
          <p className="mt-4 border border-border-subtle bg-canvas px-4 py-6 text-center text-sm text-text-muted">
            {t("attendance.empty")}
          </p>
        ) : (
          <>
            <div aria-hidden="true" className="mt-4 h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={attendance.trend}
                  margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="var(--app-border-subtle)"
                    vertical={false}
                  />
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
                      metricLabel(String(name)),
                    ]}
                    contentStyle={{
                      border: "1px solid var(--app-border)",
                      borderRadius: 0,
                      background: "var(--app-surface-raised)",
                      color: "var(--app-text)",
                      fontSize: 12,
                    }}
                  />
                  <Legend formatter={(value) => metricLabel(value)} />
                  <Line
                    type="linear"
                    dataKey="totalAttendance"
                    stroke="var(--app-action)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "var(--app-action)" }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="checkedInGuests"
                    stroke="var(--app-text-muted)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 3, fill: "var(--app-surface)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="walkIns"
                    stroke="var(--app-status-waiting)"
                    strokeWidth={2}
                    strokeDasharray="2 4"
                    dot={{ r: 3, fill: "var(--app-surface)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 overflow-x-auto border border-border-subtle">
              <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
                <caption className="sr-only">
                  {t("attendance.tableTitle")}
                </caption>
                <thead className="bg-canvas text-text-dim">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("attendance.date")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t("attendance.checkedInGuests")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t("attendance.walkIns")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t("attendance.totalAttendance")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle bg-surface">
                  {attendance.trend.map((point) => (
                    <tr key={point.bucketStartDate}>
                      <th scope="row" className="px-3 py-2 font-medium text-text-heading">
                        {formatDate(point.bucketStartDate)}
                      </th>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-text-body">
                        {numberFormat.format(point.checkedInGuests)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-text-body">
                        {numberFormat.format(point.walkIns)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-text-heading">
                        {numberFormat.format(point.totalAttendance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <p className="border-t border-border-subtle px-4 py-3 text-xs leading-relaxed text-text-dim sm:px-5">
        {t("attendance.definition")}
      </p>
    </section>
  );
}
