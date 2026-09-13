import { useEffect, useState } from "react";
import {
  prepareGuestName,
  toStoredGuestName,
} from "../../../lib/guests/bulk-entry";
import { useMock, id, attendanceFor } from "../data/MockData";
import { MOCK_NOW } from "../data/types";
import { linkState } from "../links/Links";
import { Sheet } from "../shared/Sheet";
import {
  Action,
  Confirm,
  Empty,
  Field,
  Form,
  Metrics,
  Notice,
  Qr,
  Row,
  Tabs,
  string,
} from "../shared/ui";
import { GuestEntry } from "../guests/GuestEntry";
import "./registration.css";
export function ExternalView() {
  const {
    data,
    externalLinkId,
    setExternalLinkId,
    scenario,
    setScenario,
    mutate,
    locale,
    setLocale,
    t,
    notice,
  } = useMock();
  const link = data.links.find((l) => l.id === externalLinkId);
  const event = data.events.find((e) => e.id === link?.eventId),
    venue = data.venues.find((v) => v.id === link?.venueId);
  const [panel, setPanel] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (link?.locale && link.locale !== "auto") setLocale(link.locale);
    setPanel(null);
    setQuery("");
  }, [link?.id, link?.locale, setLocale]);
  const guests = data.guests.filter(
    (g) => g.externalLinkId === link?.id && g.status !== "deleted",
  );
  const own = guests.find((g) => g.id === data.ownRsvps[link?.id ?? ""]);
  const selected = guests.find((g) => g.id === panel);
  const state = link ? linkState(link, guests.length, scenario) : "비활성";
  const invalid =
    !link ||
    link.deleted ||
    !venue?.active ||
    !event ||
    ["closed", "archived"].includes(event.state) ||
    ["비활성", "만료"].includes(state);
  const self = link?.kind === "self_rsvp";
  const writable =
    !invalid &&
    !attendanceFor(data, event?.id ?? "").finalized &&
    scenario !== "storage-denied" &&
    scenario !== "unknown-result";
  const close = () => {
    setPanel(null);
    setError("");
  };
  return (
    <div className="flow-auth registration-page">
      <div className="flow-toolbar">
        <span className="flow-auth-brand">{venue?.brandName ?? "Authon"}</span>
        <select
          className="registration-language"
          aria-label={t("언어")}
          value={locale}
          onChange={(e) => setLocale(e.target.value as "ko" | "en")}
        >
          <option value="ko">한국어</option>
          <option value="en">English</option>
        </select>
      </div>
      <h1>
        {invalid ? t("유효하지 않은 링크") : link?.eventName || event.name}
      </h1>
      {invalid ? (
        <>
          <Notice error>
            이 게스트 링크를 사용할 수 없거나, 만료 또는 비활성화되었습니다.
          </Notice>
          <Action secondary onClick={() => setScenario("normal")}>
            다시 시도
          </Action>
        </>
      ) : (
        <>
          <p className="flow-hint">
            {event.date} · {link.ownerName}
          </p>
          <Metrics
            items={
              self
                ? [
                    {
                      label: "남은 인원",
                      value: Math.max(0, link.limit - guests.length),
                    },
                    { label: "최대", value: link.limit },
                  ]
                : [
                    { label: "등록", value: guests.length },
                    {
                      label: "남은 인원",
                      value: Math.max(0, link.limit - guests.length),
                    },
                  ]
            }
          />
          {scenario === "storage-denied" && (
            <Notice error>
              RSVP를 등록하고 수정하려면 브라우저 저장소를 허용해주세요.
            </Notice>
          )}
          {scenario === "unknown-result" && (
            <>
              <Notice error>
                최신 명단을 확인할 수 없어 변경을 잠시 멈췄습니다.
                새로고침해주세요.
              </Notice>
              <Action secondary onClick={() => setScenario("normal")}>
                최신 명단 확인
              </Action>
            </>
          )}
          {self ? (
            <>
              {(!own || own.status === "checked") && (
                <Notice>
                  {own
                    ? "입장 완료 후에는 RSVP를 수정하거나 취소할 수 없습니다."
                    : "본인 1명 · 수정 시 같은 브라우저 사용"}
                </Notice>
              )}
              {own ? (
                <>
                  <Row
                    title={own.name}
                    badge={own.status === "checked" ? "입장 완료" : "미입장"}
                    onClick={() => setPanel(own.id)}
                  />
                  <Qr code={own.code} />
                  <Action
                    disabled={!writable || own.status === "checked"}
                    onClick={() => setPanel("self")}
                  >
                    RSVP 수정
                  </Action>
                  <Action
                    secondary
                    disabled={!writable || own.status === "checked"}
                    onClick={() => setPanel("cancel-self")}
                  >
                    RSVP 취소
                  </Action>
                </>
              ) : (
                <>
                  <Empty text="이 기기에서 등록한 RSVP가 없습니다" />
                  <Action
                    disabled={!writable || guests.length >= link.limit}
                    onClick={() => setPanel("self")}
                  >
                    RSVP 등록
                  </Action>
                </>
              )}
            </>
          ) : (
            <>
              <Field
                label="게스트 이름 검색..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {guests
                .filter((g) =>
                  g.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((g) => (
                  <Row
                    key={g.id}
                    title={g.name}
                    badge={g.status === "checked" ? "입장 완료" : "미입장"}
                    onClick={() => setPanel(g.id)}
                  />
                ))}
              {!guests.length && <Empty text="등록된 게스트가 없습니다" />}
              <Action
                disabled={!writable || guests.length >= link.limit}
                onClick={() => setPanel("add")}
              >
                게스트 추가
              </Action>
            </>
          )}
          {state === "정원 마감" && !own && (
            <Notice error>이 이벤트의 RSVP 정원에 도달했습니다.</Notice>
          )}
        </>
      )}
      <details className="flow-details">
        <summary>{t("링크 종류 미리보기")}</summary>
        <Tabs
          value={externalLinkId}
          onChange={setExternalLinkId}
          items={data.links
            .filter((l) => !l.deleted)
            .map((l) => ({
              id: l.id,
              label:
                l.kind === "self_rsvp"
                  ? "방문자가 직접 RSVP"
                  : "DJ가 게스트 명단 관리",
            }))}
        />
      </details>
      {panel === "add" && link && (
        <Sheet protectEdits title={t("게스트 추가")} onClose={close}>
          <GuestEntry externalLinkId={link.id} onDone={close} />
        </Sheet>
      )}
      {panel === "self" && link && event && (
        <Sheet
          protectEdits
          title={t(own ? "RSVP 수정" : "RSVP 등록")}
          onClose={close}
        >
          {error && <Notice error>{error}</Notice>}
          <Form
            submit={own ? "RSVP 수정" : "RSVP 등록"}
            disabled={!writable || own?.status === "checked"}
            onSubmit={async (form) => {
              const name = prepareGuestName(string(form, "name"));
              if (name.error) {
                setError("100자 이하로 입력해주세요.");
                return;
              }
              if (
                await mutate(
                  (d) => {
                    const current = d.guests.find(
                      (g) =>
                        g.id === d.ownRsvps[link.id] && g.status !== "deleted",
                    );
                    if (current) {
                      if (current.status === "checked")
                        throw Error(
                          "입장 완료 후에는 RSVP를 수정하거나 취소할 수 없습니다.",
                        );
                      current.name = toStoredGuestName(name.name);
                    } else {
                      if (
                        d.guests.filter(
                          (g) =>
                            g.externalLinkId === link.id &&
                            g.status !== "deleted",
                        ).length >= link.limit
                      )
                        throw Error("이 이벤트의 RSVP 정원에 도달했습니다.");
                      const gid = id();
                      d.guests.push({
                        id: gid,
                        venueId: link.venueId,
                        eventId: link.eventId,
                        name: toStoredGuestName(name.name),
                        ownerId: "",
                        externalLinkId: link.id,
                        operator: "",
                        status: "pending",
                        code: `AUTHON:MOCKUP:${gid}`,
                        createdAt: MOCK_NOW,
                        checkedAt: null,
                        checkIns: 0,
                        cancellations: 0,
                      });
                      d.ownRsvps[link.id] = gid;
                    }
                  },
                  own ? "RSVP를 수정했습니다." : "RSVP를 등록했습니다.",
                )
              )
                close();
            }}
          >
            <Field
              label="내 이름"
              name="name"
              required
              maxLength={100}
              defaultValue={own?.name ?? ""}
              autoFocus
            />
          </Form>
        </Sheet>
      )}
      {panel === "cancel-self" && own && (
        <Sheet title={`${own.name} · ${t("RSVP 취소")}`} onClose={close}>
          <Confirm
            title="RSVP를 취소할까요?"
            description="등록을 취소합니다. 다시 등록하려면 남은 정원이 있어야 합니다."
            disabled={!writable || own.status === "checked"}
            onCancel={close}
            onConfirm={() =>
              void mutate((d) => {
                const g = d.guests.find((g) => g.id === own.id)!;
                if (g.status === "checked")
                  throw Error(
                    "입장 완료 후에는 RSVP를 수정하거나 취소할 수 없습니다.",
                  );
                g.status = "deleted";
                delete d.ownRsvps[link!.id];
              }, "RSVP를 취소했습니다.").then((ok) => {
                if (ok) close();
              })
            }
          />
          {notice && <Notice>{notice}</Notice>}
        </Sheet>
      )}
      {selected && (
        <Sheet title={selected.name} onClose={close}>
          <Notice>
            {selected.status === "checked" ? "입장 완료" : "미입장"}
          </Notice>
          {self ? (
            <Qr code={selected.code} />
          ) : (
            <>
              <Action
                secondary
                disabled={selected.status === "checked" || !writable}
                onClick={() => setPanel(`delete:${selected.id}`)}
              >
                삭제
              </Action>
              {selected.status === "checked" && (
                <Notice>
                  입장 완료 후에는 RSVP를 수정하거나 취소할 수 없습니다.
                </Notice>
              )}
            </>
          )}
        </Sheet>
      )}
      {panel?.startsWith("delete:") && (
        <Sheet title={t("게스트 삭제")} onClose={close}>
          <Confirm
            title={guests.find((g) => g.id === panel.slice(7))?.name ?? ""}
            description="명단에서 삭제합니다."
            onCancel={close}
            onConfirm={() =>
              void mutate((d) => {
                const g = d.guests.find(
                  (g) =>
                    g.id === panel.slice(7) && g.externalLinkId === link?.id,
                )!;
                if (!g || g.status === "checked")
                  throw Error(
                    "입장 완료 후에는 수정하거나 삭제할 수 없습니다.",
                  );
                g.status = "deleted";
              }, "삭제했습니다.").then((ok) => {
                if (ok) close();
              })
            }
          />
          {notice && <Notice>{notice}</Notice>}
        </Sheet>
      )}
    </div>
  );
}
