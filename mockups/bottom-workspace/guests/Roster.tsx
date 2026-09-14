import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  useMock,
  activeGuests,
  attendanceFor,
  id,
  useIntent,
  quotaFor,
} from "../data/MockData";
import { MOCK_DATE, MOCK_NOW, type MockGuest } from "../data/types";
import { requireGuestAction } from "../data/access";
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
    busy,
  } = useMock();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  useLayoutEffect(() => {
    if (searchOpen) searchRef.current?.focus({ preventScroll: true });
  }, [searchOpen]);
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
    g.venueId === event.venueId && ((isAdmin || (isDoor && canDoor)) || g.ownerId === user.id && !g.externalLinkId),
  );
  const quota = quotaFor(data, user.id, event.id);
  const checked = all.filter((g) => g.status === "checked").length;
  const filtered = query.trim() !== "" || status !== "all" || owner !== "all";
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
    searchToggleRef.current?.focus({ preventScroll: true });
  };
  const focusSearchControl = () =>
    (searchOpen ? searchRef.current : searchToggleRef.current)?.focus({
      preventScroll: true,
    });
  const resetFilters = () => {
    setQuery("");
    setStatus("all");
    setOwner("all");
    focusSearchControl();
  };
  const ownerLabel =
    data.users.find((u) => u.id === owner)?.name ??
    data.links.find((l) => l.id === owner)?.ownerName ??
    "";
  const list = all
    .filter(
      (g) =>
        `${g.name} ${contributorName(data, g.ownerId, g.externalLinkId)} ${g.operator}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
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
  const selected = all.find(
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
      !canCheck || !writable ||
      event.date !== MOCK_DATE ||
      queued(g.id) ||
      (scenario === "offline" && event.general)
    )
      return false;
    if (g.status === "checked") {
      setPanel(g.id);
      setConfirm("undo");
      return false;
    }
    return await mutate(
      (d) => {
        const guest = requireGuestAction(d, user.id, event.id, g.id, "check");
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
            guest,
            true,
          );
      },
      scenario === "offline"
        ? "이 기기에 저장했습니다. 동기화 전에는 확정되지 않습니다."
        : t("{name} · 입장 완료", { name: g.name }),
    );
  };
  return (
    <div className="roster">
      {!isAdmin && !isDoor && <dl className="stat-strip" aria-label={t("선택한 행사 요약")}>
        <div className="stat"><dt>{t("내 등록")}</dt><dd><strong>{quota.used}</strong></dd></div>
        <div className="stat"><dt>{t("남은 한도")}</dt><dd><strong>{quota.remaining ?? "∞"}</strong></dd></div>
      </dl>}
      <div className={`roster-controls ${searchOpen ? "searching" : ""}`}>
        <div className="roster-filter-row">
          <div
            className="roster-status-filters"
            role="group"
            aria-label={t("입장 상태")}
          >
            {[
              ["all", "전체", all.length],
              ["pending", "미입장", all.length - checked],
              ["checked", "입장 완료", checked],
            ].map(([value, label, count]) => (
              <button
                key={value}
                aria-pressed={status === value}
                onClick={() => setStatus(String(value))}
              >
                <span>{t(String(label))}</span>
                <small>{count}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="roster-controlbar">
          <div className="roster-result-heading sr-only" hidden={searchOpen}>
            <h2 className="list-header">
              {t(
                isDoor
                  ? "게스트 목록"
                  : isAdmin
                    ? "전체 게스트"
                    : "내 게스트 명단",
              )}
            </h2>
            <span>{t("{count}명", { count: list.length })}</span>
          </div>
          <div className="roster-search" id={searchId} hidden={!searchOpen}>
            <label className="sr-only" htmlFor={`${searchId}-input`}>
              {t("게스트 이름 검색...")}
            </label>
            <input
              id={`${searchId}-input`}
              aria-label={t("게스트 이름 검색...")}
              ref={searchRef}
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (query) setQuery("");
                  else closeSearch();
                } else if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder={t("이름·담당자 검색")}
            />
            {query && (
              <button
                type="button"
                aria-label={t("지우기")}
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                <Icon name="close" size={15} />
              </button>
            )}
          </div>
          <button
            ref={searchToggleRef}
            type="button"
            className={`roster-icon-button ${searchOpen ? "active" : ""}`}
            aria-label={t(searchOpen ? "검색 닫기" : "검색 열기")}
            aria-expanded={searchOpen}
            aria-controls={searchId}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <Icon name={searchOpen ? "close" : "search"} size={19} />
          </button>
          <button
            className={`roster-icon-button ${owner !== "all" || sort !== "registered" || waiting ? "active" : ""}`}
            aria-label={t("필터·정렬")}
            aria-haspopup="dialog"
            onClick={() => setPanel("filter")}
          >
            <Icon name="sliders" size={19} />
          </button>
        </div>
        {(owner !== "all" || sort !== "registered" || waiting) && (
          <div className="roster-applied" aria-label={t("적용한 조건")}>
            {owner !== "all" && (
              <button
                aria-label={t("{name} 필터 해제", { name: ownerLabel })}
                onClick={() => setOwner("all")}
              >
                {ownerLabel}
                <Icon name="close" size={12} />
              </button>
            )}
            {sort !== "registered" && (
              <button
                aria-label={t("{name} 필터 해제", { name: t("이름순") })}
                onClick={() => setSort("registered")}
              >
                {t("이름순")}
                <Icon name="close" size={12} />
              </button>
            )}
            {waiting && (
              <button
                aria-label={t("{name} 필터 해제", {
                  name: t("입장 대기 우선"),
                })}
                onClick={() => setWaiting(false)}
              >
                {t("입장 대기 우선")}
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        )}
      </div>
      {event.date !== MOCK_DATE && canCheck && (
        <p className="roster-hint">
          {t("입장 처리는 현재 운영일에만 가능합니다.")}
        </p>
      )}
      {!event.general && ["offline", "syncing"].includes(scenario) && (
        <div className="flow-state-banner">
          <Notice>
            {scenario === "offline"
              ? "저장된 명단 사용 중. 변경은 연결 후 반영됩니다."
              : "오프라인 변경 동기화 중…"}
          </Notice>
        </div>
      )}
      <p
        className={`roster-results ${filtered ? "" : "sr-only"}`}
        role="status"
      >
        {t("{count}명 표시 · 전체 {total}명", {
          count: list.length,
          total: all.length,
        })}
      </p>
      {list.length > 0 && <div className="guest-list-columns" aria-hidden="true">
        <span>{t("게스트")}</span><span>{t("입장 상태")}</span>
        <span>{t("등록 담당자")}</span><span className="guest-operator">{t("입력자")}</span><span>{t("입장 시각")}</span>
      </div>}
      <ul className="guest-list">
        {list.map((g) => (
          <li key={g.id}>
            <button
              className="guest-person"
              aria-pressed={panel === g.id}
              aria-label={`${g.name} ${t("상세")}`}
              onClick={() => setPanel(g.id)}
            >
              <span>
                <strong>{g.name}</strong>
                <small className="guest-mobile-meta">
                  {contributorName(data, g.ownerId, g.externalLinkId)}
                  {g.operator ? ` · ${g.operator}` : ""}
                </small>
              </span>
            </button>
            {canCheck ? (
              <button
                className={`check-button ${g.status === "checked" ? "is-checked" : "is-pending"}`}
                aria-label={`${g.name} ${t(g.status === "checked" ? "입장 취소" : "입장 처리")}`}
                disabled={
                  busy ||
                  !writable ||
                  event.date !== MOCK_DATE ||
                  queued(g.id) ||
                  (scenario === "offline" && event.general)
                }
                onClick={(event) => {
                  const keyboard = event.detail === 0;
                  void check(g).then((ok) => {
                    if (ok && keyboard && status === "pending")
                      requestAnimationFrame(focusSearchControl);
                  });
                }}
              >
                <span
                  className={`status-badge ${g.status === "checked" ? "green" : ""}`}
                >
                  {t(
                    queued(g.id)
                      ? "기기 저장"
                      : g.status === "checked"
                        ? "입장 완료"
                        : "입장 처리",
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
            <span className="guest-owner">
              <span className="sr-only">{t("등록 담당자")}: </span>
              {contributorName(data, g.ownerId, g.externalLinkId)}
              {g.operator && <small className="guest-tablet-operator">{g.operator}</small>}
            </span>
            <span className="guest-operator"><span className="sr-only">{t("입력자")}: </span>{g.operator || "—"}</span>
            <time className="guest-check-time" dateTime={g.checkedAt ?? undefined}>
              <span className="sr-only">{t("입장 시각")} </span>
              {g.checkedAt?.slice(11, 16) ?? "—"}
            </time>
          </li>
        ))}
      </ul>
      {!list.length && (
        <div className="roster-empty">
          <Empty
            text={
              filtered
                ? "조건에 맞는 게스트가 없습니다"
                : "이 운영일에 등록된 게스트가 없습니다"
            }
          />
          {filtered ? (
            <>
              <Action secondary onClick={resetFilters}>
                검색·필터 초기화
              </Action>
            </>
          ) : (
            canRegister &&
            ["draft", "open"].includes(event.state) &&
            !attendanceFor(data, event.id).finalized && (
              <Action onClick={() => setPanel("add")}>첫 게스트 등록</Action>
            )
          )}
        </div>
      )}
      {panel === "add" && canRegister && (
        <Sheet
          title={t("게스트 등록")}
          size="wide"
          subtitle={`${event.name} · ${event.date}`}
          protectEdits
          onClose={close}
        >
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
          <Action
            secondary
            onClick={() => {
              resetFilters();
              setSort("registered");
              setWaiting(false);
            }}
          >
            모든 조건 초기화
          </Action>
        </Sheet>
      )}
      {panel === "code" && canCheck && (
        <Sheet title={t("게스트 찾기")} onClose={close}>
          <Form
            submit="게스트 찾기"
            onSubmit={(form) => {
              const code = string(form, "code");
              if (scenario === "offline" || scenario === "qr-error") {
                setPanel("code-unavailable");
                return;
              }
              const found = all.find(
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
          <Action
            secondary
            onClick={() => {
              close();
              setSearchOpen(true);
              requestAnimationFrame(() =>
                searchRef.current?.focus({ preventScroll: true }),
              );
            }}
          >
            이름으로 검색
          </Action>
        </Sheet>
      )}
      {selected && (
        <Sheet key={selected.id} presentation={confirm ? "modal" : "detail"} title={selected.name} subtitle={event.name} onClose={close}>
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
                      const g = requireGuestAction(d, user.id, event.id, selected.id, confirm === "delete" ? "delete" : "check");
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
                    !writable ||
                    event.date !== MOCK_DATE ||
                    queued(selected.id) ||
                    (scenario === "offline" && event.general)
                  }
                  onClick={() =>
                    selected.status === "checked"
                      ? setConfirm("undo")
                      : void check(selected).then((ok) => {
                          if (ok) close();
                        })
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
          {!confirm && notice && <Notice>{notice}</Notice>}
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
    </div>
  );
}
