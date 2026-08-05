interface GuestCapacityIndicatorProps {
  label: string;
  remaining: number | null;
  limit: number | null;
}

/** 게스트 추가 패널 header에서 남은 정원과 사용률 경계선을 표시합니다. */
export default function GuestCapacityIndicator({
  label,
  remaining,
  limit,
}: GuestCapacityIndicatorProps) {
  const isUnlimited = remaining === null || limit === null;
  const displayedRemaining = isUnlimited ? "∞" : Math.max(0, remaining);
  const remainingRatio =
    !isUnlimited && limit > 0
      ? Math.min(100, Math.max(0, (remaining / limit) * 100))
      : isUnlimited
        ? 100
        : 0;
  const usedRatio = isUnlimited ? 0 : 100 - remainingRatio;
  const isAtLimit = !isUnlimited && remaining <= 0;
  const isRunningLow =
    !isUnlimited && !isAtLimit && limit > 0 && remainingRatio <= 25;
  const valueClasses = isAtLimit
    ? "text-status-danger"
    : isRunningLow
      ? "text-status-waiting"
      : "text-text-heading";
  const meterClasses = isAtLimit
    ? "bg-status-danger"
    : isRunningLow
      ? "bg-status-waiting"
      : "bg-text-muted";

  return (
    <dl className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
      <dt className="text-xs font-medium leading-none text-text-muted">
        {label}
      </dt>
      <dd className="flex items-baseline gap-1 text-right">
        <span
          className={`font-mono text-xl font-semibold leading-none tabular-nums ${valueClasses}`}
        >
          {displayedRemaining}
        </span>
        {!isUnlimited && (
          <span className="font-mono text-xs tabular-nums text-text-dim">
            / {limit}
          </span>
        )}
      </dd>
      <dd
        className="absolute inset-x-0 -bottom-px h-0.5"
        aria-hidden="true"
      >
        <span
          className={`block h-full ${meterClasses}`}
          style={{ width: `${usedRatio}%` }}
        />
      </dd>
    </dl>
  );
}
