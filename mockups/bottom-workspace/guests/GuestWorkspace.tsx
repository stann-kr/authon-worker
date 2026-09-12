import { useState } from "react";
import type { Guest, PreviewRole } from "../model";
import { Icon } from "../shared/Icon";
import "./guests.css";

export function GuestRoster({
  guests,
  role,
  total,
  onDetail,
  onCheck,
  onClear,
}: {
  guests: Guest[];
  role: PreviewRole;
  total: number;
  onDetail: (guest: Guest) => void;
  onCheck: (guest: Guest) => void;
  onClear: () => void;
}) {
  const canCheck = role === "door" || role === "admin" || role === "super";
  return (
    <section
      className="roster"
      aria-label={role === "guest" ? "내 게스트 명단" : "전체 게스트 명단"}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">GUEST LIST</span>
          <h2>
            {role === "guest" ? "내 게스트" : "전체 게스트"}{" "}
            <span className="count">{total}</span>
          </h2>
        </div>
        <span className="quiet">이름순 · {guests.length}명 표시</span>
      </div>
      <div className="roster-columns" aria-hidden="true">
        <span>이름 / 등록 담당자</span>
        <span>등록 경로</span>
        <span>입장 상태</span>
      </div>
      <ul className="guest-list">
        {guests.map((guest) => (
          <li key={guest.id} className={guest.checked ? "is-checked" : ""}>
            <button
              className="guest-person"
              onClick={() => onDetail(guest)}
              aria-label={`${guest.name} 상세`}
            >
              <span className="avatar">{guest.name.slice(0, 1)}</span>
              <span>
                <strong>{guest.name}</strong>
                <small>
                  {guest.owner}
                  <span className="mobile-source"> · {guest.source}</span>
                </small>
              </span>
            </button>
            <span className="source-label">{guest.source}</span>
            {canCheck ? (
              <button
                className={`check-button ${guest.checked ? "checked" : ""}`}
                aria-label={`${guest.name} ${guest.checked ? "입장 취소 확인" : "입장 처리"}`}
                onClick={() => onCheck(guest)}
              >
                <Icon name={guest.checked ? "check" : "plus"} size={15} />
                <span>{guest.checked ? "입장 완료" : "입장"}</span>
              </button>
            ) : (
              <span className={`status-badge ${guest.checked ? "green" : ""}`}>
                {guest.checked ? "입장 완료" : "입장 전"}
              </span>
            )}
          </li>
        ))}
      </ul>
      {guests.length === 0 ? (
        <div className="empty-state">
          <Icon name="search" size={30} />
          <h3>
            {total ? "일치하는 게스트가 없어요" : "아직 등록된 게스트가 없어요"}
          </h3>
          <p>
            {total
              ? "이름이나 등록 담당자를 다시 확인해 주세요."
              : "하단의 등록 버튼에서 첫 게스트를 추가해 보세요."}
          </p>
          {total > 0 && (
            <button className="secondary" onClick={onClear}>
              검색·필터 초기화
            </button>
          )}
        </div>
      ) : (
        <p className="list-end">{guests.length}명의 명단을 모두 확인했어요</p>
      )}
    </section>
  );
}

export function AddGuestForm({
  mine,
  remaining,
  onAdd,
}: {
  mine: boolean;
  remaining: number;
  onAdd: (names: string[], owner: string) => string | null;
}) {
  const [bulk, setBulk] = useState(false);
  const [value, setValue] = useState("");
  const [owner, setOwner] = useState("SORA");
  const [error, setError] = useState<string | null>(null);
  const count = value.split("\n").filter((name) => name.trim()).length;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const names = value
          .split("\n")
          .map((name) => name.trim())
          .filter(Boolean);
        if (!names.length) {
          setError("게스트 이름을 입력해 주세요.");
          return;
        }
        setError(onAdd(names, owner));
      }}
    >
      <div className="segmented" aria-label="등록 방식">
        <button
          type="button"
          aria-pressed={!bulk}
          onClick={() => {
            setBulk(false);
            setValue("");
            setError(null);
          }}
        >
          한 명 등록
        </button>
        <button
          type="button"
          aria-pressed={bulk}
          onClick={() => {
            setBulk(true);
            setValue("");
            setError(null);
          }}
        >
          여러 명 등록
        </button>
      </div>
      {!mine && (
        <label className="field">
          <span>등록 담당자</span>
          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option>SORA</option>
            <option>MILO</option>
            <option>운영팀</option>
          </select>
        </label>
      )}
      <label className="field">
        <span>{bulk ? "게스트 이름 · 한 줄에 한 명" : "게스트 이름"}</span>
        {bulk ? (
          <textarea
            autoFocus
            required
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder={"김서윤\nAlex Morgan\n이도현"}
            aria-describedby={error ? "add-error" : undefined}
          />
        ) : (
          <input
            autoFocus
            required
            maxLength={80}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder="입장할 때 확인할 이름"
            aria-describedby={error ? "add-error" : undefined}
          />
        )}
      </label>
      <div className="quota-line">
        <span>{mine ? "SORA의 남은 등록 한도" : "등록 인원"}</span>
        <strong>{mine ? `${remaining}명` : `${count}명`}</strong>
      </div>
      {error && (
        <p id="add-error" role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="primary" disabled={mine && remaining <= 0}>
        {count > 1 ? `${count}명 등록하기` : "게스트 등록하기"}
        <Icon name="arrow" size={18} />
      </button>
    </form>
  );
}

export function RequestForm({
  onRequest,
}: {
  onRequest: (count: number, reason: string) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onRequest(Number(data.get("count")), String(data.get("reason")).trim());
      }}
    >
      <label className="field">
        <span>추가로 필요한 인원</span>
        <input
          name="count"
          type="number"
          min="1"
          max="100"
          defaultValue="3"
          required
          autoFocus
        />
      </label>
      <label className="field">
        <span>요청 사유</span>
        <textarea
          name="reason"
          required
          maxLength={200}
          placeholder="관리자가 확인할 내용을 적어 주세요."
        />
      </label>
      <p className="form-note">
        관리자가 승인하면 등록할 수 있는 인원이 늘어나요.
      </p>
      <button className="primary">
        추가 인원 요청하기
        <Icon name="arrow" size={18} />
      </button>
    </form>
  );
}
