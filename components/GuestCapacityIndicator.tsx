interface GuestCapacityIndicatorProps {
  label: string;
  value: string | number;
}

/** 게스트 추가 패널에서 제목 옆 정원 정보를 같은 기준선에 표시합니다. */
export default function GuestCapacityIndicator({
  label,
  value,
}: GuestCapacityIndicatorProps) {
  return (
    <div
      className="flex shrink-0 items-baseline gap-2 whitespace-nowrap"
      aria-label={`${label}: ${value}`}
    >
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <span className="font-mono text-xl tabular-nums text-text-heading">
        {value}
      </span>
    </div>
  );
}
