import { useState } from "react";
import { Icon } from "../shared/Icon";
import { Sheet } from "../shared/Sheet";
import { AddGuestForm } from "../guests/GuestWorkspace";
import "./registration.css";

export function ExternalRegistration() {
  const [kind, setKind] = useState<"self" | "contributor">("self");
  const [names, setNames] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  return (
    <div className="external-preview">
      <div className="external-scenario">
        <span className="eyebrow">링크 종류 미리보기</span>
        <div className="segmented">
          <button
            aria-pressed={kind === "self"}
            onClick={() => {
              setKind("self");
              setNames([]);
            }}
          >
            본인 등록
          </button>
          <button
            aria-pressed={kind === "contributor"}
            onClick={() => {
              setKind("contributor");
              setNames([]);
            }}
          >
            담당자 등록
          </button>
        </div>
      </div>
      <main className="invitation">
        <span className="invitation-wordmark">FAUST</span>
        <div className="invitation-line" />
        <span className="eyebrow">YOU’RE ON THE LIST</span>
        <h1>
          {names.length && kind === "self" ? (
            "명단에서 만나요."
          ) : kind === "self" ? (
            <>
              토요일 밤,
              <br />
              함께해요.
            </>
          ) : (
            <>
              SORA의
              <br />
              게스트 명단.
            </>
          )}
        </h1>
        <p className="invitation-event">Saturday at FAUST</p>
        <p className="quiet">2026.09.12 SAT · 23:00 — 07:00</p>
        {names.length ? (
          <div className="invitation-result">
            <Icon name="check" />
            <div>
              <strong>
                {kind === "self"
                  ? `${names[0]}님, 등록되었어요`
                  : `${names.length}명 등록 완료`}
              </strong>
              <p>
                {kind === "self"
                  ? "입장할 때 이름 또는 아래 코드를 보여 주세요."
                  : names.join(" · ")}
              </p>
            </div>
            {kind === "self" && (
              <div className="admission-code">
                <span>입장 코드 · 목업</span>
                <strong>DEMO01</strong>
              </div>
            )}
          </div>
        ) : (
          <div className="invitation-details">
            <div>
              <span>초대</span>
              <strong>SORA</strong>
            </div>
            <div>
              <span>{kind === "self" ? "등록 대상" : "등록 가능"}</span>
              <strong>{kind === "self" ? "본인 1명" : "10명"}</strong>
            </div>
            <div>
              <span>등록 마감</span>
              <strong>9월 13일 02:00</strong>
            </div>
          </div>
        )}
      </main>
      <footer className="invitation-footer">
        {kind === "self" && names.length ? (
          <span className="status-badge green">
            <Icon name="check" size={16} />
            등록 완료
          </span>
        ) : (
          <button
            className="primary"
            disabled={names.length >= 10}
            onClick={() => setOpen(true)}
          >
            {kind === "self" ? "내 이름 등록하기" : "게스트 등록하기"}
            <Icon name="arrow" />
          </button>
        )}
        <span>AUTHON · GUEST ACCESS</span>
      </footer>
      {open && (
        <Sheet
          title={kind === "self" ? "내 이름 등록" : "게스트 등록"}
          subtitle="Saturday at FAUST · SORA의 초대"
          onClose={() => setOpen(false)}
        >
          {kind === "self" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const name = String(
                  new FormData(event.currentTarget).get("name"),
                ).trim();
                if (!name) return;
                setNames([name]);
                setOpen(false);
              }}
            >
              <label className="field">
                <span>입장할 때 확인할 이름</span>
                <input
                  name="name"
                  required
                  maxLength={80}
                  autoFocus
                  placeholder="이름을 입력해 주세요"
                />
              </label>
              <p className="form-note">본인 이름으로 한 번만 등록해 주세요.</p>
              <button className="primary">
                등록 완료하기
                <Icon name="check" />
              </button>
            </form>
          ) : (
            <AddGuestForm
              mine
              remaining={10 - names.length}
              onAdd={(added) => {
                if (names.length + added.length > 10)
                  return "등록 가능한 인원을 초과했어요.";
                if (
                  added.some((name) => names.includes(name)) ||
                  new Set(added).size !== added.length
                )
                  return "같은 이름이 있어요. 명단을 다시 확인해 주세요.";
                setNames((current) => [...current, ...added]);
                setOpen(false);
                return null;
              }}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}
