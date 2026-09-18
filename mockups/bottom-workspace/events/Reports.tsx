import { useState } from "react";
import { useMock, activeGuests } from "../data/MockData";
import { assertCapability } from "../data/access";
import { MOCK_NOW, type MockState, type ReportData } from "../data/types";
import { Action, Confirm, Metrics, Notice, downloadCsv } from "../shared/ui";
import "./reports.css";
export function contributorName(
  data: MockState,
  ownerId: string,
  linkId: string | null,
) {
  if (linkId) {
    const link = data.links.find((l) => l.id === linkId);
    return link?.contributorUserId
      ? (data.users.find((u) => u.id === link.contributorUserId)?.name ??
          link.ownerName)
      : (link?.ownerName ?? "삭제된 기여자");
  }
  return data.users.find((u) => u.id === ownerId)?.name ?? "삭제된 기여자";
}
export function buildReport(data: MockState, eventId: string): ReportData {
  const guests = activeGuests(data, eventId);
  const all = data.guests.filter((g) => g.eventId === eventId);
  const groups = new Map<
    string,
    { key: string; name: string; registered: number; checked: number }
  >();
  for (const g of guests) {
    const name = contributorName(data, g.ownerId, g.externalLinkId);
    const key = g.externalLinkId
      ? (data.links.find((l) => l.id === g.externalLinkId)?.contributorUserId ??
        data.links.find((l) => l.id === g.externalLinkId)?.contributorKey ??
        g.externalLinkId)
      : g.ownerId;
    const row = groups.get(key) ?? { key, name, registered: 0, checked: 0 };
    row.registered++;
    if (g.status === "checked") row.checked++;
    groups.set(key, row);
  }
  const event = data.events.find((e) => e.id === eventId)!;
  const buckets = new Map<number, number>();
  for (const guest of all)
    for (const activity of guest.history ??
      (guest.checkedAt ? [{ kind: "check", at: guest.checkedAt }] : [])) {
      if (activity.kind !== "check") continue;
      const slot =
        Math.floor(new Date(activity.at).getTime() / 900000) * 900000;
      buckets.set(slot, (buckets.get(slot) ?? 0) + 1);
    }
  const peak = [...buckets].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const seconds = (start: string | null, end: string | null) =>
    start && end
      ? Math.max(
          0,
          Math.floor(
            (new Date(end).getTime() - new Date(start).getTime()) / 1000,
          ),
        )
      : null;
  return {
    peak: peak
      ? {
          at: new Date(peak[0]).toLocaleTimeString("en-GB", {
            timeZone:
              data.venues.find((v) => v.id === event.venueId)?.timezone ??
              "Asia/Seoul",
            hour: "2-digit",
            minute: "2-digit",
          }),
          count: peak[1],
        }
      : null,
    preparationSeconds: seconds(event.createdAt, event.openedAt),
    confirmationSeconds: seconds(event.closedAt, MOCK_NOW),
    confirmedAt: MOCK_NOW,
    registered: guests.length,
    checked: guests.filter((g) => g.status === "checked").length,
    noShow: guests.filter((g) => g.status === "pending").length,
    removals: all.filter((g) => g.status === "deleted").length,
    cancellations: all.reduce((n, g) => n + g.cancellations, 0),
    reentries: all.reduce((n, g) => n + Math.max(0, g.checkIns - 1), 0),
    contributors: [...groups.values()],
  };
}
export function Reports() {
  const { data, user, event, scenario, mutate, t, notice } = useMock();
  const [confirm, setConfirm] = useState(false);
  const snapshot = data.reports[event.id];
  const report = snapshot ?? buildReport(data, event.id);
  const inconsistent = scenario === "report-inconsistent";
  const canConfirm =
    ["closed", "archived"].includes(event.state) &&
    !inconsistent &&
    !snapshot &&
    !data.queue.some((q) => q.eventId === event.id && q.state === "queued");
  const csv = () =>
    downloadCsv(`authon-mockup-closeout-${event.date}.csv`, [
      [event.name, event.date, snapshot ? "확정" : "임시"],
      ["등록", "입장", "미입장", "입장률"],
      [
        report.registered,
        report.checked,
        report.noShow,
        report.registered
          ? Math.round((report.checked / report.registered) * 100)
          : 0,
      ],
      [],
      ["등록 담당자", "등록", "입장"],
      ...report.contributors.map((c) => [c.name, c.registered, c.checked]),
    ]);
  if (event.general)
    return (
      <Notice>
        일반 명단은 행사 마감 리포트를 만들 수 없습니다. 별도 행사를 선택해
        주세요.
      </Notice>
    );
  return (
    <div className="flow-section report-section">
      <div className="flow-toolbar">
        <strong>{event.name}</strong>
        <span className={`status-badge ${snapshot ? "green" : ""}`}>
          {t(
            snapshot
              ? "확정됨"
              : inconsistent
                ? "변경 확인 필요"
                : ["closed", "archived"].includes(event.state)
                  ? "확정 가능"
                  : "임시 리포트",
          )}
        </span>
      </div>
      {!snapshot && !["closed", "archived"].includes(event.state) && (
        <Notice>
          아직 임시 리포트입니다. 행사를 종료한 뒤 확정할 수 있습니다.
        </Notice>
      )}
      {inconsistent && (
        <Notice error>
          등록·입장 기록이 일치하지 않아 확정할 수 없습니다. 기록을
          확인해주세요.
        </Notice>
      )}
      <div className="report-columns">
      <section className="report-overview">
      <Metrics compact
        items={[
          { label: "등록", value: report.registered },
          { label: "입장", value: report.checked },
          { label: "미입장", value: report.noShow },
          {
            label: "입장률",
            value: `${report.registered ? Math.round((report.checked / report.registered) * 100) : 0}%`,
          },
        ]}
      />
      <h2 className="flow-subheading">{t("도어 변경")}</h2>
      <Metrics compact
        items={[
          { label: "명단 취소", value: report.removals },
          { label: "입장 취소", value: report.cancellations },
          { label: "재입장", value: report.reentries },
          {
            label: "현장 추가",
            value: data.guests.filter(
              (g) =>
                g.eventId === event.id &&
                g.createdAt >= (event.openedAt ?? "z"),
            ).length,
          },
        ]}
      />
      <details className="flow-details">
        <summary>{t("15분 피크")}</summary>
        <p className="flow-hint">
          {report.peak ? `${report.peak.at} · ${report.peak.count}` : "—"}
        </p>
        <p className="flow-hint">
          {t("행사 개시")} · {event.openedAt ?? "—"}
        </p>
        <p className="flow-hint">
          {t("행사 종료")} · {event.closedAt ?? "—"}
        </p>
        <p className="flow-hint">
          {t("확정")} · {snapshot?.confirmedAt ?? "—"}
        </p>
      </details>
      <Metrics compact
        items={[
          {
            label: "준비 시간",
            value:
              report.preparationSeconds === null
                ? "—"
                : `${Math.floor(report.preparationSeconds / 60)} min`,
          },
          {
            label: "확정 시간",
            value:
              snapshot && report.confirmationSeconds !== null
                ? `${Math.floor(report.confirmationSeconds / 60)} min`
                : "—",
          },
        ]}
      />
      </section>
      <section className="report-contributors">
      <h2 className="flow-subheading">{t("기여자 성과")}</h2>
      <div className="flow-table-wrap">
        <table className="flow-table">
          <thead>
            <tr>
              {["이름", "등록", "입장", "미입장", "입장률"].map((l) => (
                <th key={l}>{t(l)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.contributors.map((c, i) => (
              <tr key={i}>
                <td>{c.name}</td>
                <td>{c.registered}</td>
                <td>{c.checked}</td>
                <td>{c.registered - c.checked}</td>
                <td>
                  {Math.round((c.checked / Math.max(1, c.registered)) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Action secondary onClick={csv}>
        CSV 다운로드
      </Action>
      </section>
      </div>
      {confirm ? (
        <>
          <Confirm
            title="이 마감 리포트를 확정할까요?"
            description="확정한 리포트는 변경할 수 없습니다."
            disabled={!canConfirm}
            onCancel={() => setConfirm(false)}
            onConfirm={() =>
              void mutate((d) => {
                assertCapability(d, user.id, "admin", event.venueId);
                const latest = d.events.find((e) => e.id === event.id && e.venueId === event.venueId);
                if (!latest || !["closed", "archived"].includes(latest.state) || inconsistent ||
                  d.queue.some((q) => q.eventId === event.id && q.state === "queued"))
                  throw Error("이 작업을 수행할 권한이 없습니다.");
                if (d.reports[event.id])
                  throw Error("확정한 리포트는 변경할 수 없습니다.");
                d.reports[event.id] = buildReport(d, event.id);
              }, "마감 리포트를 확정했습니다.").then((ok) => {
                if (ok) setConfirm(false);
              })
            }
          />
          {notice && <Notice>{notice}</Notice>}
        </>
      ) : (
        <Action disabled={!canConfirm} onClick={() => setConfirm(true)}>
          {snapshot ? "확정됨" : "리포트 확정"}
        </Action>
      )}
    </div>
  );
}
