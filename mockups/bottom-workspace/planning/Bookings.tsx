import { useCallback, useEffect, useState } from "react";
import { useMock, useIntent } from "../data/MockData";
import { Action, Empty, Field, Select, Tabs } from "../shared/ui";
import { bookingStatuses, type Booking } from "./types";
import { activeBooking, conflictsFor, holdExpired } from "./domain";
import { newBooking } from "./fixtures";
import { PlanningTabs, Status, timeLabel } from "./ui";
import { BookingEditor } from "./BookingEditor";
import { BookingSheet } from "./BookingSheet";

export function Bookings() {
  const { data, venue, event, user, intent, setIntent, t } = useMock();
  const [query, setQuery] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [filter, setFilter] = useState("active");
  const [layout, setLayout] = useState("list");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Booking | null>(null);
  const create = useCallback(
    (artistId?: string) => {
      const artist = data.planning.artists.find(
        (a) => a.id === artistId && a.scopeId === venue.id,
      );
      const candidate = newBooking(
        venue.id,
        !event.general && ["draft", "open"].includes(event.state)
          ? event.id
          : (data.events.find(
              (e) =>
                e.venueId === venue.id && !e.general && e.state === "draft",
            )?.id ?? ""),
        artist,
      );
      candidate.owner = user.name;
      setDraft(candidate);
    },
    [data.planning.artists, data.events, event, venue.id, user.name],
  );
  useIntent("booking-create", create);
  useEffect(() => {
    if (intent.startsWith("booking-artist:")) {
      create(intent.slice(15));
      setIntent("");
    }
    if (intent.startsWith("booking-open:")) {
      setSelected(intent.slice(13));
      setIntent("");
    }
  }, [intent, create, setIntent]);
  const bookings = data.planning.bookings.filter((b) => b.scopeId === venue.id);
  const pending = bookings.filter(
    (b) => activeBooking(b) && b.status !== "confirmed",
  );
  const attention = bookings.filter(
    (b) =>
      activeBooking(b) &&
      (holdExpired(b) ||
        conflictsFor(b, bookings).length ||
        (b.status === "confirmed" && b.acknowledgedRevision !== b.revision)),
  );
  const list = bookings.filter(
    (b) =>
      (!eventFilter || b.eventId === eventFilter) &&
      (filter === "all" ||
        (filter === "negotiation" && pending.includes(b)) ||
        (filter === "attention" && attention.includes(b)) ||
        (filter === "active" && activeBooking(b)) ||
        b.status === filter) &&
      `${data.planning.artists.find((a) => a.id === b.artistId)?.name} ${data.events.find((e) => e.id === b.eventId)?.name} ${b.owner} ${b.nextAction}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const card = (b: Booking) => (
    <button
      className="planning-booking"
      key={b.id}
      onClick={() => setSelected(b.id)}
    >
      <div className="planning-card-top">
        <strong>
          {data.planning.artists.find((a) => a.id === b.artistId)?.name}
        </strong>
        <Status booking={b} />
      </div>
      <span>{data.events.find((e) => e.id === b.eventId)?.name}</span>
      <p className="planning-booking-time">
        {timeLabel(b.start)}
        {b.end && ` → ${timeLabel(b.end)}`}
      </p>
      <small>
        {b.stage || t("무대 미정")} · {b.owner || t("담당자 미정")}
      </small>
      {b.nextAction && (
        <div className="planning-card-next">
          <span>{b.nextAction}</span>
          <small>{b.due || t("기한 미정")}</small>
        </div>
      )}
      {conflictsFor(b, bookings).length > 0 && (
        <span className="planning-flag">{t("일정 겹침 확인")}</span>
      )}
      {b.status === "confirmed" && b.acknowledgedRevision !== b.revision && (
        <span className="planning-flag">{t("상대 확인 대기")}</span>
      )}
    </button>
  );
  return (
    <div className="flow-section planning-section">
      <PlanningTabs />
      <div className="planning-heading">
        <div>
          <h2>{t("문의부터 출연 확정까지")}</h2>
          <p>
            {t("누가 답변을 기다리고, 다음에 무엇을 해야 하는지 확인하세요.")}
          </p>
        </div>
        <Action onClick={() => create()}>새 부킹</Action>
      </div>
      <div className="planning-summary">
        <button onClick={() => setFilter("negotiation")}>
          <span>{t("조율 중인 부킹")}</span>
          <strong>{pending.length}</strong>
        </button>
        <button onClick={() => setFilter("attention")}>
          <span>{t("확인이 필요한 일정")}</span>
          <strong>{attention.length}</strong>
        </button>
      </div>
      <div className="planning-filters">
        <Field
          label="부킹 검색"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="아티스트·행사·담당자"
        />
        <Select
          label="행사 필터"
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
        >
          <option value="">{t("모든 행사")}</option>
          {data.events
            .filter((e) => e.venueId === venue.id && !e.general)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </Select>
      </div>
      <div className="planning-filters">
        <Select
          label="부킹 상태 필터"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="active">{t("진행 중")}</option>
          <option value="negotiation">{t("문의·조율·홀드")}</option>
          <option value="attention">{t("확인 필요")}</option>
          <option value="all">{t("전체 이력")}</option>
          {Object.entries(bookingStatuses).map(([key, label]) => (
            <option key={key} value={key}>
              {t(label)}
            </option>
          ))}
        </Select>
        <Tabs
          label="부킹 보기"
          value={layout}
          onChange={setLayout}
          items={[
            { id: "list", label: "목록" },
            { id: "board", label: "보드" },
          ]}
        />
      </div>
      <p role="status" className="planning-result">
        {t("부킹 {count}건", { count: list.length })}
      </p>
      {layout === "list" ? (
        <div className="planning-booking-list">{list.map(card)}</div>
      ) : (
        <div
          className="planning-board"
          tabIndex={0}
          aria-label={t("상태별 부킹 보드")}
        >
          {Object.entries(bookingStatuses)
            .filter(
              ([key]) =>
                !["cancelled", "completed"].includes(key) ||
                list.some((b) => b.status === key),
            )
            .map(([key, label]) => (
              <section key={key}>
                <h3>
                  {t(label)}{" "}
                  <span>{list.filter((b) => b.status === key).length}</span>
                </h3>
                {list.filter((b) => b.status === key).map(card)}
                {!list.some((b) => b.status === key) && (
                  <p className="planning-hint">{t("등록된 부킹 없음")}</p>
                )}
              </section>
            ))}
        </div>
      )}
      {!list.length && (
        <>
          <Empty text="조건에 맞는 부킹이 없습니다." />
          <Action
            secondary
            onClick={() => {
              setQuery("");
              setFilter("all");
              setEventFilter("");
            }}
          >
            검색·필터 초기화
          </Action>
        </>
      )}
      {draft && (
        <BookingEditor
          booking={draft}
          onClose={() => setDraft(null)}
          onSaved={(id) => {
            setDraft(null);
            setSelected(id);
          }}
        />
      )}
      {selected && !draft && (
        <BookingSheet
          key={selected}
          bookingId={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
