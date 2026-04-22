/**
 * EmptyState — 데이터가 없을 때 표시하는 빈 상태 컴포넌트.
 *
 * 사용 예:
 * <EmptyState icon="ri-user-line" message="NO GUESTS FOR THIS DATE" />
 */

interface EmptyStateProps {
  icon: string;
  message: string;
}

export default function EmptyState({ icon, message }: EmptyStateProps) {
  return (
    <div className="p-8 text-center">
      <div className="w-16 h-16 border border-gray-600 mx-auto mb-4 flex items-center justify-center">
        <i className={`${icon} text-gray-400 text-2xl`}></i>
      </div>
      <p className="text-gray-400 font-mono text-sm tracking-wider uppercase">
        {message}
      </p>
    </div>
  );
}
