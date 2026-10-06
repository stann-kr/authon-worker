/**
 * 첫 조회 동안 실제 통계 화면과 같은 카드·차트 골격을 보여 줍니다.
 * 이후 기간 변경은 직전 결과를 흐리게 유지하므로 이 골격을 다시 쓰지 않습니다.
 */
function PanelHeader() {
  return (
    <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
      <div className="h-4 w-32 rounded-inner bg-surface-active" />
    </div>
  );
}

export default function AnalyticsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="skeleton-pulse space-y-4">
      {[0, 1].map((panel) => (
        <section key={panel} className="app-panel" aria-hidden="true">
          <PanelHeader />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className={`min-w-0 p-4 sm:p-5 ${
                  index > 0 ? "border-t border-border-subtle sm:border-t-0 sm:border-l" : ""
                } ${index === 2 ? "sm:border-l-0 xl:border-l" : ""} ${
                  index >= 2 ? "sm:border-t xl:border-t-0" : ""
                }`}
              >
                <div className="h-3 w-24 rounded-inner bg-surface-active" />
                <div className="mt-3 h-6 w-16 rounded-inner bg-surface-active" />
                <div className="mt-3 h-3 w-20 rounded-inner bg-surface-hover" />
              </div>
            ))}
          </div>
          {panel === 1 && (
            <div className="border-t border-border-subtle p-3 sm:p-5">
              <div className="h-64 w-full rounded-control bg-surface-hover" />
            </div>
          )}
        </section>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
