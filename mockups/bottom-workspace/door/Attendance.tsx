import { Icon } from "../shared/Icon";
import "./attendance.css";

export function Attendance({
  checked,
  walkIns,
  onWalkIn,
  onUndo,
  canUndo,
  compact = false,
  isClosed,
  canRecord,
  onCloseout,
  canClose,
}: {
  checked: number;
  walkIns: number;
  onWalkIn: () => void;
  onUndo: () => void;
  canUndo: boolean;
  compact?: boolean;
  isClosed: boolean;
  canRecord: boolean;
  onCloseout: () => void;
  canClose: boolean;
}) {
  return (
    <section
      className={`attendance ${compact ? "compact" : ""}`}
      aria-label="입장 집계"
    >
      <div className="attendance-head">
        <span className="eyebrow">ATTENDANCE</span>
        <span className={`status-badge ${canRecord ? "green" : ""}`}>
          {isClosed ? "마감됨" : canRecord ? "집계 중" : "행사 예정"}
        </span>
      </div>
      <h2>누적 입장</h2>
      <div className="attendance-total">
        {checked + walkIns}
        <small>명</small>
      </div>
      <div className="attendance-split">
        <div>
          <span>게스트 입장</span>
          <strong>{checked}</strong>
        </div>
        <span className="math-plus">+</span>
        <div>
          <span>워크인</span>
          <strong>{walkIns}</strong>
        </div>
      </div>
      <p className="attendance-note">퇴장을 차감하지 않은 누적 입장 수예요.</p>
      <div className="walkin-control">
        <div>
          <span className="eyebrow">WALK-IN</span>
          <h3>명단 없는 입장</h3>
        </div>
        <button
          className="walkin-plus"
          aria-label="워크인 1명 추가"
          disabled={!canRecord}
          onClick={onWalkIn}
        >
          <Icon name="plus" size={25} />
          <span>1명</span>
        </button>
      </div>
      <button
        className="text-button undo-button"
        disabled={!canUndo || !canRecord}
        onClick={onUndo}
      >
        <Icon name="undo" size={15} />
        마지막 워크인 되돌리기
      </button>
      {canClose && (
        <button
          className="closeout-link"
          disabled={!canRecord}
          onClick={onCloseout}
        >
          <Icon name="file" size={17} />
          {isClosed ? "입장 합계 마감 완료" : "입장 합계 확인·마감"}
          <Icon name="chevron" size={16} />
        </button>
      )}
    </section>
  );
}
