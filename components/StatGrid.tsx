/**
 * StatGrid — 통계 수치를 그리드로 표시하는 컴포넌트.
 *
 * 사용 예:
 * <StatGrid items={[
 *   { label: 'WAITING', value: 5 },
 *   { label: 'CHECKED', value: 3, color: 'default' },
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
  /** 현재 범위의 통계가 준비되지 않았으면 숫자 대신 dash를 표시한다. */
  isLoading?: boolean;
  /** 라벨 텍스트 크기 오버라이드 (기본: 'text-xs') */
  labelClassName?: string;
}

export default function StatGrid({
  items,
  isLoading = false,
  labelClassName,
}: StatGridProps) {
  const colsClass =
    items.length === 1
      ? "grid-cols-1"
      : items.length === 2
        ? "grid-cols-2"
        : items.length === 3
          ? "grid-cols-3"
          : "grid-cols-2 sm:grid-cols-4";

  return (
    <dl
      className={`grid ${colsClass} divide-x divide-border-subtle border-y border-border-subtle`}
      aria-busy={isLoading}
    >
      {items.map((item) => {
        return (
          <div
            key={item.label}
            className="flex min-w-0 flex-col items-center bg-surface px-3 py-2.5 text-center sm:px-4"
          >
            <dt
              className={`${statLabelColorMap[item.color ?? "default"]} order-2 mt-0.5 font-medium leading-tight ${labelClassName ?? "text-xs"}`}
            >
              {item.label}
            </dt>
            <dd
              className={`order-1 font-mono text-lg sm:text-xl ${statColorMap[item.color ?? "default"]}`}
            >
              {isLoading ? "-" : item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
