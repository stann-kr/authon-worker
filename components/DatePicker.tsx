"use client";

import { useId } from "react";
import { getBusinessDate } from "@/lib/date";
import Icon from "./Icon";
import DateField from "./dates/DateField";
import { useTranslations } from "next-intl";

/**
 * DatePicker: 날짜 선택 패널 컴포넌트.
 *
 * 사용 예:
 * <DatePicker value={selectedDate} onChange={setSelectedDate} />
 */

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  businessDate?: string;
  className?: string;
  disabled?: boolean;
  compact?: boolean;
}

function offsetDate(baseYmd: string, deltaDays: number): string {
  const match = baseYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return baseYmd;

  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + deltaDays);
  if (date.getFullYear() < 1 || date.getFullYear() > 9999) return baseYmd;

  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function DatePicker({
  value,
  onChange,
  businessDate = getBusinessDate(),
  className = "",
  disabled = false,
  compact = false,
}: DatePickerProps) {
  const t = useTranslations("Common");
  const inputId = useId();
  const isToday = value === businessDate;

  return (
    <div
      data-compact={compact}
      className={`operational-date-control min-w-0 ${disabled ? "opacity-60" : ""} ${className}`}
    >
      <label htmlFor={inputId} className="type-context-title">
        {t("operationalDate")}
      </label>
      <div className="operational-date-layout">
        <DateField id={inputId} name="operational-date" value={value} onChange={onChange}
          businessDate={businessDate} disabled={disabled} className="operational-date-field flex-1" />

        <div
          role="group"
          aria-label={t("changeOperationalDate")}
          className="operational-date-quick grid h-[46px] grid-cols-3"
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(offsetDate(value, -1))}
            aria-label={t("previousDate")}
            className="pressable flex min-h-11 touch-manipulation items-center justify-center gap-1 bg-surface-raised px-3 font-mono text-xs text-text-body hover:bg-surface-hover hover:text-text-heading disabled:cursor-not-allowed"
          >
            <Icon name="chevron-left" size={15} />
            <span className="date-offset-label">-1D</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(businessDate)}
            aria-pressed={isToday}
            aria-label={t("setToday")}
            className={`pressable min-h-11 touch-manipulation px-3 font-mono text-xs font-semibold disabled:cursor-not-allowed ${
              isToday
                ? "bg-surface-active text-text-heading"
                : "bg-surface-raised text-text-body hover:bg-surface-hover hover:text-text-heading"
            }`}
          >
            {t("today")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(offsetDate(value, 1))}
            aria-label={t("nextDate")}
            className="pressable flex min-h-11 touch-manipulation items-center justify-center gap-1 bg-surface-raised px-3 font-mono text-xs text-text-body hover:bg-surface-hover hover:text-text-heading disabled:cursor-not-allowed"
          >
            <span className="date-offset-label">+1D</span>
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
