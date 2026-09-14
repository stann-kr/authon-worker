import { useState } from "react";
import { useMock, id, quotaFor, useIntent } from "../data/MockData";
import { assertCapability, permissionsFor } from "../data/access";
import { Sheet } from "../shared/Sheet";
import {
  Action,
  Area,
  Confirm,
  Empty,
  Field,
  Form,
  Metrics,
  Notice,
  Row,
  Tabs,
  string,
} from "../shared/ui";
export function QuotaRequests() {
  const { data, user, event, isAdmin, canRequestQuota, mutate, t, notice } = useMock();
  const [panel, setPanel] = useState<string | null>(null),
    [tab, setTab] = useState("pending"),
    [reject, setReject] = useState(false);
  useIntent("quota-request", () => setPanel("create"));
  const quota = quotaFor(data, user.id, event.id);
  const canRequest =
    canRequestQuota &&
    quota.limit !== null;
  const ownPending = data.requests.find(
    (r) =>
      r.eventId === event.id && r.userId === user.id && r.state === "pending",
  );
  const list = data.requests.filter(
    (r) =>
      r.eventId === event.id &&
      (isAdmin || r.userId === user.id) &&
      (tab === "pending" ? r.state === "pending" : r.state !== "pending"),
  );
  const selected = data.requests.find((r) => r.id === panel);
  return (
    <div className="flow-section management-section">
      {!isAdmin && (
        <div className="quota-summary">
          <Metrics
            items={[
              { label: "게스트 한도", value: quota.limit ?? "무제한" },
              { label: "남은 인원", value: quota.remaining ?? "무제한" },
            ]}
          />
          {ownPending && <span className="status-badge">{t("승인 대기")} +{ownPending.count}</span>}
          {!canRequest && <span className="quiet">{t("추가 요청 불필요")}</span>}
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "pending", label: "승인 대기" },
          { id: "history", label: "최근 처리 내역" },
        ]}
      />
      {list.map((r) => (
        <Row
          key={r.id}
          selected={panel === r.id}
          title={data.users.find((u) => u.id === r.userId)?.name ?? t("사용자")}
          meta={`${r.reason || t("입력된 사유 없음")} · +${r.state === "approved" ? r.approved : r.count}`}
          badge={
            r.state === "pending"
              ? "승인 대기"
              : r.state === "approved"
                ? "승인 완료"
                : "거절됨"
          }
          onClick={() => {
            setPanel(r.id);
            setReject(false);
          }}
        />
      ))}
      {!list.length && (
        <Empty text="승인 대기 중인 추가 게스트 요청이 없습니다." />
      )}
      {panel === "create" && canRequest && (
        <Sheet
          protectEdits
          title={t("추가 인원 요청")}
          onClose={() => setPanel(null)}
        >
          <Form
            submit="요청 보내기"
            disabled={!!ownPending}
            onSubmit={async (form) => {
              const count = Number(string(form, "count"));
              if (
                await mutate((d) => {
                  const actor = assertCapability(d, user.id, "guest", event.venueId);
                  if (!permissionsFor(actor).canRequestQuota || actor.limit === null)
                    throw Error("이 작업을 수행할 권한이 없습니다.");
                  if (!Number.isInteger(count) || count < 1)
                    throw Error("입력값을 확인해주세요.");
                  if (
                    d.requests.some(
                      (r) =>
                        r.eventId === event.id &&
                        r.userId === user.id &&
                        r.state === "pending",
                    )
                  )
                    throw Error(
                      "이 운영일에는 이미 승인 대기 중인 요청이 있습니다.",
                    );
                  d.requests.push({
                    id: id(),
                    venueId: event.venueId,
                    eventId: event.id,
                    userId: user.id,
                    count,
                    approved: 0,
                    reason: string(form, "reason"),
                    note: "",
                    state: "pending",
                  });
                }, "요청을 보냈습니다.")
              )
                setPanel(null);
            }}
          >
            <Field
              label="추가 요청 인원"
              name="count"
              type="number"
              min="1"
              max="999"
              defaultValue="3"
              required
            />
            <Area label="사유 (선택)" name="reason" maxLength={300} />
          </Form>
        </Sheet>
      )}
      {selected && (
        <Sheet
          key={selected.id}
          presentation={reject ? "modal" : "detail"}
          protectEdits
          title={t("추가 인원 요청")}
          subtitle={`${data.users.find((u) => u.id === selected.userId)?.name} · ${event.name}`}
          onClose={() => setPanel(null)}
        >
          <Notice>{selected.reason || t("입력된 사유 없음")}</Notice>
          {!isAdmin || selected.state !== "pending" ? (
            <Notice>
              {selected.state === "pending"
                ? "관리자 승인을 기다리고 있습니다."
                : selected.state === "approved"
                  ? t("{count}명 승인", { count: selected.approved })
                  : "요청이 거절되었습니다."}
            </Notice>
          ) : reject ? (
            <>
              <Confirm
                title="요청을 거절할까요?"
                description="요청을 거절 처리합니다. 등록 한도는 변경되지 않습니다."
                onCancel={() => setReject(false)}
                onConfirm={() =>
                  void mutate((d) => {
                    assertCapability(d, user.id, "admin", event.venueId);
                    const request = d.requests.find((r) => r.id === selected.id && r.venueId === event.venueId && r.eventId === event.id);
                    if (!request || request.state !== "pending") throw Error("요청이 이미 처리되었습니다.");
                    request.state = "rejected";
                  }, "추가 게스트 요청을 거절했습니다.").then((ok) => {
                    if (ok) setPanel(null);
                  })
                }
              />
              {notice && <Notice>{notice}</Notice>}
            </>
          ) : (
            <>
              <Form
                submit="승인"
                onSubmit={async (form) => {
                  const count = Number(string(form, "count"));
                  if (
                    await mutate((d) => {
                      assertCapability(d, user.id, "admin", event.venueId);
                      const r = d.requests.find((r) => r.id === selected.id && r.venueId === event.venueId && r.eventId === event.id);
                      if (!r || r.state !== "pending")
                        throw Error("요청이 이미 처리되었습니다.");
                      if (
                        count < 1 ||
                        count > r.count ||
                        !Number.isInteger(count)
                      )
                        throw Error("승인할 추가 인원을 확인해주세요.");
                      r.approved = count;
                      r.state = "approved";
                    }, "추가 게스트 요청을 승인했습니다.")
                  )
                    setPanel(null);
                }}
              >
                <Field
                  label="승인할 추가 인원"
                  name="count"
                  type="number"
                  min="1"
                  max={selected.count}
                  defaultValue={selected.count}
                  required
                />
              </Form>
              <Action secondary onClick={() => setReject(true)}>
                거절
              </Action>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
