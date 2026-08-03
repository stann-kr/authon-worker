import Icon, { type IconName } from "./Icon";

/**
 * EmptyState — 데이터가 없을 때 표시하는 빈 상태 컴포넌트.
 *
 * 사용 예:
 * <EmptyState icon="user" message="NO GUESTS FOR THIS DATE" />
 */

interface EmptyStateProps {
  icon?: IconName;
  message: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({
  icon = "user",
  message,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="px-6 py-12 text-center" role="status">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center text-text-muted">
        <Icon name={icon} size={22} />
      </div>
      <p className="text-sm font-semibold text-text-heading">
        {message}
      </p>
      {description && (
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
