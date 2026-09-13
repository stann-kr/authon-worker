import { useState } from "react";
import { useMock } from "../data/MockData";
import { Sheet } from "../shared/Sheet";
import { Action, Confirm, Field, Form, Notice } from "../shared/ui";
import type { BookingStatus } from "./types";
import { bookingStatuses } from "./types";
import {
  activeBooking,
  conflictsFor,
  connectGuestLink,
  holdExpired,
  guestImpact,
  respondToBooking,
  reviewMaterials,
  timeValue,
  transitionBooking,
} from "./domain";
import { MOCK_NOW } from "../data/types";
import { BookingEditor } from "./BookingEditor";
import { ArtistReview } from "./ArtistReview";
import { BookingCancellation } from "./BookingCancellation";
import { BookingPipeline } from "./BookingPipeline";
import { MaterialLink, Status, timeLabel } from "./ui";

export function BookingSheet({
  bookingId,
  onClose,
}: {
  bookingId: string;
  onClose: () => void;
}) {
  const { data, venue, user, mutate, chooseEvent, navigate, t, notice, setIntent } =
    useMock();
  const [mode, setMode] = useState<"detail" | "edit" | "review" | "guest" | "cancel" | "materials">(
    "detail",
  );
  const [confirm, setConfirm] = useState<BookingStatus | null>(null);
  const b = data.planning.bookings.find(
    (b) => b.id === bookingId && b.scopeId === venue.id,
  );
  const artist = data.planning.artists.find(
    (a) => a.id === b?.artistId && a.scopeId === venue.id,
  );
  const event = data.events.find(
    (e) => e.id === b?.eventId && e.venueId === venue.id,
  );
  if (!b || !artist || !event) return null;
  const back = () => setMode("detail");
  const conflicts = conflictsFor(b, data.planning.bookings);
  const { link, registered, checked } = guestImpact(data, b);
  const go = (view: "preparation" | "links" | "roster") => {
    chooseEvent(b.eventId);
    if (view === "links" && link) setIntent(`link-open:${link.id}`);
    navigate(view);
    onClose();
  };
  if (mode === "edit")
    return <BookingEditor booking={b} onClose={back} onSaved={back} />;
  if (mode === "review")
    return (
      <ArtistReview
        info={{
          artistName: artist.name,
          eventName: event.name,
          start: b.start,
          end: b.end,
          arrival: b.arrival,
          soundcheck: b.soundcheck,
          stage: b.stage,
          materials: { ...b.materials },
          revision: b.revision,
          availability: b.availability,
          status: b.status,
        }}
        onClose={back}
        onRespond={async (availability, acknowledged, riderUrl) => {
          if (await mutate((d) => respondToBooking(d, b.id, venue.id, user.id,
            b.revision, availability, acknowledged, riderUrl), "아티스트 응답을 반영했습니다.")) back();
        }}
      />
    );
  if (mode === "cancel") return <BookingCancellation booking={b} onClose={back} />;
  if (mode === "materials") return <Sheet title={t("행사 자료 운영팀 검토")} subtitle={artist.name} onClose={back}>
    <div className="planning-detail">
      <MaterialLink label="소개·프레스 자료" value={b.materials.pressUrl} />
      <MaterialLink label="기술자료" value={b.materials.riderUrl} />
      {b.materials.requirements && <p className="planning-copy">{b.materials.requirements}</p>}
      <Notice>자료 내용과 현장 준비 가능 여부를 확인한 뒤 완료로 기록하세요.</Notice>
      <Action disabled={!b.materials.pressUrl || !b.materials.riderUrl} onClick={async () => {
        if (await mutate((d) => reviewMaterials(d, b.id, venue.id, user.id, b.revision), "행사 자료 검토를 기록했습니다.")) back();
      }}>운영팀 검토 완료</Action>
      {notice && <Notice>{notice}</Notice>}
    </div>
  </Sheet>;
  if (mode === "guest")
    return (
      <Sheet
        title={t("게스트 링크 준비")}
        subtitle={`${artist.name} · ${event.name}`}
        protectEdits
        onClose={back}
      >
        <Form
          submit="비활성 링크 만들기"
          onSubmit={async (form) => {
            if (
              await mutate(
                (d) =>
                  connectGuestLink(
                    d,
                    b.id,
                    venue.id,
                    user.id,
                    Number(form.get("limit")),
                  ),
                "게스트 링크를 준비했습니다. 링크 관리에서 확인 후 활성화하세요.",
              )
            )
              back();
          }}
        >
          <Field
            label="게스트 한도"
            name="limit"
            type="number"
            min={0}
            max={500}
            step={1}
            defaultValue={10}
            required
          />
        </Form>
      </Sheet>
    );
  return (
    <Sheet title={artist.name} subtitle={event.name} onClose={onClose}>
      <div className="planning-detail">
        <div className="planning-card-top">
          <Status booking={b} />
          <span className="planning-eyebrow">
            {t("일정 버전 {version}", { version: b.revision })}
          </span>
        </div>
        <div className="planning-slot">
          <strong>{timeLabel(b.start)}</strong>
          <span>→ {timeLabel(b.end)}</span>
          <small>{b.stage || t("무대 미정")} · KST</small>
        </div>
        <BookingPipeline booking={b} onAction={(action) => {
          if (action === "preparation" || action === "links") go(action);
          else setMode(action);
        }} />
        {holdExpired(b) && (
          <Notice error>
            홀드 기한이 지났습니다. 상대에게 일정을 다시 확인하세요.
          </Notice>
        )}
        {conflicts.length > 0 && (
          <div className="planning-warning">
            <strong>
              {t("겹치는 일정 {count}건", { count: conflicts.length })}
            </strong>
            {conflicts.map((other) => (
              <p key={other.id}>
                {
                  data.planning.artists.find((a) => a.id === other.artistId)
                    ?.name
                }{" "}
                · {timeLabel(other.start)} · {t(bookingStatuses[other.status])}
              </p>
            ))}
          </div>
        )}
        <dl className="planning-facts">
          <div>
            <dt>{t("부킹 담당자")}</dt>
            <dd>{b.owner || "—"}</dd>
          </div>
          <div>
            <dt>{t("상대 일정")}</dt>
            <dd>
              {t(
                b.availability === "available"
                  ? "가능 확인"
                  : b.availability === "unavailable"
                    ? "조정 필요"
                    : "미확인",
              )}
            </dd>
          </div>
          <div>
            <dt>{t("도착")}</dt>
            <dd>{timeLabel(b.arrival)}</dd>
          </div>
          <div>
            <dt>{t("사운드체크")}</dt>
            <dd>{timeLabel(b.soundcheck)}</dd>
          </div>
          {b.holdUntil && (
            <div>
              <dt>{t("홀드 기한")}</dt>
              <dd>{timeLabel(b.holdUntil)}</dd>
            </div>
          )}
        </dl>
        {(b.changeoverMinutes > 0 || b.travelMinutes > 0) && <p className="planning-hint">
          {t("출연 후 교체 {changeover}분 · 다음 행사 이동 {travel}분", { changeover: b.changeoverMinutes, travel: b.travelMinutes })}
        </p>}
        {b.cancellation && <section>
          <h3>{t("취소 사유")}</h3><p className="planning-copy">{b.cancellation.reason}</p>
          <p className="planning-hint">{t(b.cancellation.linkAction === "pause" ? "취소 시 추가 등록 중지" : "취소 시 링크 상태 유지")}</p>
        </section>}
        {activeBooking(b) && b.nextAction && (
          <div className="planning-next">
            <span>{t("다음 할 일")}</span>
            <strong>{b.nextAction}</strong>
            <small>
              {b.due || t("기한 미정")} · {b.owner || t("담당자 미정")}
            </small>
          </div>
        )}
        {activeBooking(b) && (
          <div className="button-row">
            <Action onClick={() => setMode("edit")}>부킹 수정</Action>
            <Action secondary onClick={() => setMode("review")}>
              아티스트 화면 미리보기
            </Action>
          </div>
        )}
        {b.status === "confirmed" && (
          <Notice>
            {b.acknowledgedRevision === b.revision
              ? "최신 일정 확인 완료"
              : "최신 일정 확인 대기"}
          </Notice>
        )}
        <section>
          <h3>{t("이 행사에 사용할 자료")}</h3>
          <div className="planning-materials">
            <MaterialLink
              label="소개·프레스 자료"
              value={b.materials.pressUrl}
            />
            <MaterialLink label="기술자료" value={b.materials.riderUrl} />
          </div>
          {b.materials.requirements && (
            <p className="planning-copy">{b.materials.requirements}</p>
          )}
        </section>
        {activeBooking(b) && <div className="button-row">
          <span className="planning-hint">{t(b.materialsReviewedRevision === b.revision ? "운영팀 자료 검토 완료" : "운영팀 자료 검토 대기")}</span>
          {b.materialsReviewedRevision !== b.revision && <Action secondary onClick={() => setMode("materials")}>자료 검토</Action>}
        </div>}
        {b.notes && (
          <section>
            <h3>{t("팀 내부 메모")}</h3>
            <p className="planning-copy">{b.notes}</p>
          </section>
        )}
        <div className="button-row">
          <Action secondary onClick={() => go("preparation")}>
            행사 준비 열기
          </Action>
          {(b.status === "confirmed" || link) && (
            <Action
              secondary
              onClick={() => (link ? go("links") : setMode("guest"))}
            >
              {link ? "연결된 게스트 링크" : "게스트 링크 준비"}
            </Action>
          )}
        </div>
        {link && (
          <p className="planning-hint">
            {t(link.active ? "게스트 링크 활성" : "게스트 링크 비활성")} ·{" "}
            {t("한도 {count}명", { count: link.limit })}
          </p>
        )}
        {link && <p className="planning-hint">{t("등록 {registered}명 · 입장 {checked}명", { registered, checked })}</p>}
        {!["cancelled", "completed"].includes(b.status) && (
          <div className="button-row">
            {b.status !== "confirmed" ? (
              <Action onClick={() => setConfirm("confirmed")}>부킹 확정</Action>
            ) : (
              timeValue(b.end) <= Date.parse(MOCK_NOW) && (
                <Action onClick={() => setConfirm("completed")}>
                  출연 완료
                </Action>
              )
            )}
            <Action secondary onClick={() => setMode("cancel")}>
              부킹 취소
            </Action>
          </div>
        )}
        {confirm && (
          <Confirm
            title={t(
              confirm === "confirmed"
                ? "이 일정으로 부킹을 확정할까요?"
                : "출연을 완료로 기록할까요?",
            )}
            description={t(
              confirm === "confirmed"
                ? "상대와 합의한 일시·무대를 확인하세요. 확정해도 외부 메시지나 게스트 링크가 자동 발송되지 않습니다."
                : "출연 이력에 완료로 남깁니다.",
            )}
            onCancel={() => setConfirm(null)}
            onConfirm={async () => {
              if (
                await mutate(
                  (d) =>
                    transitionBooking(
                      d,
                      b.id,
                      venue.id,
                      user.id,
                      b.revision,
                      confirm,
                    ),
                  "부킹 상태를 변경했습니다.",
                )
              )
                setConfirm(null);
            }}
          />
        )}
        {notice && <Notice>{notice}</Notice>}
        <details className="flow-details">
          <summary>{t("변경 이력")}</summary>
          <ol className="planning-history">
            {b.history.map((h) => (
              <li key={h.id}>
                <strong>{t(h.message)}</strong>
                <span>
                  {data.users.find((u) => u.id === h.actor)?.name ?? h.actor} ·{" "}
                  {h.at.slice(0, 16).replace("T", " ")}
                </span>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </Sheet>
  );
}
