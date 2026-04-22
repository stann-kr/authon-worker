/**
 * StatGrid — 통계 수치를 그리드로 표시하는 컴포넌트.
 *
 * 사용 예:
 * <StatGrid items={[
 *   { label: 'WAITING', value: 5 },
 *   { label: 'CHECKED', value: 3, color: 'green' },
 * ]} />
 */

import { StatColor, statColorMap, statLabelColorMap } from "../lib/colors";

interface StatItem {
  label: string;
  value: string | number;
  color?: StatColor;
}

interface StatGridProps {
  items: StatItem[];
  /** 라벨 텍스트 크기 오버라이드 (기본: 'text-[10px] sm:text-xs') */
  labelClassName?: string;
}

export default function StatGrid({ items, labelClassName }: StatGridProps) {
  const colsClass = items.length <= 1 ? "grid-cols-1" : "grid-cols-2";

  return (
    <div className={`grid ${colsClass} gap-px bg-gray-700`}>
      {items.map((item, index) => {
        const isLastOddItem =
          items.length > 1 &&
          items.length % 2 === 1 &&
          index === items.length - 1;

        return (
          <div
            key={item.label}
            className={`bg-gray-800 p-3 text-center min-w-0 ${isLastOddItem ? "col-span-2" : ""}`}
          >
            <div
              className={`font-mono text-sm sm:text-xl tracking-wider ${statColorMap[item.color ?? "white"]}`}
            >
              {item.value}
            </div>
            <div
              className={`${statLabelColorMap[item.color ?? "white"]} font-mono tracking-wide uppercase leading-tight whitespace-normal break-words px-1 ${labelClassName ?? "text-[10px] sm:text-xs"}`}
            >
              {item.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
