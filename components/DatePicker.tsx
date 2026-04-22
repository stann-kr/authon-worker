"use client";

import { formatDateDisplay } from "@/lib/date";

/**
 * DatePicker — 날짜 선택 패널 컴포넌트.
 *
 * 사용 예:
 * <DatePicker value={selectedDate} onChange={setSelectedDate} />
 */

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function DatePicker({
  value,
  onChange,
  className = "",
}: DatePickerProps) {
  return (
    <div
      className={`bg-gray-900 border border-gray-700 p-4 sm:p-5 ${className}`}
    >
      <div className="mb-2">
        <h3 className="font-mono text-xs sm:text-sm tracking-wider text-gray-400 uppercase">
          SELECT DATE
        </h3>
      </div>
      <div className="relative h-[46px] group">
        {/* Mirroring UI Layer: 사용자가 실제로 보게 되는 텍스트와 달력 아이콘 */}
        <div className="absolute inset-0 bg-black border border-gray-600 px-4 py-3 flex items-center justify-between pointer-events-none group-focus-within:border-white transition-colors">
          <span className="text-white font-mono text-sm tracking-wider">
            {formatDateDisplay(value)}
          </span>
          <i className="ri-calendar-line text-gray-400"></i>
        </div>

        {/* Hidden Native Input: 클릭 이벤트를 감전하여 달력을 띄우는 역할 */}
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => (e.target as any).showPicker?.()}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 [color-scheme:dark]"
        />
      </div>
    </div>
  );
}
