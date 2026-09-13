import { useEffect, useState } from "react";
import { useMock, id, useIntent } from "../data/MockData";
import { MOCK_NOW, type MockLink, type Locale } from "../data/types";
import { Sheet } from "../shared/Sheet";
import {
  Action,
  Confirm,
  CopyBox,
  Empty,
  Field,
  Form,
  Notice,
  Row,
  Select,
  Tabs,
  string,
} from "../shared/ui";
export function linkState(link: MockLink, used: number, scenario: string) {
  if (link.deleted || !link.active || scenario === "link-inactive")
    return "비활성";
  if (
    scenario === "link-expired" ||
    (link.expiresAt &&
      new Date(link.expiresAt).getTime() < new Date(MOCK_NOW).getTime())
  )
    return "만료";
  if (used >= link.limit) return "정원 마감";
  if (
    link.expiresAt &&
    new Date(link.expiresAt).getTime() - new Date(MOCK_NOW).getTime() <=
      86400000
  )
    return "만료 임박";
  return "활성";
}
export function Links() {
  const {
    data,
    event,
    venue,
    mutate,
    navigate,
    setExternalLinkId,
    scenario,
    t,
    notice,
    intent,
    setIntent,
  } = useMock();
  const [panel, setPanel] = useState<string | null>(null),
    [template, setTemplate] = useState<MockLink | null>(null),
    [filter, setFilter] = useState("all"),
    [range, setRange] = useState("date"),
    [recentLimit, setRecentLimit] = useState(50),
    [sort, setSort] = useState("newest"),
    [date, setDate] = useState(event.date),
    [deleteOpen, setDeleteOpen] = useState(false);
  useIntent("link-create", () => {
    setTemplate(null);
    setPanel("create");
  });
  useEffect(() => {
    if (!intent.startsWith("link-open:")) return;
    const link = data.links.find((l) => l.id === intent.slice(10) && l.venueId === venue.id && !l.deleted);
    if (link) {
      setDate(data.events.find((e) => e.id === link.eventId)?.date ?? event.date);
      setFilter("all");
      setPanel(link.id);
    }
    setIntent("");
  }, [intent, data.links, data.events, venue.id, event.date, setIntent]);
  const selected = data.links.find((l) => l.id === panel && !l.deleted);
  const used = (id: string) =>
    data.guests.filter((g) => g.externalLinkId === id && g.status !== "deleted")
      .length;
  const items = data.links
    .filter(
      (l) =>
        l.venueId === venue.id &&
        !l.deleted &&
        (range === "recent" ||
          data.events.find((e) => e.id === l.eventId)?.date === date) &&
        (filter === "all" ||
          (filter === "attention"
            ? linkState(l, used(l.id), scenario) !== "활성"
            : filter === "활성"
              ? ["활성", "만료 임박"].includes(
                  linkState(l, used(l.id), scenario),
                )
              : linkState(l, used(l.id), scenario) === filter)),
    )
    .sort((a, b) =>
      sort === "expiry"
        ? (a.expiresAt ?? "z").localeCompare(b.expiresAt ?? "z")
        : b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, range === "recent" ? recentLimit : 999);
  const close = () => {
    setPanel(null);
    setTemplate(null);
    setDeleteOpen(false);
  };
  return (
    <div className="flow-section">
      <div className="flow-toolbar">
        <strong>{t("등록 링크")}</strong>
        <Action
          onClick={() => {
            setTemplate(null);
            setPanel("create");
          }}
        >
          링크 생성
        </Action>
      </div>
      <Tabs
        value={range}
        onChange={setRange}
        items={[
          { id: "date", label: "날짜별" },
          { id: "recent", label: "최근" },
        ]}
      />
      {range === "date" && (
        <Field
          label="운영일"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      )}
      {range === "recent" && (
        <Select
          label="개수"
          value={recentLimit}
          onChange={(e) => setRecentLimit(Number(e.target.value))}
        >
          {[10, 20, 50, 100].map((n) => (
            <option value={n} key={n}>
              {n}
            </option>
          ))}
        </Select>
      )}
      <div className="flow-inline-fields">
        <Select
          label="상태"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {[
            "all",
            "활성",
            "비활성",
            "만료",
            "정원 마감",
            "만료 임박",
            "attention",
          ].map((v) => (
            <option key={v} value={v}>
              {t(v === "all" ? "전체" : v === "attention" ? "확인 필요" : v)}
            </option>
          ))}
        </Select>
        <Select
          label="정렬"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">{t("최근 생성순")}</option>
          <option value="expiry">{t("만료 임박순")}</option>
          <option value="name">{t("DJ 이름")}</option>
        </Select>
      </div>
      {items.map((l) => (
        <Row
          key={l.id}
          title={l.ownerName}
          meta={`${t(l.kind === "self_rsvp" ? "방문자가 직접 RSVP" : "DJ가 게스트 명단 관리")} · ${used(l.id)}/${l.limit}`}
          badge={linkState(l, used(l.id), scenario)}
          onClick={() => setPanel(l.id)}
        />
      ))}
      {!items.length && <Empty text="이 필터에 해당하는 링크가 없습니다" />}
      {panel === "create" && (
        <Sheet
          protectEdits
          title={t("링크 생성")}
          subtitle={
            template
              ? `${t("템플릿으로 사용")} · ${template.ownerName}`
              : event.name
          }
          onClose={close}
        >
          <LinkForm
            template={template}
            onSubmit={async (form) => {
              const lid = id();
              const ok = await mutate((d) => {
                const ownerName = string(form, "owner"),
                  limit = Number(string(form, "limit")),
                  eventId = string(form, "eventId");
                if (
                  !ownerName ||
                  ownerName.length > 100 ||
                  !Number.isInteger(limit) ||
                  limit < 1 ||
                  limit > 999
                )
                  throw Error(
                    "날짜, DJ, 이벤트, 언어와 게스트 정원을 확인해주세요.",
                  );
                const e = d.events.find(
                  (e) => e.id === eventId && e.venueId === venue.id,
                );
                if (!e || !["draft", "open"].includes(e.state))
                  throw Error("이 행사에는 링크를 생성할 수 없습니다.");
                d.links.push({
                  id: lid,
                  venueId: venue.id,
                  eventId,
                  ownerName,
                  eventName: string(form, "eventName"),
                  contributorKey:
                    d.links.find(
                      (l) =>
                        l.venueId === venue.id &&
                        l.ownerName.toUpperCase() === ownerName.toUpperCase(),
                    )?.contributorKey ??
                    d.links.find(
                      (l) =>
                        l.venueId === venue.id &&
                        l.ownerName.toUpperCase() === ownerName.toUpperCase(),
                    )?.id ??
                    lid,
                  contributorUserId: string(form, "contributor") || null,
                  kind: string(form, "kind") as MockLink["kind"],
                  limit,
                  active: true,
                  deleted: false,
                  locale: string(form, "locale") as "auto" | Locale,
                  createdAt: MOCK_NOW,
                  expiresAt:
                    e.date === "2026-09-12"
                      ? "2026-09-13T07:00:00+09:00"
                      : null,
                });
              }, "링크를 생성했습니다.");
              if (ok) {
                setTemplate(null);
                setPanel(lid);
              }
            }}
          />
        </Sheet>
      )}
      {selected && (
        <Sheet
          title={selected.ownerName}
          subtitle={`${t(linkState(selected, used(selected.id), scenario))} · ${data.events.find((e) => e.id === selected.eventId)?.name}`}
          onClose={close}
        >
          <div className="flow-pair">
            <span>{t("사용량")}</span>
            <strong>
              {used(selected.id)} / {selected.limit}
            </strong>
          </div>
          <div className="flow-pair">
            <span>{t("언어")}</span>
            <strong>{selected.locale}</strong>
          </div>
          <div className="flow-pair">
            <span>{t("만료")}</span>
            <strong>
              {selected.expiresAt?.slice(0, 16) ?? t("만료 없음")}
            </strong>
          </div>
          <CopyBox
            value={`http://127.0.0.1:4176/#external/${selected.id}`}
            onOpen={() => {
              setExternalLinkId(selected.id);
              navigate("external");
              close();
            }}
          />
          <div className="flow-stack">
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
              onClick={() =>
                void mutate((d) => {
                  const l = d.links.find((l) => l.id === selected.id)!;
                  l.active = !l.active;
                }, "변경했습니다.")
              }
            >
              {selected.active ? "비활성화" : "활성화"}
            </Action>
          </div>
          {deleteOpen ? (
            <>
              <Confirm
                title="게스트 링크를 삭제할까요?"
                description="이 작업은 되돌릴 수 없으며 활성 게스트 링크를 즉시 무효화합니다."
                onCancel={() => setDeleteOpen(false)}
                onConfirm={() =>
                  void mutate((d) => {
                    const l = d.links.find((l) => l.id === selected.id)!;
                    l.deleted = true;
                    l.active = false;
                  }, "링크를 삭제했습니다.").then((ok) => {
                    if (ok) close();
                  })
                }
              />
              {notice && <Notice>{notice}</Notice>}
            </>
          ) : (
            <Action secondary onClick={() => setDeleteOpen(true)}>
              링크 삭제
            </Action>
          )}
        </Sheet>
      )}
    </div>
  );
}
function LinkForm({
  template,
  onSubmit,
}: {
  template: MockLink | null;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const { data, event, venue, t, scenario } = useMock();
  const [contributor, setContributor] = useState(
      template?.contributorUserId ?? "",
    ),
    [owner, setOwner] = useState(template?.ownerName ?? ""),
    [selectedEvent, setSelectedEvent] = useState(event.id);
  const choices = data.users.filter(
    (u) =>
      u.venueId === venue.id &&
      u.active &&
      !u.deleted &&
      ["dj", "staff"].includes(u.role),
  );
  return (
    <Form submit="링크 생성" onSubmit={onSubmit}>
      {scenario === "partial-error" && (
        <Notice>
          기존 DJ와 이벤트 목록을 불러오지 못했습니다. 이름을 직접 입력할 수
          있습니다.
        </Notice>
      )}
      <Select
        label="기존 DJ 이름"
        name="contributor"
        value={contributor}
        onChange={(e) => {
          setContributor(e.target.value);
          setOwner(choices.find((u) => u.id === e.target.value)?.name ?? "");
        }}
      >
        <option value="">{t("새 이름으로 입력")}</option>
        {choices.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
      <Field
        label="DJ 이름"
        name="owner"
        list="owner-suggestions"
        value={owner}
        onChange={(e) => {
          setOwner(e.target.value);
          setContributor("");
        }}
        required
        maxLength={100}
      />
      <datalist id="owner-suggestions">
        {[
          ...new Set([
            ...choices.map((u) => u.name),
            ...data.links
              .filter((l) => l.venueId === venue.id)
              .map((l) => l.ownerName),
          ]),
        ].map((name) => (
          <option value={name} key={name} />
        ))}
      </datalist>
      <Select
        label="운영 행사"
        name="eventId"
        value={selectedEvent}
        onChange={(e) => setSelectedEvent(e.target.value)}
      >
        {data.events
          .filter(
            (e) =>
              e.venueId === venue.id && ["draft", "open"].includes(e.state),
          )
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.date}
            </option>
          ))}
      </Select>
      <Field
        label="이벤트 이름"
        name="eventName"
        list="event-suggestions"
        maxLength={120}
        defaultValue={template?.eventName ?? event.name}
      />
      <datalist id="event-suggestions">
        {[
          ...new Set([
            ...data.events
              .filter((e) => e.venueId === venue.id)
              .map((e) => e.name),
            ...data.links
              .filter((l) => l.venueId === venue.id)
              .map((l) => l.eventName)
              .filter(Boolean),
          ]),
        ].map((name) => (
          <option value={name} key={name} />
        ))}
      </datalist>
      <Field
        label="날짜"
        type="date"
        value={data.events.find((e) => e.id === selectedEvent)?.date ?? ""}
        readOnly
      />
      <Select
        label="링크 사용 방식"
        name="kind"
        defaultValue={template?.kind ?? "contributor"}
      >
        <option value="contributor">{t("DJ가 게스트 명단 관리")}</option>
        <option value="self_rsvp">{t("방문자가 직접 RSVP")}</option>
      </Select>
      <Field
        label="최대 게스트"
        name="limit"
        type="number"
        min="1"
        max="999"
        defaultValue={template?.limit ?? 10}
        required
      />
      <Select
        label="게스트 페이지 언어"
        name="locale"
        defaultValue={template?.locale ?? "auto"}
      >
        <option value="auto">{t("자동")}</option>
        <option value="ko">한국어</option>
        <option value="en">English</option>
      </Select>
    </Form>
  );
}
