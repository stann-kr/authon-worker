"use client";

import Icon from "./Icon";
import { useTranslations } from "next-intl";

/**
 * PanelHeader — 리스트 패널(main-content-panel 등)의 공통 헤더.
 * border-b 구분선, 제목, 그리고 Sort / Context / Refresh 액션 순서를 통일.
 *
 * 사용 예:
 * <PanelHeader
 *   title="GUEST LIST"
 *   count={25}
 *   sortMode={sortMode}
 *   onSortToggle={() => setSortMode(prev => prev === 'default' ? 'alpha' : 'default')}
 *   onRefresh={loadData}
 * />
 */

interface PanelHeaderProps {
  title: string;
  count?: number;
  headingLevel?: 1 | 2 | 3;
  headingId?: string;
  /** 정렬 모드. 전달하지 않으면 Sort 버튼 숨김 */
  sortMode?: "default" | "alpha";
  onSortToggle?: () => void;
  /** 전달하지 않으면 Refresh 버튼 숨김 */
  onRefresh?: () => void;
  /** 로딩 상태 여부 */
  isLoading?: boolean;
  /** 추가 액션 버튼(슬롯) */
  actions?: React.ReactNode;
}

export default function PanelHeader({
  title,
  count,
  headingLevel = 3,
  headingId,
  sortMode,
  onSortToggle,
  onRefresh,
  isLoading,
  actions,
}: PanelHeaderProps) {
  const t = useTranslations("Common");
  const hasButtons =
    (sortMode !== undefined && onSortToggle) || onRefresh || actions;
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";
  const displayedCount = isLoading && count === 0 ? "-" : count;

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
      <Heading id={headingId} className="type-panel-title">
        {title}
        {displayedCount !== undefined && (
          <span className="ml-2 font-mono text-xs font-normal tabular-nums text-text-dim">
            {displayedCount}
          </span>
        )}
      </Heading>
      {hasButtons && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {sortMode !== undefined && onSortToggle && (
            <button
              type="button"
              onClick={onSortToggle}
              aria-pressed={sortMode === "alpha"}
              aria-label={sortMode === "alpha" ? t("sortByCreationTime") : t("sortAlphabetically")}
              className="pressable min-h-11 touch-manipulation whitespace-nowrap rounded-control border border-border-default bg-surface-raised px-3 py-2 text-center text-xs font-medium text-text-muted hover:border-border-strong hover:text-text-heading"
            >
              {sortMode === "alpha" ? "A-Z" : t("created")}
            </button>
          )}
          {actions}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="pressable flex min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-control border border-border-default bg-surface-raised px-3 py-2 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text-heading disabled:opacity-50"
            >
              <Icon name="refresh" size={16} className={isLoading ? "animate-spin" : ""} />
              {t("refresh")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
