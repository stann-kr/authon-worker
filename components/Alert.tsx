import Icon from "./Icon";

/**
 * Alert — 에러/성공 알림 메시지 컴포넌트.
 *
 * 사용 예:
 * <Alert type="error" message="게스트 등록에 실패했습니다." />
 * <Alert type="success" message="프로필이 저장되었습니다." />
 */

interface AlertProps {
  type: 'error' | 'success';
  message: string;
  className?: string;
  /** Lets a field reference this message through aria-describedby. */
  id?: string;
}

export default function Alert({ type, message, className = '', id }: AlertProps) {
  if (!message) return null;

  const styles = {
    error: "border-transparent bg-status-danger/10 text-status-danger",
    success: "border-transparent bg-status-checked/10 text-status-checked",
  };

  return (
    <div
      id={id}
      className={`rounded-control border p-4 ${styles[type]} ${className}`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-center gap-3">
        <Icon name={type === "error" ? "warning" : "check"} className="shrink-0" />
        <p className="text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  );
}
