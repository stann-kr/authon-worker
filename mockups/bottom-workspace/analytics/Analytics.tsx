import "./analytics.css";
import { useState } from "react";
import { isBusinessDate } from "../../../lib/events/domain";
import {
  resolveAnalyticsPeriod,
  isDateInAnalyticsRange,
} from "../../../lib/analytics/period";
import {
  summarizeAnalyticsGuestDays,
  buildAnalyticsSummary,
  summarizeAnalyticsAttendanceDays,
} from "../../../lib/analytics/metrics";
import type {
  AnalyticsDateRange,
  AnalyticsGranularity,
  AnalyticsPeriodSelection,
} from "../../../lib/analytics/types";
import { useMock, activeGuests, attendanceFor } from "../data/MockData";
import { MOCK_DATE, MOCK_NOW, type MockState } from "../data/types";
import { buildReport } from "../events/Reports";
import {
  Action,
  Empty,
  Field,
  Metrics,
  Notice,
  Select,
  Tabs,
} from "../shared/ui";
function inclusiveEndDate(endExclusive: string) {
  const date = new Date(`${endExclusive}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function PeriodDate({ value, periodKey, onChange }: { value: string; periodKey: string; onChange: (date: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(periodKey);
  if (source !== periodKey) {
    setSource(periodKey);
    setDraft(value);
  }
  return <Field
    label="선택 기간" type="date" value={draft} max={MOCK_DATE} required
    error={!isBusinessDate(draft) ? "날짜를 확인해주세요." : undefined}
    onChange={(e) => {
      const date = e.target.value;
      setDraft(date);
      if (isBusinessDate(date)) onChange(date);
    }}
  />;
}
function periodRows(
  data: MockState,
  venueId: string,
  range: AnalyticsDateRange,
) {
  const days = new Map<
    string,
    {
      businessDate: string;
      registered: number;
      checkedIn: number;
      walkIns: number;
    }
  >();
  for (const event of data.events.filter(
    (e) => e.venueId === venueId && isDateInAnalyticsRange(e.date, range),
  )) {
    const guests = activeGuests(data, event.id),
      a = attendanceFor(data, event.id);
    const checked = guests.filter((g) => g.status === "checked").length;
    if (!guests.length && !checked && !a.walkIns) continue;
    const row = days.get(event.date) ?? {
      businessDate: event.date,
      registered: 0,
      checkedIn: 0,
      walkIns: 0,
    };
    row.registered += guests.length;
    row.checkedIn += checked;
    row.walkIns += a.finalized
      ? Math.max(0, (a.finalTotal ?? checked + a.walkIns) - checked)
      : a.walkIns;
    days.set(event.date, row);
  }
  return [...days.values()].sort((a, b) =>
    a.businessDate.localeCompare(b.businessDate),
  );
}
export function Analytics() {
  const { data, venue, scenario, chooseEvent, navigate, t, analyticsPeriod, setAnalyticsPeriod } = useMock();
  const { granularity, anchorDate: anchor } = analyticsPeriod;
  const setGranularity = (granularity: AnalyticsGranularity) =>
    setAnalyticsPeriod({ ...analyticsPeriod, granularity });
  const setAnchor = (anchorDate: string) =>
    setAnalyticsPeriod({ ...analyticsPeriod, anchorDate });
  const [sort, setSort] = useState("registered"),
    [direction, setDirection] = useState("desc");
  let selection: AnalyticsPeriodSelection | null = null;
  try {
    selection = resolveAnalyticsPeriod({
      granularity,
      anchorDate: anchor,
      timezone: venue.timezone,
      now: new Date(MOCK_NOW),
    });
  } catch {
    /* Invalid date input remains editable. */
  }
  const current = selection
    ? periodRows(data, venue.id, {
        startDate: selection.period.startDate,
        endDateExclusive: selection.period.dataEndDateExclusive,
      })
    : [];
  const prior = selection
    ? periodRows(data, venue.id, selection.comparisonPeriod)
    : [];
  const summary = buildAnalyticsSummary(
    summarizeAnalyticsGuestDays(current.filter((r) => r.registered > 0)),
    summarizeAnalyticsGuestDays(prior.filter((r) => r.registered > 0)),
  );
  const attendance = summarizeAnalyticsAttendanceDays(
    current
      .filter((r) => r.checkedIn + r.walkIns > 0)
      .map((r) => ({
        businessDate: r.businessDate,
        checkedInGuests: r.checkedIn,
        walkIns: r.walkIns,
      })),
  );
  const selectedEvents = selection
    ? data.events.filter(
        (e) =>
          e.venueId === venue.id &&
          isDateInAnalyticsRange(e.date, {
            startDate: selection.period.startDate,
            endDateExclusive: selection.period.dataEndDateExclusive,
          }),
      )
    : [];
  const contributors = new Map<
    string,
    {
      key: string;
      name: string;
      registered: number;
      checked: number;
      days: Set<string>;
    }
  >();
  for (const e of selectedEvents) {
    const report = data.reports[e.id] ?? buildReport(data, e.id);
    for (const c of report.contributors) {
      const row = contributors.get(c.key) ?? {
        key: c.key,
        name: c.name,
        registered: 0,
        checked: 0,
        days: new Set<string>(),
      };
      row.registered += c.registered;
      row.checked += c.checked;
      row.days.add(e.date);
      contributors.set(c.key, row);
    }
  }
  const contributorsList = [...contributors.values()].sort((a, b) => {
    const diff =
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "rate"
          ? a.checked / Math.max(1, a.registered) -
            b.checked / Math.max(1, b.registered)
          : sort === "days"
            ? a.days.size - b.days.size
            : sort === "checked"
              ? a.checked - b.checked
              : a.registered - b.registered;
    return direction === "desc" ? -diff : diff;
  });
  const buckets = new Map<
    string,
    { registered: number; checked: number; walkIns: number }
  >();
  for (const row of current) {
    const key =
      granularity === "month" ? row.businessDate : row.businessDate.slice(0, 7);
    const b = buckets.get(key) ?? { registered: 0, checked: 0, walkIns: 0 };
    b.registered += row.registered;
    b.checked += row.checkedIn;
    b.walkIns += row.walkIns;
    buckets.set(key, b);
  }
  const series = [...buckets.entries()];
  return (
    <div className="flow-section analytics-section">
      <div className="flow-filter-stack">
      <Tabs
        value={granularity}
        onChange={(v) => setGranularity(v as AnalyticsGranularity)}
        items={[
          { id: "month", label: "월" },
          { id: "quarter", label: "분기" },
          { id: "year", label: "연" },
        ]}
      />
      <div className="analytics-period-controls">
      <PeriodDate
        periodKey={`${granularity}:${anchor}`}
        value={anchor}
        onChange={setAnchor}
      />
      <div className="button-row">
        <Action
          secondary
          aria-label={t("이전 기간")}
          disabled={!selection}
          onClick={() =>
            selection && setAnchor(selection.navigation.previousAnchorDate)
          }
        >
          <span className="sr-only">{t("이전 기간")}</span>
          <span aria-hidden="true">←</span>
        </Action>
        <Action
          secondary
          aria-label={t("다음 기간")}
          disabled={!selection?.navigation.nextAnchorDate}
          onClick={() =>
            selection?.navigation.nextAnchorDate &&
            setAnchor(selection.navigation.nextAnchorDate)
          }
        >
          <span className="sr-only">{t("다음 기간")}</span>
          <span aria-hidden="true">→</span>
        </Action>
      </div>
      </div>
      </div>
      {!selection ? (
        <Notice error>
          이 기간은 조회할 수 없습니다. 현재 또는 이전 기간을 선택해주세요.
        </Notice>
      ) : (
        <>
          <div className="analytics-period-caption">
          <p className="analytics-period-summary" role="status">{`${selection.period.startDate} — ${inclusiveEndDate(selection.period.dataEndDateExclusive)} · ${t(selection.period.status === "in_progress" ? "진행 중" : "완료")}`}</p>
          <p className="flow-hint">
            {t("{start}~{end} 이전 기간 비교", {
              start: selection.comparisonPeriod.startDate,
              end: inclusiveEndDate(selection.comparisonPeriod.endDateExclusive),
            })}
          </p>
          </div>
          <h2 className="flow-subheading">{t("핵심 결과")}</h2>
          <div className="flow-metrics">
            {Object.entries(summary).map(([key, metric]) => (
              <div key={key}>
                <div className="quiet">
                  {t(
                    (
                      {
                        registered: "총 게스트 등록",
                        checkedIn: "입장 게스트",
                        entryRatePercent: "입장률",
                        registeredPerOperatingDay: "영업일당 평균 등록",
                      } as Record<string, string>
                    )[key],
                  )}
                </div>
                <strong>
                  {metric.value === null ? "—" : metric.value}
                  {key === "entryRatePercent" && metric.value !== null
                    ? "%"
                    : ""}
                </strong>
                <small className="quiet">
                  {metric.status === "zero_baseline"
                    ? t("비교 기준 없음")
                    : metric.status === "not_calculable"
                      ? t("비교 계산 불가")
                      : `${metric.delta! >= 0 ? "+" : ""}${metric.delta}${metric.deltaKind === "percentage_point" ? "%p" : ""}`}
                </small>
              </div>
            ))}
          </div>
          <Metrics
            items={[
              { label: "총 입장객", value: attendance.totalAttendance },
              { label: "워크인", value: attendance.walkIns },
              { label: "입장 게스트", value: attendance.checkedInGuests },
              {
                label: "영업일당 입장객",
                value: attendance.attendancePerOperatingDay ?? "—",
              },
            ]}
          />
          {!current.length && <Empty text="이 기간에 게스트 등록이 없습니다" />}
          {["registered", "attendance"].map((kind) => (
            <section key={kind} className="analytics-trend">
              <h2 className="flow-subheading">
                {t(kind === "registered" ? "기간 추이" : "전체 입장 추이")}
              </h2>
              <div className="flow-chart">
                {series.map(([date, row]) => {
                  const value =
                      kind === "registered"
                        ? row.registered
                        : row.checked + row.walkIns,
                    max = Math.max(
                      1,
                      ...series.map(([, r]) =>
                        kind === "registered"
                          ? r.registered
                          : r.checked + r.walkIns,
                      ),
                    );
                  return (
                    <div className="flow-chart-row" key={date}>
                      <span>{date}</span>
                      <div className="flow-chart-track">
                        <i style={{ width: `${(value / max) * 100}%` }} />
                      </div>
                      <strong>{value}</strong>
                    </div>
                  );
                })}
              </div>
              <details className="flow-details">
                <summary>
                  {t(
                    kind === "registered"
                      ? "게스트 추이 데이터 보기"
                      : "입장 추이 데이터 보기",
                  )}
                </summary>
                <div className="flow-table-wrap">
                  <table className="flow-table">
                    <thead>
                      <tr>
                        {[
                          "기간",
                          kind === "registered" ? "등록" : "총 입장객",
                          "입장 게스트",
                          "워크인",
                        ].map((l) => (
                          <th key={l}>{t(l)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {series.map(([date, row]) => (
                        <tr key={date}>
                          <td>{date}</td>
                          <td>
                            {kind === "registered"
                              ? row.registered
                              : row.checked + row.walkIns}
                          </td>
                          <td>{row.checked}</td>
                          <td>{row.walkIns}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          ))}
          <h2 className="flow-subheading">{t("DJ·기여자별 게스트")}</h2>
          <div className="flow-inline-fields">
            <Select
              label="정렬 기준"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {[
                ["registered", "등록"],
                ["checked", "입장"],
                ["rate", "입장률"],
                ["days", "등록 영업일"],
                ["name", "이름"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {t(l)}
                </option>
              ))}
            </Select>
            <Select
              label="정렬"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="desc">{t("내림차순")}</option>
              <option value="asc">{t("오름차순")}</option>
            </Select>
          </div>
          <div className="flow-table-wrap">
            <table className="flow-table">
              <thead>
                <tr>
                  {["이름", "등록", "입장", "입장률", "등록 영업일"].map(
                    (l) => (
                      <th key={l}>{t(l)}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {contributorsList.map((c) => (
                  <tr key={c.key}>
                    <td>{c.name}</td>
                    <td>{c.registered}</td>
                    <td>{c.checked}</td>
                    <td>
                      {Math.round(
                        (c.checked / Math.max(1, c.registered)) * 100,
                      )}
                      %
                    </td>
                    <td>{c.days.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="flow-subheading">{t("행사별 결과")}</h2>
          {selectedEvents
            .filter((e) => !e.general)
            .map((e) => (
              <button
                className="flow-row-button"
                key={e.id}
                onClick={() => {
                  chooseEvent(e.id);
                  navigate("report");
                }}
              >
                <span>
                  <strong>{e.name}</strong>
                  <small>{e.date}</small>
                </span>
                <span className="status-badge">
                  {t(
                    data.reports[e.id]
                      ? "확정"
                      : e.state === "closed"
                        ? "미확정 종료"
                        : e.state === "open"
                          ? "운영 중"
                          : "초안",
                  )}
                </span>
              </button>
            ))}
          <details className="flow-details">
            <summary>{t("데이터 상세")}</summary>
            <Metrics
              items={[
                {
                  label: "확정 행사",
                  value: selectedEvents.filter((e) => data.reports[e.id])
                    .length,
                },
                { label: "집계 영업일", value: current.length },
                {
                  label: "미확정 종료",
                  value: selectedEvents.filter(
                    (e) => e.state === "closed" && !data.reports[e.id],
                  ).length,
                },
                {
                  label: "미확정 일반 명단",
                  value: selectedEvents.filter((e) => e.general).length,
                },
              ]}
            />
            {scenario === "report-inconsistent" && (
              <Notice error>
                확정한 행사 총계와 담당자별 합계가 일치하지 않습니다. 해당
                행사의 마감 리포트를 확인해주세요.
              </Notice>
            )}
            <Metrics
              items={[
                {
                  label: "운영 중",
                  value: selectedEvents.filter(
                    (e) => e.state === "open" && !e.general,
                  ).length,
                },
                {
                  label: "초안",
                  value: selectedEvents.filter((e) => e.state === "draft")
                    .length,
                },
                {
                  label: "변경 확인 필요",
                  value: scenario === "report-inconsistent" ? 1 : 0,
                },
                {
                  label: "기여자 연결률",
                  value: summary.registered.value
                    ? `${Math.round((selectedEvents.flatMap((e) => activeGuests(data, e.id)).filter((g) => (g.externalLinkId ? Boolean(data.links.find((l) => l.id === g.externalLinkId)?.contributorUserId ?? data.links.find((l) => l.id === g.externalLinkId)?.contributorKey) : Boolean(data.users.find((u) => u.id === g.ownerId)))).length / (summary.registered.value ?? 1)) * 100)}%`
                    : "—",
                },
              ]}
            />
            <p className="flow-hint">
              {t(
                "게스트는 현재 명단을 기준으로 집계합니다. 마감한 입장은 확정 당시 수치를 사용합니다.",
              )}
            </p>
            <p className="flow-hint">
              {t(
                "총 입장객은 입장 게스트와 순 워크인의 합계이며, 고유 방문자 수가 아닙니다. 입장이 기록된 날만 입장 영업일에 포함합니다.",
              )}
            </p>
          </details>
        </>
      )}
    </div>
  );
}
