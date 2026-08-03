"use client";

import { useId } from "react";
import { formatDateDisplay, getBusinessDate } from "@/lib/date";
import Icon from "./Icon";
import { useLocale, useTranslations } from "next-intl";

/**
 * DatePicker: 날짜 선택 패널 컴포넌트.
 *
 * 사용 예:
 * <DatePicker value={selectedDate} onChange={setSelectedDate} />
 */

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

function offsetDate(baseYmd: string, deltaDays: number): string {
  const match = baseYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return baseYmd;

  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + deltaDays);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function DatePicker({
  value,
  onChange,
  className = "",
}: DatePickerProps) {
  const t = useTranslations("Common");
  const locale = useLocale() as "en" | "ko";
  const inputId = useId();
  const isToday = value === getBusinessDate();

  return (
    <div className={`operational-date-control min-w-0 ${className}`}>
      <label htmlFor={inputId} className="type-context-title">
        {t("operationalDate")}
      </label>
      <div className="operational-date-layout">
        <div className="relative h-[46px] min-w-0 flex-1 group">
          {/* Mirroring UI Layer: 사용자가 실제로 보게 되는 텍스트와 달력 아이콘 */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between rounded-control border border-border-default bg-surface-raised px-4 py-3 group-focus-within:border-border-focus">
            <span className="min-w-0 truncate pr-3 text-sm font-medium text-text-heading">
              {formatDateDisplay(value, locale)}
            </span>
            <Icon name="calendar" size={18} className="text-text-muted" />
          </div>

          {/* Hidden Native Input: 클릭 이벤트를 감지하여 달력을 띄우는 역할 */}
          <input
            id={inputId}
            name="operational-date"
            type="date"
            value={value}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => {
              const input = e.currentTarget as HTMLInputElement & {
                showPicker?: () => void;
              };
              input.showPicker?.();
            }}
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 [color-scheme:dark]"
          />
        </div>

        <div
          role="group"
          aria-label={t("changeOperationalDate")}
          className="operational-date-quick grid h-[46px] grid-cols-3 divide-x divide-border-default border border-border-default"
        >
          <button
            type="button"
            onClick={() => onChange(offsetDate(value, -1))}
            aria-label={t("previousDate")}
            className="pressable flex min-h-11 touch-manipulation items-center justify-center gap-1 bg-surface-raised px-3 font-mono text-xs text-text-body hover:bg-surface-hover hover:text-text-heading"
          >
            <Icon name="chevron-left" size={15} />
            <span>-1D</span>
          </button>
          <button
            type="button"
            onClick={() => onChange(getBusinessDate())}
            aria-pressed={isToday}
            aria-label={t("setToday")}
            className={`pressable min-h-11 touch-manipulation px-3 font-mono text-xs font-semibold ${
              isToday
                ? "bg-action-primary text-action-text"
                : "bg-surface-raised text-text-body hover:bg-surface-hover hover:text-text-heading"
            }`}
          >
            {t("today")}
          </button>
          <button
            type="button"
            onClick={() => onChange(offsetDate(value, 1))}
            aria-label={t("nextDate")}
            className="pressable flex min-h-11 touch-manipulation items-center justify-center gap-1 bg-surface-raised px-3 font-mono text-xs text-text-body hover:bg-surface-hover hover:text-text-heading"
          >
            <span>+1D</span>
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
