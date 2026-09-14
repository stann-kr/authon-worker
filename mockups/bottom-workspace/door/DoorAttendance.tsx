import { useState } from "react";
import {
  useMock,
  activeGuests,
  attendanceFor,
  id,
  useIntent,
} from "../data/MockData";
import { MOCK_DATE, type MockEvent, type MockState } from "../data/types";
import { assertCapability } from "../data/access";
import { performCheck } from "../guests/Roster";
import { Sheet } from "../shared/Sheet";
import {
  Action,
  Area,
  Confirm,
  Field,
  Form,
  Metrics,
  Notice,
  Row,
} from "../shared/ui";
export function applyWalkin(data: MockState, eventId: string, undo = false) {
  const state = (data.attendance[eventId] ??= attendanceFor(data, eventId));
  if (undo) {
    if (!state.undoIds.length) throw Error("되돌릴 워크인 입력이 없습니다.");
    state.undoIds.pop();
    state.walkIns--;
  } else {
    state.undoIds.push(id());
    state.walkIns++;
  }
}
export function canFinalizeAttendance(data: MockState, event: MockEvent, isAdmin: boolean) {
  return isAdmin &&
    (event.general || ["closed", "archived"].includes(event.state)) &&
    !attendanceFor(data, event.id).finalized &&
    !data.queue.some((q) => q.eventId === event.id && q.state === "queued");
}
export function DoorAttendance() {
  const {
    data,
    user,
    event,
    canDoor,
    isAdmin,
    scenario,
    writable,
    mutate,
    t,
    notice,
    navigate,
  } = useMock();
  const [reconcile, setReconcile] = useState(false),
    [target, setTarget] = useState(""),
    [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState<{
      checked: number;
      walkIns: number;
    } | null>(null);
  useIntent("attendance-closeout", () => {
    setTarget(String(total));
    setReason("");
    setConfirmation(null);
    setReconcile(true);
  });
  const attendance = attendanceFor(data, event.id);
  const checked = activeGuests(data, event.id).filter(
    (g) => g.status === "checked",
  ).length;
  const total = attendance.finalized
    ? (attendance.finalTotal ?? checked + attendance.walkIns)
    : checked + attendance.walkIns;
  const queued = data.queue.filter(
    (q) => q.eventId === event.id && q.state === "queued",
  );
  const results = data.queue.filter(
    (q) => q.eventId === event.id && q.state !== "queued",
  );
  const canRecord =
    canDoor && writable && event.date === MOCK_DATE && scenario !== "syncing";
  const hasUndo =
    attendance.undoIds.length +
      queued.filter((q) => q.kind === "walkin").length -
      queued.filter((q) => q.kind === "undo-walkin").length >
    0;
  const canFinalize = canFinalizeAttendance(data, event, isAdmin);
  const record = async (undo = false) => {
    if (!canRecord) return;
    await mutate(
      (d) => {
        assertCapability(d, user.id, "door", event.venueId);
        if (scenario === "offline")
          d.queue.push({
            id: id(),
            eventId: event.id,
            kind: undo ? "undo-walkin" : "walkin",
            state: "queued",
          });
        else applyWalkin(d, event.id, undo);
      },
      scenario === "offline"
        ? "이 기기에 저장했습니다. 동기화 전에는 확정되지 않습니다."
        : undo
          ? "마지막 워크인을 취소했습니다."
          : "워크인 1명을 추가했습니다.",
    );
  };
  useIntent("walkin-add", () => {
    void record();
  });
  useIntent("walkin-undo", () => {
    void record(true);
  });
  const sync = async () => {
    if (["offline", "syncing"].includes(scenario)) return;
    await mutate((d) => {
      assertCapability(d, user.id, "door", event.venueId);
      for (const q of d.queue.filter(
        (q) => q.eventId === event.id && q.state === "queued",
      )) {
        if (
          scenario === "scope-closed" ||
          attendanceFor(d, event.id).finalized ||
          d.events.find((e) => e.id === event.id)?.state !== "open"
        ) {
          q.state = "scope-closed";
          continue;
        }
        if (scenario === "conflict" || scenario === "rejected") {
          q.state = scenario;
          continue;
        }
        try {
          if (q.kind === "walkin" || q.kind === "undo-walkin")
            applyWalkin(d, q.eventId, q.kind === "undo-walkin");
          else {
            const g = d.guests.find(
              (g) => g.id === q.guestId && g.eventId === q.eventId,
            );
            if (!g || g.status === "deleted") {
              q.state = "rejected";
              continue;
            }
            performCheck(g, q.kind === "check");
          }
          q.state = "confirmed";
        } catch {
          q.state = "conflict";
        }
      }
    }, "동기화 결과를 확인해주세요.");
  };
  return (
    <div className="flow-section">
      <Metrics compact
        items={[
          { label: "누적 입장 (퇴장 미차감)", value: total },
          { label: "입장 게스트", value: checked },
          { label: "워크인", value: attendance.walkIns },
          { label: "동기화 대기", value: queued.length },
        ]}
      />
      {event.date !== MOCK_DATE && (
        <Notice>현재 영업일만 입력할 수 있습니다.</Notice>
      )}
      {attendance.finalized && (
        <Notice>마감되었습니다. 추가 입력과 변경은 차단됩니다.</Notice>
      )}
      {event.state !== "open" && !attendance.finalized && (
        <Notice>이 행사에는 입장을 기록할 수 없습니다.</Notice>
      )}
      <div className="button-row">
        <Action disabled={!canRecord} onClick={() => void record()}>
          워크인 입장
        </Action>
        <Action
          secondary
          disabled={!canRecord || !hasUndo}
          onClick={() => void record(true)}
        >
          마지막 워크인 취소
        </Action>
      </div>
      {(queued.length > 0 || results.length > 0 || ["offline", "syncing"].includes(scenario)) && <>
      <h2 className="flow-subheading">{t("이벤트 오프라인 운영")}</h2>
      {scenario === "offline" && (
        <Notice>저장된 명단 사용 중. 변경은 연결 후 반영됩니다.</Notice>
      )}
      {scenario === "syncing" && <Notice>오프라인 변경 동기화 중…</Notice>}
      {queued.map((q) => (
        <Row
          key={q.id}
          title={
            q.guestId
              ? (data.guests.find((g) => g.id === q.guestId)?.name ?? "게스트")
              : q.kind === "walkin"
                ? "워크인 +1"
                : "워크인 -1"
          }
          badge="동기화 대기"
        />
      ))}
      <Action
        secondary
        disabled={!queued.length || ["offline", "syncing"].includes(scenario)}
        onClick={() => void sync()}
      >
        동기화 재시도
      </Action>
      {results.map((q) => (
        <Row
          key={q.id}
          title={
            q.guestId
              ? (data.guests.find((g) => g.id === q.guestId)?.name ?? "게스트")
              : q.kind === "walkin"
                ? "워크인 +1"
                : "워크인 -1"
          }
          badge={
            q.state === "confirmed"
              ? "확정"
              : q.state === "conflict"
                ? "충돌"
                : q.state === "rejected"
                  ? "거부"
                  : "마감된 범위"
          }
        />
      ))}
      {!!results.length && (
        <>
          <Notice>
            {results.some((q) => q.state !== "confirmed")
              ? "반영되지 않은 작업은 최신 명단을 확인한 뒤 다시 처리해주세요."
              : "오프라인 변경을 반영했습니다."}
          </Notice>
          <Action
            secondary
            onClick={() =>
              void mutate((d) => {
                d.queue = d.queue.filter(
                  (q) => q.eventId !== event.id || q.state === "queued",
                );
              }, "결과를 지웠습니다.")
            }
          >
            결과 지우기
          </Action>
        </>
      )}
      </>}
      {isAdmin && (
        <>
          <h2 className="flow-subheading">{t("마감 합계 확정")}</h2>
          {!attendance.finalized &&
            !event.general &&
            !["closed", "archived"].includes(event.state) && (
              <Notice>행사를 먼저 종료하세요.</Notice>
            )}
          {queued.length > 0 && (
            <Notice>이 기기의 대기 입력을 먼저 동기화하세요.</Notice>
          )}
          <div className="button-row">
          <Action
            disabled={!canFinalize}
            onClick={() => {
              setTarget(String(total));
              setReason("");
              setConfirmation(null);
              setReconcile(true);
            }}
          >
            {attendance.finalized ? "마감됨" : "마감 검토"}
          </Action>
          <Action secondary onClick={() => navigate("events")}>
            행사 관리
          </Action>
          </div>
        </>
      )}
      {reconcile && (
        <Sheet
          title={t("마감 합계 확정")}
          subtitle={event.name}
          onClose={() => setReconcile(false)}
        >
          <Notice>모든 도어 기기 동기화 후 확정하세요.</Notice>
          {confirmation ? (
            <>
              <Metrics
                items={[
                  { label: "최종 누적 입장객", value: target },
                  {
                    label: "차이",
                    value: Number(target) - checked - attendance.walkIns,
                  },
                ]}
              />
              <Confirm
                title={t(
                  "총 {total}명으로 마감할까요? 마감 후에는 입장 기록을 바꿀 수 없습니다.",
                  { total: target },
                )}
                description={reason || "차이 없음. 이대로 마감합니다."}
                onCancel={() => setConfirmation(null)}
                disabled={!canFinalize}
                onConfirm={() =>
                  void mutate((d) => {
                    assertCapability(d, user.id, "admin", event.venueId);
                    const latestEvent = d.events.find((e) => e.id === event.id && e.venueId === event.venueId);
                    if (!latestEvent || !canFinalizeAttendance(d, latestEvent, true))
                      throw Error("이 작업을 수행할 권한이 없습니다.");
                    const actualChecked = activeGuests(d, event.id).filter(
                        (g) => g.status === "checked",
                      ).length,
                      actual = attendanceFor(d, event.id);
                    if (
                      actualChecked !== confirmation.checked ||
                      actual.walkIns !== confirmation.walkIns
                    )
                      throw Error(
                        "입장 집계가 변경되었습니다. 확인 후 다시 시도하세요.",
                      );
                    d.attendance[event.id] = {
                      walkIns: Number(target) - actualChecked,
                      undoIds: [],
                      finalized: true,
                      finalTotal: Number(target),
                      reason,
                    };
                  }, "마감되었습니다. 추가 입력과 변경은 차단됩니다.").then(
                    (ok) => {
                      if (ok) setReconcile(false);
                    },
                  )
                }
              />
              {notice && <Notice>{notice}</Notice>}
            </>
          ) : (
            <Form
              submit="마감 검토"
              disabled={!canFinalize}
              onSubmit={() => {
                const n = Number(target);
                if (
                  !Number.isInteger(n) ||
                  n < checked ||
                  Math.abs(n - checked - attendance.walkIns) > 500
                ) {
                  void mutate(() => {
                    throw Error(
                      n < checked
                        ? "입장 게스트보다 적을 수 없습니다."
                        : "한 번에 ±500명까지 반영할 수 있습니다.",
                    );
                  });
                  return;
                }
                setConfirmation({ checked, walkIns: attendance.walkIns });
              }}
            >
              <Field
                label="최종 누적 입장객"
                name="total"
                type="number"
                min={checked}
                step="1"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                required
              />
              <Area
                label="보정 사유"
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                maxLength={500}
              />
            </Form>
          )}
        </Sheet>
      )}
    </div>
  );
}
