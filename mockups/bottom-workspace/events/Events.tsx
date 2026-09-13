import { useEffect, useState } from "react";
import {
  canTransitionEventState,
  prepareEventDraft,
} from "../../../lib/events/domain";
import { useMock, id, useIntent } from "../data/MockData";
import { MOCK_NOW, type MockEvent } from "../data/types";
import { Sheet } from "../shared/Sheet";
import {
  Action,
  Confirm,
  Empty,
  Field,
  Form,
  Metrics,
  Notice,
  Row,
  optionalNumber,
  string,
} from "../shared/ui";
const states = {
  draft: "초안",
  open: "운영 중",
  closed: "종료",
  archived: "보관",
};
export function Events() {
  const { data, event, venue, mutate, chooseEvent, navigate, t, notice } =
    useMock();
  const [date, setDate] = useState(event.date),
    [panel, setPanel] = useState<string | null>(null),
    [template, setTemplate] = useState<MockEvent | null>(null),
    [transition, setTransition] = useState<MockEvent["state"] | null>(null);
  useEffect(() => setDate(event.date), [event.date]);
  useIntent("event-create", () => {
    setTemplate(null);
    setPanel("create");
  });
  const selected = data.events.find((e) => e.id === panel);
  const list = data.events.filter(
    (e) => e.venueId === venue.id && e.date === date && !e.general,
  );
  const close = () => {
    setPanel(null);
    setTemplate(null);
    setTransition(null);
  };
  const change = async (next: MockEvent["state"]) => {
    if (!selected || !canTransitionEventState(selected.state, next)) return;
    if (
      await mutate((d) => {
        const e = d.events.find((e) => e.id === selected.id)!;
        if (!canTransitionEventState(e.state, next))
          throw Error("행사 상태를 변경하지 못했습니다.");
        e.state = next;
        if (next === "open") e.openedAt = MOCK_NOW;
        if (next === "closed") e.closedAt = MOCK_NOW;
      }, "행사 상태를 변경했습니다.")
    )
      setTransition(null);
  };
  return (
    <div className="flow-section">
      <div className="flow-filter-stack">
      <Field
        label="운영일"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      </div>
      {list.map((e) => (
        <Row
          key={e.id}
          title={e.name}
          meta={`${e.date} · ${t("수용 인원")} ${e.capacity ?? "—"}`}
          badge={states[e.state]}
          onClick={() => setPanel(e.id)}
        />
      ))}
      {!list.length && <Empty text="이 날짜에 별도 행사가 없습니다" />}
      <details className="flow-details">
        <summary>{t("이전 행사 보기")}</summary>
        {data.events
          .filter(
            (e) => e.venueId === venue.id && !e.general && e.date !== date,
          )
          .map((e) => (
            <Row
              key={e.id}
              title={e.name}
              meta={e.date}
              badge={states[e.state]}
              onClick={() => {
                setDate(e.date);
                setPanel(e.id);
              }}
            />
          ))}
      </details>
      {panel === "create" && (
        <Sheet
          protectEdits
          title={t("행사 만들기")}
          subtitle={
            template ? `${t("템플릿으로 사용")} · ${template.name}` : venue.name
          }
          onClose={close}
        >
          <Form
            submit="초안 행사 만들기"
            onSubmit={async (form) => {
              const newId = id();
              const prepared = prepareEventDraft({
                businessDate: string(form, "date"),
                name: string(form, "name"),
                capacity: optionalNumber(form, "capacity"),
                targetGuests: optionalNumber(form, "target"),
                templateSourceEventId: template?.id,
              });
              if (prepared.error) {
                await mutate(() => {
                  throw Error(
                    "행사 이름, 날짜, 수용 인원과 목표를 확인해주세요.",
                  );
                });
                return;
              }
              const ok = await mutate(
                (d) => {
                  d.events.push({
                    id: newId,
                    venueId: venue.id,
                    date: prepared.draft!.businessDate,
                    name: prepared.draft!.name,
                    capacity: prepared.draft!.capacity,
                    target: prepared.draft!.targetGuests,
                    state: "draft",
                    createdAt: MOCK_NOW,
                    openedAt: null,
                    closedAt: null,
                    templateId: template?.id ?? null,
                  });
                  if (template)
                    for (const l of d.links.filter(
                      (l) => l.eventId === template.id && !l.deleted,
                    )) {
                      d.links.push({
                        ...l,
                        id: id(),
                        eventId: newId,
                        createdAt: MOCK_NOW,
                        expiresAt: null,
                        active: true,
                      });
                    }
                },
                template
                  ? "템플릿으로 행사 초안을 만들었습니다."
                  : "행사 초안을 만들었습니다.",
              );
              if (ok) {
                chooseEvent(newId);
                close();
              }
            }}
          >
            <Field
              label="행사 이름"
              name="name"
              defaultValue={template ? `${template.name} 복사본` : ""}
              maxLength={120}
              required
            />
            <Field
              label="운영일"
              name="date"
              type="date"
              defaultValue={date}
              required
            />
            <div className="flow-inline-fields">
              <Field
                label="수용 인원"
                name="capacity"
                type="number"
                min="1"
                max="100000"
                defaultValue={template?.capacity ?? ""}
              />
              <Field
                label="게스트 목표"
                name="target"
                type="number"
                min="0"
                max="100000"
                defaultValue={template?.target ?? ""}
              />
            </div>
            {template && (
              <Notice>
                선택한 행사의 설정을 복사합니다. 새 행사 날짜를 확인해주세요.
              </Notice>
            )}
          </Form>
        </Sheet>
      )}
      {selected && (
        <Sheet
          title={selected.name}
          subtitle={`${selected.date} · ${t(states[selected.state])}`}
          onClose={close}
        >
          <Metrics
            items={[
              { label: "수용 인원", value: selected.capacity ?? "—" },
              { label: "게스트 목표", value: selected.target ?? "—" },
            ]}
          />
          <div className="flow-stack">
            <Action
              secondary
              onClick={() => {
                chooseEvent(selected.id);
                navigate("preparation");
                close();
              }}
            >
              출연표·준비 업무
            </Action>
            <Action
              onClick={() => {
                chooseEvent(selected.id);
                navigate("roster");
                close();
              }}
            >
              운영 행사로 선택
            </Action>
            <Action
              secondary
              onClick={() => {
                setTemplate(selected);
                setPanel("create");
              }}
            >
              템플릿으로 사용
            </Action>
            <Action
              secondary
              onClick={() => {
                chooseEvent(selected.id);
                navigate("report");
                close();
              }}
            >
              나이트 마감 리포트
            </Action>
          </div>
          {transition ? (
            <>
              <Confirm
                title={t(transition === "closed" ? "행사 종료" : "행사 보관")}
                description={
                  transition === "closed"
                    ? "행사를 종료하면 게스트 등록과 입장을 더 이상 처리할 수 없습니다."
                    : "행사를 보관하면 다시 운영할 수 없습니다."
                }
                onCancel={() => setTransition(null)}
                onConfirm={() => void change(transition)}
              />
              {notice && <Notice>{notice}</Notice>}
            </>
          ) : (
            <div className="flow-stack">
              {selected.state === "draft" && (
                <Action onClick={() => void change("open")}>행사 열기</Action>
              )}
              {selected.state === "open" && (
                <Action secondary onClick={() => setTransition("closed")}>
                  행사 종료
                </Action>
              )}
              {(selected.state === "closed" || selected.state === "draft") && (
                <Action secondary onClick={() => setTransition("archived")}>
                  행사 보관
                </Action>
              )}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
