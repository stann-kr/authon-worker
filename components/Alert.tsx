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
}

export default function Alert({ type, message, className = '' }: AlertProps) {
  if (!message) return null;

  const styles = {
    error: 'bg-red-900/30 border-red-700 text-red-400',
    success: 'bg-green-900/30 border-green-700 text-green-400',
  };

  const icons = {
    error: 'ri-error-warning-line',
    success: 'ri-check-line',
  };

  return (
    <div className={`border p-4 ${styles[type]} ${className}`}>
      <div className="flex items-center gap-3">
        <i className={`${icons[type]} flex-shrink-0`}></i>
        <p className="font-mono text-xs sm:text-sm tracking-wider">{message}</p>
      </div>
    </div>
  );
}
