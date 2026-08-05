import type { ReactNode } from "react";
import Icon from "./Icon";

interface DisclosureSectionProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 패널 안에서 보조 작업을 단계적으로 노출하는 공통 disclosure 패턴입니다.
 * 바깥 패널의 외곽선을 반복하지 않고 상단 구획선만 사용합니다.
 */
export default function DisclosureSection({
  title,
  meta,
  children,
  className = "",
}: DisclosureSectionProps) {
  return (
    <details
      className={`disclosure-section group mt-4 border-t border-border-subtle pt-2 ${className}`}
    >
      <summary className="pressable -mx-1 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-1 py-2 text-sm font-medium text-text-muted hover:text-text-heading group-open:text-text-heading [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {meta ? (
            <span className="font-mono text-xs tabular-nums text-text-dim group-open:text-text-muted">
              {meta}
            </span>
          ) : null}
          <Icon
            name="chevron-down"
            size={16}
            className="disclosure-chevron shrink-0"
          />
        </span>
      </summary>
      <div className="disclosure-content pb-1 pt-2">{children}</div>
    </details>
  );
}
