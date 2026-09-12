import { useState } from "react";
import {
  useMock,
  activeGuests,
  attendanceFor,
  id,
  useIntent,
} from "../data/MockData";
import { MOCK_DATE, MOCK_NOW, type MockGuest } from "../data/types";
import { contributorName } from "../events/Reports";
import { Sheet } from "../shared/Sheet";
import { Icon } from "../shared/Icon";
import {
  Action,
  Confirm,
  Empty,
  Field,
  Form,
  Notice,
  Qr,
  Select,
  Toggle,
  string,
} from "../shared/ui";
import { GuestEntry } from "./GuestEntry";
export function performCheck(guest: MockGuest, checked: boolean) {
  guest.history ??= guest.checkedAt
    ? [{ kind: "check", at: guest.checkedAt }]
    : [];
  guest.history.push({ kind: checked ? "check" : "undo", at: MOCK_NOW });
  guest.status = checked ? "checked" : "pending";
  guest.checkedAt = checked ? MOCK_NOW : null;
  if (checked) guest.checkIns++;
  else guest.cancellations++;
}
export function Roster() {
  const {
    data,
    user,
    event,
    view,
    isAdmin,
    canDoor,
    canRegister,
    writable,
    scenario,
    mutate,
    t,
    notice,
    setScenario,
    operator,
  } = useMock();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [owner, setOwner] = useState("all"),
    [sort, setSort] = useState("registered"),
    [waiting, setWaiting] = useState(false),
    [panel, setPanel] = useState<string | null>(null),
    [confirm, setConfirm] = useState("");
  useIntent("guest-add", () => setPanel("add"));
  useIntent("guest-code", () => setPanel("code"));
  useIntent("guest-filter", () => setPanel("filter"));
  const isDoor = view === "door";
  const canCheck = isAdmin || (isDoor && canDoor);
  const all = activeGuests(data, event.id).filter((g) =>
    isAdmin || isDoor ? true : g.ownerId === user.id && !g.externalLinkId,
  );
  const list = all
    .filter(
      (g) =>
        `${g.name} ${contributorName(data, g.ownerId, g.externalLinkId)} ${g.operator}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (status === "all" || g.status === status) &&
        (owner === "all" || g.ownerId === owner || g.externalLinkId === owner),
    )
    .sort(
      (a, b) =>
        (waiting
          ? Number(a.status === "checked") - Number(b.status === "checked")
          : 0) ||
        (sort === "name"
          ? a.name.localeCompare(b.name)
          : b.createdAt.localeCompare(a.createdAt)),
    );
  const selected = data.guests.find(
    (g) => g.id === panel && g.status !== "deleted",
  );
  const close = () => {
    setPanel(null);
    setConfirm("");
  };
  const queued = (guestId: string) =>
    data.queue.some((q) => q.guestId === guestId && q.state === "queued");
  const check = async (g: MockGuest) => {
    if (
      !writable ||
      event.date !== MOCK_DATE ||
      queued(g.id) ||
      (scenario === "offline" && event.general)
    )
      return;
    if (g.status === "checked") {
      setPanel(g.id);
      setConfirm("undo");
      return;
    }
    await mutate(
      (d) => {
        if (scenario === "offline") {
          d.queue.push({
            id: id(),
            eventId: event.id,
            guestId: g.id,
            kind: "check",
            state: "queued",
          });
        } else
          performCheck(
            d.guests.find((x) => x.id === g.id)!,
            true,
          );
      },
      scenario === "offline"
        ? "이 기기에 저장했습니다. 동기화 전에는 확정되지 않습니다."
        : "입장 완료",
    );
  };
  return (
    <>
      <label className="roster-search">
        <Icon name="search" />
        <span className="sr-only">{t("게스트 이름 검색...")}</span>
        <input
          aria-label={t("게스트 이름 검색...")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("게스트 이름 검색...")}
        />
        {query && (
          <button aria-label={t("지우기")} onClick={() => setQuery("")}>
            <Icon name="close" size={15} />
          </button>
        )}
      </label>
      {!event.general && ["offline", "syncing"].includes(scenario) && (
        <div className="flow-state-banner">
          <Notice>
            {scenario === "offline"
              ? "저장된 명단 사용 중. 변경은 연결 후 반영됩니다."
              : "오프라인 변경 동기화 중…"}
          </Notice>
        </div>
      )}
      <h2 className="list-header">
        {t(isDoor ? "게스트 목록" : isAdmin ? "전체 게스트" : "내 게스트 명단")}
      </h2>
      <ul className="guest-list">
        {list.map((g) => (
          <li key={g.id}>
            <button
              className="guest-person"
              aria-label={`${g.name} ${t("상세")}`}
              onClick={() => setPanel(g.id)}
            >
              <span>
                <strong>{g.name}</strong>
                <small>
                  {contributorName(data, g.ownerId, g.externalLinkId)}
                  {g.operator ? ` · ${g.operator}` : ""}
                </small>
              </span>
            </button>
            {canCheck ? (
              <button
                className="check-button"
                aria-label={`${g.name} ${t(g.status === "checked" ? "입장 취소" : "입장 처리")}`}
                disabled={!writable || event.date !== MOCK_DATE || queued(g.id)}
                onClick={() => void check(g)}
              >
                <span
                  className={`status-badge ${g.status === "checked" ? "green" : ""}`}
                >
                  {t(
                    queued(g.id)
                      ? "기기 저장"
                      : g.status === "checked"
                        ? "입장 완료"
                        : "미입장",
                  )}
                </span>
              </button>
            ) : (
              <span
                className={`status-badge ${g.status === "checked" ? "green" : ""}`}
              >
                {t(g.status === "checked" ? "입장 완료" : "미입장")}
              </span>
            )}
          </li>
        ))}
      </ul>
      {!list.length && (
        <Empty
          text={
            query
              ? "검색 결과가 없습니다"
              : "이 운영일에 등록된 게스트가 없습니다"
          }
        />
      )}
      {panel === "add" && canRegister && (
        <Sheet title={t("게스트 등록")} onClose={close}>
          <GuestEntry onDone={close} />
        </Sheet>
      )}
      {panel === "filter" && (
        <Sheet title={t("게스트 목록 도구")} onClose={close}>
          <Select
            label="상태"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              ["all", "전체"],
              ["pending", "미입장"],
              ["checked", "입장 완료"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {t(l)}
              </option>
            ))}
          </Select>
          {(isAdmin || isDoor) && (
            <Select
              label="등록 담당자"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="all">{t("전체")}</option>
              {data.users
                .filter((u) => u.venueId === event.venueId && !u.deleted)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              {data.links
                .filter((l) => l.venueId === event.venueId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.ownerName} · {t("외부")}
                  </option>
                ))}
            </Select>
          )}
          <Select
            label="정렬"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="registered">{t("등록순")}</option>
            <option value="name">{t("이름순")}</option>
          </Select>
          {canCheck && (
            <Toggle
              label="입장 대기 우선"
              checked={waiting}
              onChange={(e) => setWaiting(e.target.checked)}
            />
          )}
          <Action onClick={close}>
            {t("{count}명 보기", { count: list.length })}
          </Action>
        </Sheet>
      )}
      {panel === "code" && (
        <Sheet title={t("게스트 찾기")} onClose={close}>
          <Form
            submit="게스트 찾기"
            onSubmit={(form) => {
              const code = string(form, "code");
              if (scenario === "offline" || scenario === "qr-error") {
                setPanel("code-unavailable");
                return;
              }
              const found = activeGuests(data, event.id).find(
                (g) => g.code === code || g.code.endsWith(`:${code}`),
              );
              setPanel(found?.id ?? "code-missing");
            }}
          >
            <Field
              label="게스트 QR 코드"
              name="code"
              required
              placeholder="AUTHON:MOCKUP:g1"
            />
          </Form>
        </Sheet>
      )}
      {(panel === "code-missing" || panel === "code-unavailable") && (
        <Sheet title={t("게스트 찾기")} onClose={close}>
          <Notice error>
            {panel === "code-missing"
              ? "이 행사에 일치하는 게스트가 없습니다."
              : "코드를 확인하지 못했습니다. 이름으로 검색하거나 다시 시도하세요."}
          </Notice>
          <Action onClick={() => setPanel("code")}>다시 시도</Action>
          <Action secondary onClick={close}>
            이름으로 검색
          </Action>
        </Sheet>
      )}
      {selected && (
        <Sheet title={selected.name} subtitle={event.name} onClose={close}>
          <div className="flow-pair">
            <span>{t("등록 담당자")}</span>
            <strong>
              {contributorName(data, selected.ownerId, selected.externalLinkId)}
            </strong>
          </div>
          {selected.operator && (
            <div className="flow-pair">
              <span>{t("현재 입력자")}</span>
              <strong>{selected.operator}</strong>
            </div>
          )}
          <div className="flow-pair">
            <span>{t("상태")}</span>
            <strong>
              {t(selected.status === "checked" ? "입장 완료" : "미입장")}
            </strong>
          </div>
          <div className="flow-pair">
            <span>{t("입장 시각")}</span>
            <strong>{selected.checkedAt?.slice(11, 16) ?? "—"}</strong>
          </div>
          {selected.externalLinkId &&
            data.links.find((l) => l.id === selected.externalLinkId)?.kind ===
              "self_rsvp" && <Qr code={selected.code} />}
          {confirm ? (
            <>
              <Confirm
                title={`${selected.name} · ${t(confirm === "delete" ? "삭제" : "입장 취소")}`}
                description={
                  confirm === "delete"
                    ? selected.status === "checked"
                      ? "입장 완료 게스트를 삭제하면 명단과 입장 집계가 변경됩니다."
                      : "명단에서 삭제합니다."
                    : "입장 처리를 취소하고 미입장 상태로 되돌립니다."
                }
                onCancel={() => setConfirm("")}
                disabled={
                  !["draft", "open"].includes(event.state) ||
                  attendanceFor(data, event.id).finalized
                }
                onConfirm={() =>
                  void mutate(
                    (d) => {
                      const g = d.guests.find((x) => x.id === selected.id)!;
                      if (confirm === "delete") g.status = "deleted";
                      else if (scenario === "offline")
                        d.queue.push({
                          id: id(),
                          eventId: event.id,
                          guestId: g.id,
                          kind: "undo-check",
                          state: "queued",
                        });
                      else performCheck(g, false);
                    },
                    confirm === "delete"
                      ? "삭제했습니다."
                      : scenario === "offline"
                        ? "이 기기에 저장했습니다. 동기화 전에는 확정되지 않습니다."
                        : "입장을 취소했습니다.",
                  ).then((ok) => {
                    if (ok) close();
                  })
                }
              />
              {notice && <Notice>{notice}</Notice>}
            </>
          ) : (
            <div className="flow-stack">
              {canCheck && (
                <Action
                  disabled={
                    !writable || event.date !== MOCK_DATE || queued(selected.id)
                  }
                  onClick={() =>
                    selected.status === "checked"
                      ? setConfirm("undo")
                      : void check(selected).then(close)
                  }
                >
                  {selected.status === "checked" ? "입장 취소" : "입장 처리"}
                </Action>
              )}
              <Action
                secondary
                disabled={
                  !["draft", "open"].includes(event.state) ||
                  attendanceFor(data, event.id).finalized ||
                  scenario === "offline" ||
                  queued(selected.id)
                }
                onClick={() => setConfirm("delete")}
              >
                삭제
              </Action>
            </div>
          )}
          {scenario === "unknown-result" && (
            <Action secondary onClick={() => setScenario("normal")}>
              최신 명단 확인
            </Action>
          )}
        </Sheet>
      )}
      {user.accountKind === "shared" && !operator && (
        <div className="flow-state-banner">
          <Notice>
            게스트를 추가하기 전에 현재 입력자 이름을 입력해주세요.
          </Notice>
        </div>
      )}
    </>
  );
}
