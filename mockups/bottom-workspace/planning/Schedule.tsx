import { useId, useState } from "react";
import { useMock } from "../data/MockData";
import { MOCK_NOW } from "../data/types";
import { Action, Empty, Field, Select, Tabs, Toggle } from "../shared/ui";
import { activeBooking, conflictsFor } from "./domain";
import { Status } from "./ui";
import { BookingSheet } from "./BookingSheet";
import { Icon } from "../shared/Icon";

export function shiftDate(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function weekDates(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = shiftDate(day, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}
export function Schedule() {
  const { data, venue, event, locale, t } = useMock();
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const [anchor, setAnchor] = useState(event.date);
  const [dayFilter, setDayFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [artistFilter, setArtistFilter] = useState("");
  const [tentative, setTentative] = useState(true);
  const [layout, setLayout] = useState("week");
  const [selected, setSelected] = useState<string | null>(null);
  const dates = weekDates(anchor);
  const scoped = data.planning.bookings.filter(
    (b) =>
      b.scopeId === venue.id &&
      activeBooking(b) &&
      (!eventFilter || b.eventId === eventFilter) &&
      (!artistFilter || b.artistId === artistFilter) &&
      (tentative || b.status === "confirmed"),
  );
  const onDay = (day: string) =>
    scoped
      .filter(
        (b) =>
          b.start &&
          b.end &&
          b.start < `${shiftDate(day, 1)}T00:00` &&
          b.end > `${day}T00:00`,
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  const unscheduled = scoped.filter((b) => !b.start);
  const visibleDates = dayFilter ? [dayFilter] : dates;
  const move = (amount: number) => {
    setAnchor(shiftDate(anchor, amount));
    setDayFilter("");
  };
  return (
    <div className="flow-section planning-section planning-schedule">
      <div className="planning-calendar-controls flow-compact-filters">
        <Action secondary onClick={() => move(-7)}>
          <Icon name="chevron" size={18} />
          <span className="sr-only">{t("이전 주")}</span>
        </Action>
        <Field
          label="기준 날짜"
          type="date"
          value={anchor}
          onChange={(e) => {
            if (
              /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) &&
              Number.isFinite(Date.parse(e.target.value))
            ) {
              setAnchor(e.target.value);
              setDayFilter("");
            }
          }}
        />
        <Action secondary onClick={() => move(7)}>
          <Icon name="chevron" size={18} />
          <span className="sr-only">{t("다음 주")}</span>
        </Action>
      </div>
      <div className="planning-schedule-view">
        <Tabs
          label="일정 보기"
          value={layout}
          onChange={setLayout}
          items={[
            { id: "week", label: "주간" },
            { id: "list", label: "목록" },
          ]}
        />
        <Action
          secondary
          onClick={() => {
            setAnchor(MOCK_NOW.slice(0, 10));
            setDayFilter("");
          }}
        >
          오늘
        </Action>
        <button className="secondary planning-filter-toggle" type="button"
          aria-label={t("일정 필터")} aria-expanded={filtersOpen} aria-controls={filtersId}
          onClick={() => setFiltersOpen((open) => !open)}>
          <Icon name="sliders" size={16} /><span>{t("필터")}</span>
          {(eventFilter || artistFilter || !tentative) && <span className="nav-count">{Number(!!eventFilter) + Number(!!artistFilter) + Number(!tentative)}</span>}
        </button>
      </div>
      <div className="planning-schedule-filters" id={filtersId} hidden={!filtersOpen}>
      <div className="planning-filters">
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
        <Select
          label="아티스트 필터"
          value={artistFilter}
          onChange={(e) => setArtistFilter(e.target.value)}
        >
          <option value="">{t("모든 아티스트")}</option>
          {data.planning.artists
            .filter((a) => a.scopeId === venue.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
      </div>
      <Toggle
        label="미확정 일정 포함"
        checked={tentative}
        onChange={(e) => setTentative(e.target.checked)}
      />
      </div>
      {!filtersOpen && (eventFilter || artistFilter || !tentative) && <p className="planning-hint">
        {[data.events.find((e) => e.id === eventFilter)?.name,
          data.planning.artists.find((a) => a.id === artistFilter)?.name,
          !tentative ? t("확정") : ""].filter(Boolean).join(" · ")}
      </p>}
      {layout === "week" && (
        <nav className="planning-week" aria-label={t("주간 날짜 선택")}>
          {dates.map((day) => (
            <button
              key={day}
              aria-pressed={dayFilter === day}
              aria-current={day === MOCK_NOW.slice(0, 10) ? "date" : undefined}
              aria-label={`${day.replaceAll("-", ".")} · ${weekday.format(new Date(`${day}T12:00:00Z`))}${day === MOCK_NOW.slice(0, 10) ? ` · ${t("오늘")}` : ""} · ${t("부킹 {count}건", { count: onDay(day).length })}`}
              onClick={() =>
                setDayFilter((current) => (current === day ? "" : day))
              }
            >
              <span>{day === MOCK_NOW.slice(0, 10) ? t("오늘") : weekday.format(new Date(`${day}T12:00:00Z`))}</span>
              <strong>{Number(day.slice(-2))}</strong>
              <small>{onDay(day).length || "—"}</small>
            </button>
          ))}
        </nav>
      )}
      <div className="planning-card-top">
        <p className="planning-result" role="status">
          {(dayFilter || dates[0]).replaceAll("-", ".")}
          {!dayFilter && ` — ${dates[6].slice(5).replace("-", ".")}`} · KST
        </p>
        {dayFilter && (
          <button
            className="planning-text-action"
            onClick={() => setDayFilter("")}
          >
            {t("주 전체 보기")}
          </button>
        )}
      </div>
      <div className="planning-agenda">
        {visibleDates
          .filter((day) => onDay(day).length)
          .map((day) => (
            <section key={day}>
              <h2 className="planning-section-title">
                {day.slice(5).replace("-", ".")}
              </h2>
              {onDay(day).map((b) => (
                <button
                  className="planning-agenda-item"
                  key={b.id}
                  onClick={() => setSelected(b.id)}
                >
                  <div className="planning-agenda-time">
                    <strong>
                      {b.start.slice(0, 10) < day
                        ? t("전날부터")
                        : b.start.slice(11)}
                    </strong>
                    <small>
                      {b.end.slice(0, 10) > day
                        ? `${t("다음 날")} ${b.end.slice(11)}`
                        : b.end.slice(11)}
                    </small>
                  </div>
                  <div>
                    <div className="planning-card-top">
                      <strong>
                        {
                          data.planning.artists.find((a) => a.id === b.artistId)
                            ?.name
                        }
                      </strong>
                      <Status booking={b} />
                    </div>
                    <p>{data.events.find((e) => e.id === b.eventId)?.name}</p>
                    <small>{b.stage || t("무대 미정")}</small>
                    {conflictsFor(b, data.planning.bookings).length > 0 && (
                      <span className="planning-flag">
                        {t("일정 겹침 확인")}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </section>
          ))}
      </div>
      {!visibleDates.some((day) => onDay(day).length) && (
        <Empty text="선택한 기간에 등록된 출연 일정이 없습니다." />
      )}
      {unscheduled.length > 0 && (
        <section className="planning-undated">
          <h2 className="planning-section-title">
            {t("날짜 조율이 필요한 부킹")}
          </h2>
          {unscheduled.map((b) => (
            <button
              className="planning-history-link"
              key={b.id}
              onClick={() => setSelected(b.id)}
            >
              <span>
                <strong>
                  {data.planning.artists.find((a) => a.id === b.artistId)?.name}
                </strong>
                <small>
                  {data.events.find((e) => e.id === b.eventId)?.name} ·{" "}
                  {b.nextAction}
                </small>
              </span>
              <Status booking={b} />
            </button>
          ))}
        </section>
      )}
      {selected && (
        <BookingSheet bookingId={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
