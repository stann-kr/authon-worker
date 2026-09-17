"use client";

import { forwardRef, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateDisplay, getBusinessDate } from "@/lib/date";
import Icon from "../Icon";
import Sheet from "../overlays/Sheet";
import { lockInertSurface } from "../overlays/modal-lock";

function dateAt(year: number, month: number, day = 1) {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function ymd(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = dateAt(year, month - 1, day);
  return year >= 1 && ymd(date) === value ? date : null;
}

function changeMonth(date: Date, offset: number) {
  const first = dateAt(date.getFullYear(), date.getMonth() + offset);
  const lastDay = dateAt(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return dateAt(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), lastDay));
}

interface DateFieldProps {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  businessDate?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

/** A single date selection surface shared by operational scope and link forms. */
const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField({
  id, name, value, onChange, businessDate = getBusinessDate(), disabled = false,
  required = false, invalid, describedBy, className = "",
}, forwardedRef) {
  const t = useTranslations("DateField");
  const commonT = useTranslations("Common");
  const locale = useLocale() as "en" | "ko";
  const dialogId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const focusDay = useRef(false);
  const today = parseDate(businessDate) ?? parseDate(getBusinessDate())!;
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => parseDate(value) ?? today);
  const [yearDraft, setYearDraft] = useState<string | null>(null);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cursorValue = ymd(cursor);
  const monthLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(cursor);
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full" });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const first = dateAt(year, month);
  const weekCount = Math.ceil((first.getDay() + dateAt(year, month + 1, 0).getDate()) / 7);
  const days = Array.from({ length: weekCount * 7 }, (_, index) => dateAt(year, month, index - first.getDay() + 1));

  const openCalendar = () => {
    if (disabled) return;
    focusDay.current = true;
    setYearDraft(null);
    setCursor(parseDate(value) ?? today);
    setOpen(true);
  };
  const choose = (date: Date) => {
    if (disabled) return;
    onChange(ymd(date));
    setOpen(false);
  };
  const move = (date: Date, focus = false) => {
    if (date.getFullYear() >= 1 && date.getFullYear() <= 9999) {
      focusDay.current = focus;
      setCursor(date);
    }
  };
  const navigateDay = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
      Home: -date.getDay(), End: 6 - date.getDay() };
    if (event.key in offsets) {
      event.preventDefault();
      move(dateAt(date.getFullYear(), date.getMonth(), date.getDate() + offsets[event.key]), true);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      move(changeMonth(date, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)), true);
    }
  };

  useLayoutEffect(() => {
    if (!open || disabled || !focusDay.current) return;
    calendarRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${cursorValue}"]`)?.focus({ preventScroll: true });
    focusDay.current = false;
  }, [open, disabled, cursorValue]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    // The scope sheet stays open underneath the calendar, with its own lock intact.
    return lockInertSurface(inputRef.current?.closest<HTMLElement>(".product-sheet") ?? null);
  }, [open, disabled]);
  useLayoutEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return <>
    <div className={`date-field app-field-frame ${className}`}>
      <div className={`app-field date-field-display ${invalid ? "border-status-danger" : ""}`}>
        <span>{formatDateDisplay(value, locale)}</span><Icon name="calendar" size={18} className="text-text-muted" />
      </div>
      <input id={id} name={name} ref={(element) => {
        inputRef.current = element;
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }} className="date-field-input" type="text" role="combobox" readOnly value={value}
        autoComplete="off" disabled={disabled} aria-required={required || undefined} aria-invalid={invalid || undefined}
        aria-describedby={describedBy} aria-haspopup="dialog" aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? dialogId : undefined}
        onClick={openCalendar} onKeyDown={(event) => {
          if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); openCalendar(); }
        }} />
    </div>
    <Sheet id={dialogId} open={open && !disabled} title={t("chooseDate")} onClose={() => setOpen(false)}>
      <div className="date-calendar" ref={calendarRef}>
        <div className="date-calendar-navigation">
          <button type="button" aria-label={t("previousMonth")} disabled={year === 1 && month === 0}
            onClick={() => move(changeMonth(cursor, -1))}><Icon name="chevron-left" size={20} /></button>
          <label className="date-calendar-month"><span className="sr-only">{t("month")}</span>
            <select className="app-field appearance-none" value={month} onChange={(event) => move(changeMonth(cursor, Number(event.target.value) - month))}>
              {Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>
                {new Intl.DateTimeFormat(locale, { month: "long" }).format(dateAt(year, index))}
              </option>)}
            </select><Icon name="chevron-down" size={16} />
          </label>
          <label className="date-calendar-year"><span className="sr-only">{t("year")}</span>
            <input className="app-field" type="number" inputMode="numeric" min={1} max={9999} value={yearDraft ?? year}
              onFocus={() => setYearDraft(String(year))}
              onChange={(event) => {
                const draft = event.target.value;
                const next = Number(draft);
                setYearDraft(draft);
                if (draft.length === 4 && Number.isInteger(next) && next >= 1 && next <= 9999) move(changeMonth(cursor, (next - year) * 12));
              }} onBlur={() => {
                const next = Number(yearDraft);
                if (yearDraft && Number.isInteger(next) && next >= 1 && next <= 9999) move(changeMonth(cursor, (next - year) * 12));
                setYearDraft(null);
              }} />
          </label>
          <button type="button" aria-label={t("nextMonth")} disabled={year === 9999 && month === 11}
            onClick={() => move(changeMonth(cursor, 1))}><Icon name="chevron-right" size={20} /></button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{monthLabel}</p>
        <div role="grid" aria-label={monthLabel} className="date-calendar-grid">
          <div role="row" className="date-calendar-weekdays">
            {days.slice(0, 7).map((day) => <span role="columnheader" key={day.getDay()}>{weekday.format(day)}</span>)}
          </div>
          {Array.from({ length: weekCount }, (_, week) => <div role="row" key={week}>
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const date = ymd(day);
              return <div role="gridcell" aria-selected={date === value} key={date}>
                <button type="button" data-date={date} data-outside={day.getMonth() !== month}
                  disabled={day.getFullYear() < 1 || day.getFullYear() > 9999}
                  aria-label={fullDate.format(day)} aria-current={date === businessDate ? "date" : undefined}
                  tabIndex={date === cursorValue ? 0 : -1} onKeyDown={(event) => navigateDay(event, day)}
                  onClick={() => choose(day)}>{day.getDate()}</button>
              </div>;
            })}
          </div>)}
        </div>
        <button type="button" className="date-calendar-today" onClick={() => choose(today)}>{commonT("today")}</button>
      </div>
    </Sheet>
  </>;
});

export default DateField;
