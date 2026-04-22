"use client";

/**
 * PanelHeader — 리스트 패널(main-content-panel 등)의 공통 헤더.
 * border-b 구분선, 제목, 그리고 Sort / Refresh 등 액션 버튼을 통일.
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
  sortMode,
  onSortToggle,
  onRefresh,
  isLoading,
  actions,
}: PanelHeaderProps) {
  const displayTitle = count !== undefined ? `${title} (${count})` : title;
  const hasButtons =
    (sortMode !== undefined && onSortToggle) || onRefresh || actions;

  return (
    <div className="border-b border-gray-700 px-4 pt-4 pb-3 flex-shrink-0">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs sm:text-sm tracking-wider text-white uppercase">
          {displayTitle}
        </h3>
      </div>
      {hasButtons && (
        <div className="flex items-center gap-2 mt-2">
          {sortMode !== undefined && onSortToggle && (
            <button
              onClick={onSortToggle}
              className="flex-1 py-2 bg-gray-800 text-gray-400 font-mono text-xs tracking-wider uppercase hover:text-white transition-colors border border-gray-700 whitespace-nowrap text-center"
            >
              SORT: {sortMode === "alpha" ? "ABC" : "DEFAULT"}
            </button>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="flex-1 py-2 bg-gray-800 text-gray-400 font-mono text-xs tracking-wider uppercase hover:text-white transition-colors border border-gray-700 disabled:opacity-50"
            >
              <i
                className={`ri-refresh-line mr-1 ${isLoading ? "animate-spin inline-block" : ""}`}
              ></i>
              REFRESH
            </button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
