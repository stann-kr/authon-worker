import { useMemo, useState } from "react";
import {
  parseBulkGuestInput,
  toRetainedBulkGuestLineText,
  toStoredGuestName,
} from "../../../lib/guests/bulk-entry";
import {
  parseGuestCsv,
  inferGuestNameColumn,
  previewGuestCsvColumn,
  type ParsedGuestCsv,
} from "../../../lib/guests/csv-import";
import {
  useMock,
  id,
  activeGuests,
  quotaFor,
  attendanceFor,
} from "../data/MockData";
import { MOCK_NOW } from "../data/types";
import {
  Action,
  Area,
  Field,
  Form,
  Notice,
  Select,
  Toggle,
} from "../shared/ui";
export function GuestEntry({
  onDone,
  externalLinkId,
}: {
  onDone: () => void;
  externalLinkId?: string;
}) {
  const {
    data,
    user,
    event,
    operator,
    setOperator,
    scenario,
    setScenario,
    mutate,
    t,
    notify,
  } = useMock();
  const link = data.links.find((l) => l.id === externalLinkId);
  const targetEvent = link
    ? data.events.find((e) => e.id === link.eventId)!
    : event;
  const [bulk, setBulk] = useState(false),
    [singleRaw, setSingleRaw] = useState(""),
    [bulkRaw, setBulkRaw] = useState(""),
    [confirmed, setConfirmed] = useState<number[]>([]),
    [csv, setCsv] = useState<ParsedGuestCsv | null>(null),
    [column, setColumn] = useState<number | null>(null),
    [localError, setError] = useState("");
  const raw = bulk ? bulkRaw : singleRaw;
  const setRaw = bulk ? setBulkRaw : setSingleRaw;
  const existing = activeGuests(data, targetEvent.id)
    .filter((g) => (link ? g.externalLinkId === link.id : true))
    .map((g) => g.name);
  const preview = parseBulkGuestInput(raw, existing);
  const quota = quotaFor(data, user.id, targetEvent.id);
  const remaining = link
    ? Math.max(
        0,
        link.limit -
          data.guests.filter(
            (g) => g.externalLinkId === link.id && g.status !== "deleted",
          ).length,
      )
    : quota.remaining;
  const csvPreview = useMemo(
    () =>
      csv && column !== null
        ? previewGuestCsvColumn({
            parsed: csv,
            columnIndex: column,
            existingNames: [],
          })
        : null,
    [csv, column],
  );
  const ready = preview.lines.filter(
    (l) =>
      !l.error &&
      l.inPasteLimit &&
      (!(l.isDuplicateExisting || l.isDuplicateInInput) ||
        confirmed.includes(l.inputIndex)),
  );
  const allowed =
    data.venues.find((v) => v.id === targetEvent.venueId)?.active &&
    !attendanceFor(data, targetEvent.id).finalized &&
    ["draft", "open"].includes(targetEvent.state) &&
    scenario !== "scope-closed" &&
    (!link || (link.active && !link.deleted)) &&
    scenario !== "storage-denied" &&
    scenario !== "unknown-result";
  const changeRaw = (value: string) => {
    setRaw(value.slice(0, 10000));
    setConfirmed([]);
    setError("");
  };
  const save = async () => {
    setError("");
    if (!allowed) return;
    if (!raw.trim()) {
      setError("게스트 이름을 입력해주세요.");
      return;
    }
    if (!link && user.accountKind === "shared" && !operator.trim()) {
      setError("게스트를 추가하기 전에 현재 입력자 이름을 입력해주세요.");
      return;
    }
    if (!ready.length) {
      setError(
        preview.lines.some((l) => l.isDuplicateExisting || l.isDuplicateInInput)
          ? "같은 이름이 이미 명단에 있습니다. 여러 이름 붙여넣기에서 중복을 확인한 뒤 명시적으로 추가해주세요."
          : "100자 이하로 입력해주세요.",
      );
      return;
    }
    const added: number[] = [];
    const ok = await mutate((d) => {
      const target = d.events.find((e) => e.id === targetEvent.id)!;
      if (attendanceFor(d, target.id).finalized)
        throw Error("이 행사에는 게스트를 등록할 수 없습니다.");
      if (!["draft", "open"].includes(target.state))
        throw Error("이 행사에는 게스트를 등록할 수 없습니다.");
      const free = link
        ? Math.max(
            0,
            link.limit -
              d.guests.filter(
                (g) => g.externalLinkId === link.id && g.status !== "deleted",
              ).length,
          )
        : quotaFor(d, user.id, targetEvent.id).remaining;
      const limit = free === null ? 25 : Math.min(25, free);
      for (const line of ready.slice(0, limit)) {
        const gid = id();
        d.guests.push({
          id: gid,
          venueId: target.venueId,
          eventId: target.id,
          name: toStoredGuestName(line.name),
          ownerId: link?.contributorUserId ?? user.id,
          externalLinkId: link?.id ?? null,
          operator: link ? "" : operator.trim(),
          status: "pending",
          code: `AUTHON:MOCKUP:${gid}`,
          createdAt: MOCK_NOW,
          checkedAt: null,
          checkIns: 0,
          cancellations: 0,
        });
        added.push(line.inputIndex);
      }
      if (!added.length)
        throw Error("이 운영일에 적용되는 게스트 한도에 도달했습니다.");
    }, "게스트를 등록했습니다.");
    if (!ok) return;
    const retained = preview.lines.filter((l) => !added.includes(l.inputIndex));
    if (retained.length) {
      setRaw(retained.map(toRetainedBulkGuestLineText).join("\n"));
      setConfirmed([]);
      notify(
        t(
          "{count}명을 추가했습니다. 확인할 이름 {remaining}명을 입력란에 남겨뒀습니다.",
          { count: added.length, remaining: retained.length },
        ),
      );
    } else onDone();
  };
  return (
    <Form
      submit={
        bulk
          ? t("{count}명 추가", {
              count: Math.min(ready.length, remaining ?? 25, 25),
            })
          : "게스트 추가"
      }
      onSubmit={save}
      disabled={!allowed || remaining === 0}
    >
      {!link && user.accountKind === "shared" && (
        <Field
          label="현재 입력자"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          required
          placeholder="본인 이름 입력"
        />
      )}
      {bulk ? (
        <Area
          label="붙여넣을 이름"
          value={raw}
          onChange={(e) => changeRaw(e.target.value)}
          placeholder="한 줄에 한 명\n게스트 A\n게스트 B"
          maxLength={10000}
          required
        />
      ) : (
        <Field
          label="게스트 이름"
          error={localError}
          autoComplete="off"
          value={raw}
          onChange={(e) => changeRaw(e.target.value)}
          maxLength={100}
          required
          autoFocus
          placeholder="전체 이름 입력"
        />
      )}
      <Toggle
        label="여러 명 한 번에 등록"
        checked={bulk}
        onChange={(e) => {
          if (e.target.checked && !bulkRaw) setBulkRaw(singleRaw);
          setBulk(e.target.checked);
          setConfirmed([]);
          setError("");
        }}
      />
      <div className="quota-line">
        <span>{t("남은 인원")}</span>
        <strong>
          {remaining === null
            ? t("무제한")
            : t("{count}명", { count: remaining })}
        </strong>
      </div>
      {remaining === 0 && (
        <Notice error>이 운영일에 적용되는 게스트 한도에 도달했습니다.</Notice>
      )}
      {!allowed && (
        <Notice error>이 행사에는 게스트를 등록할 수 없습니다.</Notice>
      )}
      {bulk && localError && <Notice error>{localError}</Notice>}
      {scenario === "unknown-result" && (
        <Action secondary onClick={() => setScenario("normal")}>
          최신 명단 확인
        </Action>
      )}
      {bulk && (
        <>
          <details className="flow-details">
            <summary>{t("CSV 파일 가져오기")}</summary>
            <Field
              label="CSV 파일 가져오기"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const parsed = parseGuestCsv(await file.text());
                  setCsv(parsed);
                  setColumn(
                    parsed.error ? null : inferGuestNameColumn(parsed.headers),
                  );
                  if (parsed.error)
                    setError(
                      parsed.error === "TOO_LARGE"
                        ? "CSV 파일이 10,000자 미리보기 한도를 넘습니다."
                        : parsed.error === "UNCLOSED_QUOTE"
                          ? "CSV에 닫히지 않은 따옴표 셀이 있습니다."
                          : "CSV 파일을 확인해주세요.",
                    );
                } catch {
                  setError("CSV 파일을 읽지 못했습니다.");
                }
              }}
            />
            {csv && !csv.error && (
              <>
                <Select
                  label="게스트 이름 열"
                  value={column ?? ""}
                  onChange={(e) =>
                    setColumn(
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                >
                  <option value="">{t("열 선택")}</option>
                  {csv.headers.map((h, i) => (
                    <option value={i} key={i}>
                      {h}
                    </option>
                  ))}
                </Select>
                {csvPreview && (
                  <Notice>
                    {csvPreview.multilineCellCount
                      ? t(
                          "선택한 셀 {count}개에 줄바꿈이 있습니다. 파일을 수정한 뒤 다시 적용해주세요.",
                          { count: csvPreview.multilineCellCount },
                        )
                      : t("이름 {count}명을 불러올 수 있습니다.", {
                          count: csvPreview.bulk.lines.length,
                        })}
                  </Notice>
                )}
                <Action
                  secondary
                  disabled={!csvPreview?.canApply}
                  onClick={() => {
                    if (csvPreview?.canApply) changeRaw(csvPreview.rawInput);
                  }}
                >
                  이름 불러오기
                </Action>
              </>
            )}
          </details>
          <p className="flow-hint">{t("한 줄에 1명 · 한 번에 최대 25명")}</p>
          {preview.lines.slice(0, 30).map((line) => (
            <div className="flow-pair" key={line.inputIndex}>
              <span>
                {line.lineNumber}.{" "}
                {line.error === "CONTROL_CHARACTER" ||
                line.error === "FORMAT_CHARACTER"
                  ? t("지원하지 않는 문자가 있어 이 행의 이름을 숨겼습니다.")
                  : line.name}
              </span>
              {line.error ? (
                <strong>{t("수정 필요")}</strong>
              ) : !line.inPasteLimit ? (
                <strong>{t("다음 등록")}</strong>
              ) : line.isDuplicateExisting || line.isDuplicateInInput ? (
                <label className="flow-check">
                  <input
                    type="checkbox"
                    checked={confirmed.includes(line.inputIndex)}
                    onChange={(e) =>
                      setConfirmed((c) =>
                        e.target.checked
                          ? [...c, line.inputIndex]
                          : c.filter((i) => i !== line.inputIndex),
                      )
                    }
                  />
                  <span>{t("중복 포함")}</span>
                </label>
              ) : (
                <strong>{t("등록 가능")}</strong>
              )}
            </div>
          ))}
          {preview.overflowCount > 0 && (
            <Notice>
              {t(
                "{count}명은 다음 등록을 위해 남겨둡니다. 한 번에 최대 25명까지 추가할 수 있습니다.",
                { count: preview.overflowCount },
              )}
            </Notice>
          )}
          <Action secondary onClick={() => changeRaw("")}>
            지우기
          </Action>
        </>
      )}
    </Form>
  );
}
