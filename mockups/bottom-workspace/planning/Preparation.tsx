import { useState } from "react";
import { useMock, useIntent } from "../data/MockData";
import { MOCK_NOW } from "../data/types";
import { Sheet } from "../shared/Sheet";
import {
  Action,
  Empty,
  Field,
  Form,
  Notice,
  Select,
  string,
} from "../shared/ui";
import { activeBooking, addHistory, assertScope } from "./domain";
import { MaterialLink, PlanningTabs, Status, timeLabel } from "./ui";
import { BookingSheet } from "./BookingSheet";
import { bookingIssues } from "./pipeline";

export function Preparation() {
  const { data, venue, event, user, chooseEvent, mutate, navigate, busy, t } =
    useMock();
  const [selected, setSelected] = useState<string | null>(null);
  const [taskFor, setTaskFor] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const bookings = data.planning.bookings
    .filter(
      (b) =>
        b.scopeId === venue.id && b.eventId === event.id && activeBooking(b),
    )
    .sort((a, b) => (a.start || "z").localeCompare(b.start || "z"));
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const missing = confirmed.filter(
    (b) =>
      !b.materials.pressUrl ||
      !b.materials.riderUrl ||
      b.acknowledgedRevision !== b.revision ||
      b.materialsReviewedRevision !== b.revision,
  );
  const tasks = bookings.flatMap((b) =>
    b.tasks.map((task) => ({ booking: b, task })),
  );
  const editingTask = tasks.find(({ task }) => task.id === editingTaskId)?.task;
  const beginTask = () => {
    setEditingTaskId(null);
    setTaskFor(bookings[0]?.id ?? "");
  };
  const closeTask = () => {
    setTaskFor(null);
    setEditingTaskId(null);
  };
  useIntent("preparation-add", beginTask);
  const toggle = async (bookingId: string, taskId: string, done: boolean) => {
    await mutate(
      (d) => {
        assertScope(d, venue.id, user.id);
        const b = d.planning.bookings.find(
          (b) =>
            b.id === bookingId &&
            b.scopeId === venue.id &&
            b.eventId === event.id &&
            activeBooking(b),
        );
        const task = b?.tasks.find((task) => task.id === taskId);
        if (!b || !task)
          throw Error("준비 업무가 변경되었습니다. 다시 확인해주세요.");
        task.done = done;
        addHistory(
          b,
          user.id,
          `${done ? "준비 완료" : "준비 다시 열기"} · ${task.title}`,
        );
      },
      done ? "준비 완료로 기록했습니다." : "준비 업무를 다시 열었습니다.",
    );
  };
  return (
    <div className="flow-section planning-section">
      <PlanningTabs />
      <Select
        label="준비할 행사"
        value={event.id}
        onChange={(e) => chooseEvent(e.target.value)}
      >
        {data.events
          .filter((e) => e.venueId === venue.id && !e.general)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.date} · {e.name}
            </option>
          ))}
      </Select>
      <div className="planning-prep-summary">
        <span>{t("확정 출연 {count}팀", { count: confirmed.length })}</span>
        <span>
          {t("남은 업무 {count}건", {
            count: tasks.filter(({ task }) => !task.done).length,
          })}
        </span>
        <span>{t("자료·확인 필요 {count}팀", { count: missing.length })}</span>
      </div>
      <section>
        <div className="planning-card-top">
          <h2 className="planning-section-title">{t("행사 출연표")}</h2>
          <small>KST · {event.date}</small>
        </div>
        {bookings.map((b) => (
          <button
            className="planning-history-link"
            key={b.id}
            onClick={() => setSelected(b.id)}
          >
            <span>
              <strong>
                {data.planning.artists.find((a) => a.id === b.artistId)?.name}
              </strong>
              <small>
                {timeLabel(b.start)} → {timeLabel(b.end)} ·{" "}
                {b.stage || t("무대 미정")}
              </small>
              <small>
                {t("도착")} {timeLabel(b.arrival)} · {t("사운드체크")}{" "}
                {timeLabel(b.soundcheck)}
              </small>
              {bookingIssues(data, b).length > 0 && (
                <small>{t("확인 {count}건", { count: bookingIssues(data, b).length })}</small>
              )}
            </span>
            <Status booking={b} />
          </button>
        ))}
        {!bookings.length && <Empty text="이 행사에 연결된 부킹이 없습니다." />}
      </section>
      <section>
        <div className="planning-card-top">
          <h2 className="planning-section-title">{t("준비 체크리스트")}</h2>
          <Action secondary onClick={beginTask}>
            업무 추가
          </Action>
        </div>
        <label className="planning-inline-check">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
          />
          {t("미완료만 보기")}
        </label>
        {tasks
          .filter(({ task }) => !onlyPending || !task.done)
          .sort((a, b) => (a.task.due || "z").localeCompare(b.task.due || "z"))
          .map(({ booking, task }) => (
            <div
              className={`planning-task ${task.done ? "done" : ""}`}
              key={task.id}
            >
              <label>
                <input
                  type="checkbox"
                  checked={task.done}
                  disabled={busy}
                  onChange={(e) =>
                    void toggle(booking.id, task.id, e.target.checked)
                  }
                />
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {
                      data.planning.artists.find(
                        (a) => a.id === booking.artistId,
                      )?.name
                    }{" "}
                    · {task.owner || t("담당자 미정")}
                  </small>
                </span>
              </label>
              <span
                className={
                  task.due && !task.done && task.due < MOCK_NOW.slice(0, 10)
                    ? "planning-flag"
                    : "planning-hint"
                }
              >
                {task.due || t("기한 미정")}
                {task.due &&
                  !task.done &&
                  task.due < MOCK_NOW.slice(0, 10) &&
                  ` · ${t("기한 지남")}`}
              </span>
              <button
                className="planning-text-action"
                aria-label={t("업무 수정 · {title}", { title: task.title })}
                onClick={() => {
                  setEditingTaskId(task.id);
                  setTaskFor(booking.id);
                }}
              >
                {t("업무 수정")}
              </button>
            </div>
          ))}
        {!tasks.some(({ task }) => !onlyPending || !task.done) && (
          <Empty
            text={
              onlyPending
                ? "남은 준비 업무가 없습니다."
                : "준비 업무를 추가해보세요."
            }
          />
        )}
      </section>
      <section>
        <h2 className="planning-section-title">{t("출연 자료와 일정 확인")}</h2>
        {confirmed.map((b) => (
          <div className="planning-prep-material" key={b.id}>
            <div className="planning-card-top">
              <strong>
                {data.planning.artists.find((a) => a.id === b.artistId)?.name}
              </strong>
              <button
                className="planning-text-action"
                onClick={() => setSelected(b.id)}
              >
                {t("부킹 열기")}
              </button>
            </div>
            <div className="planning-materials">
              <MaterialLink
                label="소개·프레스 자료"
                value={b.materials.pressUrl}
              />
              <MaterialLink label="기술자료" value={b.materials.riderUrl} />
            </div>
            <p
              className={
                b.acknowledgedRevision === b.revision
                  ? "planning-hint"
                  : "planning-flag"
              }
            >
              {t(
                b.acknowledgedRevision === b.revision
                  ? "최신 일정 확인 완료"
                  : "상대 확인 대기",
              )}
            </p>
            <p className="planning-hint">{t(b.materialsReviewedRevision === b.revision
              ? "운영팀 자료 검토 완료" : "운영팀 자료 검토 대기")}</p>
          </div>
        ))}
      </section>
      <div className="button-row">
        <Action onClick={() => navigate("bookings")}>부킹 관리</Action>
        <Action secondary onClick={() => navigate("roster")}>
          이 행사 게스트 명단
        </Action>
      </div>
      {selected && (
        <BookingSheet bookingId={selected} onClose={() => setSelected(null)} />
      )}
      {taskFor !== null && (
        <Sheet
          title={t(editingTask ? "준비 업무 수정" : "준비 업무 추가")}
          subtitle={event.name}
          protectEdits
          onClose={closeTask}
        >
          {!bookings.length ? (
            <>
              <Notice>부킹을 먼저 연결한 뒤 준비 업무를 추가하세요.</Notice>
              <Action onClick={() => navigate("bookings")}>부킹 관리</Action>
            </>
          ) : (
            <Form
              submit="업무 저장"
              onSubmit={async (form) => {
                if (
                  await mutate((d) => {
                    assertScope(d, venue.id, user.id);
                    const b = d.planning.bookings.find(
                      (b) =>
                        b.id === taskFor &&
                        b.scopeId === venue.id &&
                        b.eventId === event.id &&
                        activeBooking(b),
                    );
                    const title = string(form, "title");
                    if (!b || !title)
                      throw Error("아티스트와 업무 내용을 확인해주세요.");
                    const values = {
                      title,
                      owner: string(form, "owner"),
                      due: string(form, "due"),
                    };
                    if (editingTaskId) {
                      const task = b.tasks.find(
                        (task) => task.id === editingTaskId,
                      );
                      if (!task)
                        throw Error(
                          "준비 업무가 변경되었습니다. 다시 확인해주세요.",
                        );
                      Object.assign(task, values);
                    } else
                      b.tasks.push({
                        id: crypto.randomUUID(),
                        ...values,
                        done: false,
                      });
                    addHistory(
                      b,
                      user.id,
                      `${editingTaskId ? "준비 업무 수정" : "준비 업무 추가"} · ${title}`,
                    );
                  }, "준비 업무를 저장했습니다.")
                )
                  closeTask();
              }}
            >
              <Select
                label="연결할 아티스트"
                value={taskFor}
                disabled={!!editingTaskId}
                onChange={(e) => setTaskFor(e.target.value)}
                required
              >
                {bookings.map((b) => (
                  <option value={b.id} key={b.id}>
                    {
                      data.planning.artists.find((a) => a.id === b.artistId)
                        ?.name
                    }
                  </option>
                ))}
              </Select>
              <Field
                label="준비할 내용"
                name="title"
                defaultValue={editingTask?.title ?? ""}
                required
                maxLength={160}
                placeholder="사진 받기, 장비 확인 등"
              />
              <Field
                label="업무 담당자"
                name="owner"
                defaultValue={editingTask?.owner ?? user.name}
                maxLength={80}
              />
              <Field
                label="업무 기한"
                name="due"
                type="date"
                defaultValue={editingTask?.due ?? ""}
              />
            </Form>
          )}
        </Sheet>
      )}
    </div>
  );
}
