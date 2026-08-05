import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import Icon from "./Icon";

interface DisclosureSectionProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  isLoading?: boolean;
  summaryElementRef?: Ref<HTMLElement>;
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
  disabled = false,
  isLoading = false,
  summaryElementRef,
}: DisclosureSectionProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const hadFocusWithinRef = useRef(false);
  const setSummaryElement = useCallback(
    (element: HTMLElement | null) => {
      summaryRef.current = element;
      if (typeof summaryElementRef === "function") {
        summaryElementRef(element);
      } else if (summaryElementRef) {
        summaryElementRef.current = element;
      }
    },
    [summaryElementRef],
  );

  useLayoutEffect(() => {
    const details = detailsRef.current;
    if (!disabled || !details?.open) return;

    const hadFocus =
      hadFocusWithinRef.current ||
      (document.activeElement instanceof HTMLElement &&
        details.contains(document.activeElement));
    details.open = false;
    if (hadFocus) summaryRef.current?.focus();
  }, [disabled]);

  return (
    <details
      ref={detailsRef}
      aria-busy={isLoading || undefined}
      aria-disabled={disabled || undefined}
      onFocusCapture={() => {
        hadFocusWithinRef.current = true;
      }}
      onBlurCapture={(event) => {
        if (event.relatedTarget instanceof Node) {
          hadFocusWithinRef.current = event.currentTarget.contains(
            event.relatedTarget,
          );
          return;
        }

        queueMicrotask(() => {
          const details = detailsRef.current;
          hadFocusWithinRef.current = Boolean(
            details &&
              document.activeElement instanceof Node &&
              details.contains(document.activeElement),
          );
        });
      }}
      className={`disclosure-section group mt-4 border-t border-border-subtle pt-2 ${className}`}
    >
      <summary
        ref={setSummaryElement}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={disabled ? (event) => event.preventDefault() : undefined}
        className={`pressable -mx-1 flex min-h-11 list-none items-center justify-between gap-3 px-1 py-2 text-sm font-medium text-text-muted group-open:text-text-heading [&::-webkit-details-marker]:hidden ${
          disabled
            ? "cursor-default opacity-75"
            : "cursor-pointer hover:text-text-heading"
        }`}
      >
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
