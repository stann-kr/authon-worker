import { useState } from "react";
import { useMock } from "../data/MockData";
import { Sheet } from "../shared/Sheet";
import { Area, Field, Form, Notice, Select } from "../shared/ui";
import { bookingError, conflictsFor, saveBooking } from "./domain";
import { bookingStatuses, type Booking } from "./types";
import { timeLabel } from "./ui";

export function BookingEditor({
  booking,
  onClose,
  onSaved,
}: {
  booking: Booking;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { data, user, venue, mutate, t } = useMock();
  const [draft, setDraft] = useState(() => structuredClone(booking));
  const [error, setError] = useState("");
  const exists = data.planning.bookings.some((b) => b.id === booking.id);
  const artists = data.planning.artists.filter((a) => a.scopeId === venue.id);
  const events = data.events.filter(
    (e) =>
      e.venueId === venue.id &&
      !e.general &&
      ["draft", "open"].includes(e.state),
  );
  const artist = artists.find((a) => a.id === draft.artistId);
  const conflicts = conflictsFor(draft, data.planning.bookings);
  const update = <K extends keyof Booking>(key: K, value: Booking[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const material = (key: keyof Booking["materials"], value: string) =>
    setDraft((d) => ({ ...d, materials: { ...d.materials, [key]: value } }));
  return (
    <Sheet
      title={t(exists ? "부킹 수정" : "새 부킹")}
      subtitle={artist?.name}
      protectEdits
      dirty={JSON.stringify(draft) !== JSON.stringify(booking)}
      onClose={onClose}
    >
      <Form
        submit="부킹 저장"
        onSubmit={async () => {
          const issue = !draft.artistId
            ? "아티스트를 선택해주세요."
            : !draft.eventId
              ? "행사를 선택해주세요."
              : bookingError(draft);
          setError(issue);
          if (issue) return;
          if (
            await mutate(
              (d) => saveBooking(d, draft, user.id),
              "부킹을 저장했습니다.",
            )
          )
            onSaved(draft.id);
        }}
      >
        <Select
          label="아티스트"
          name="artistId"
          value={draft.artistId}
          disabled={exists}
          required
          onChange={(e) => {
            const a = artists.find((a) => a.id === e.target.value);
            setDraft((d) => ({
              ...d,
              artistId: e.target.value,
              materials: {
                ...d.materials,
                pressUrl: a?.pressUrl ?? "",
                riderUrl: a?.riderUrl ?? "",
              },
            }));
          }}
        >
          <option value="">{t("아티스트 선택")}</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          label="행사"
          name="eventId"
          value={draft.eventId}
          disabled={exists}
          required
          onChange={(e) => update("eventId", e.target.value)}
        >
          <option value="">{t("행사 선택")}</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.date} · {e.name}
            </option>
          ))}
        </Select>
        <div className="form-duo">
          <Field
            label="부킹 담당자"
            value={draft.owner}
            onChange={(e) => update("owner", e.target.value)}
            maxLength={80}
          />
          <Select
            label="진행 상태"
            value={draft.status}
            disabled={["confirmed", "completed", "cancelled"].includes(
              draft.status,
            )}
            onChange={(e) =>
              update("status", e.target.value as Booking["status"])
            }
          >
            {Object.entries(bookingStatuses)
              .filter(([key]) =>
                ["inquiry", "negotiating", "hold", draft.status].includes(key),
              )
              .map(([key, label]) => (
                <option value={key} key={key}>
                  {t(label)}
                </option>
              ))}
          </Select>
        </div>
        <Field
          label="다음 할 일"
          value={draft.nextAction}
          onChange={(e) => update("nextAction", e.target.value)}
          placeholder="가능한 시간 확인, 기술자료 요청 등"
          maxLength={160}
        />
        <Field
          label="후속 업무 기한"
          type="date"
          value={draft.due}
          onChange={(e) => update("due", e.target.value)}
        />
        <h3 className="planning-form-title">{t("출연 일정")}</h3>
        <p className="planning-hint">
          {t(
            "모든 시간은 한국 시간입니다. 자정 이후에는 다음 날짜를 선택하세요.",
          )}
        </p>
        <Field
          label="출연 시작"
          type="datetime-local"
          value={draft.start}
          onChange={(e) => update("start", e.target.value)}
          error={error.includes("일시") ? error : undefined}
        />
        <Field
          label="출연 종료"
          type="datetime-local"
          value={draft.end}
          onChange={(e) => update("end", e.target.value)}
        />
        <Field
          label="장소·무대"
          value={draft.stage}
          onChange={(e) => update("stage", e.target.value)}
          placeholder="Main, Hall A 등"
          maxLength={100}
        />
        <Select
          label="상대 일정 가능 여부"
          value={draft.availability}
          onChange={(e) =>
            update("availability", e.target.value as Booking["availability"])
          }
        >
          <option value="unknown">{t("미확인")}</option>
          <option value="available">{t("가능 확인")}</option>
          <option value="unavailable">{t("불가")}</option>
        </Select>
        <Field
          label="홀드 기한"
          type="datetime-local"
          value={draft.holdUntil}
          onChange={(e) => update("holdUntil", e.target.value)}
        />
        {conflicts.length > 0 && (
          <div className="planning-warning" role="status">
            <strong>{t("겹치는 일정이 있습니다")}</strong>
            {conflicts.map((b) => (
              <p key={b.id}>
                {data.planning.artists.find((a) => a.id === b.artistId)?.name} ·{" "}
                {b.stage} · {timeLabel(b.start)}–{timeLabel(b.end)} ·{" "}
                {t(bookingStatuses[b.status])}
              </p>
            ))}
            <small>
              {t(
                "가안은 저장할 수 있습니다. 확정 일정과 겹치면 시간을 조정한 뒤 확정하세요.",
              )}
            </small>
          </div>
        )}
        <details
          className="flow-details"
          open={!!(draft.arrival || draft.soundcheck)}
        >
          <summary>{t("도착·사운드체크")}</summary>
          <Field
            label="도착 일시"
            type="datetime-local"
            value={draft.arrival}
            onChange={(e) => update("arrival", e.target.value)}
          />
          <Field
            label="사운드체크 일시"
            type="datetime-local"
            value={draft.soundcheck}
            onChange={(e) => update("soundcheck", e.target.value)}
          />
        </details>
        <details className="flow-details">
          <summary>{t("이 행사에 사용할 자료")}</summary>
          <Field
            label="소개·프레스 자료 URL"
            type="url"
            value={draft.materials.pressUrl}
            onChange={(e) => material("pressUrl", e.target.value)}
          />
          <Field
            label="기술자료 URL"
            type="url"
            value={draft.materials.riderUrl}
            onChange={(e) => material("riderUrl", e.target.value)}
          />
          <Area
            label="기술·준비 요청사항"
            value={draft.materials.requirements}
            onChange={(e) => material("requirements", e.target.value)}
            maxLength={2000}
          />
          {artist && (
            <button
              className="secondary"
              type="button"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  materials: {
                    ...d.materials,
                    pressUrl: artist.pressUrl,
                    riderUrl: artist.riderUrl,
                  },
                }))
              }
            >
              {t("아티스트 기본 자료 가져오기")}
            </button>
          )}
        </details>
        <Area
          label="팀 내부 메모"
          value={draft.notes}
          onChange={(e) => update("notes", e.target.value)}
          maxLength={2000}
        />
        {draft.status === "confirmed" && (
          <p className="planning-hint">
            {t("확정된 시간·장소·자료가 바뀌면 상대의 확인이 다시 필요합니다.")}
          </p>
        )}
        {error && <Notice error>{error}</Notice>}
      </Form>
    </Sheet>
  );
}
