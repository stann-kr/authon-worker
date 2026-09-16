import { useState } from "react";
import { useMock } from "../data/MockData";

export type RosterColumns = 1 | 2;

export function useRosterColumns() {
  const [columns, setColumns] = useState<RosterColumns>(() =>
    new URLSearchParams(window.location.search).get("roster-columns") === "2" ? 2 : 1,
  );
  const chooseColumns = (next: RosterColumns) => {
    const url = new URL(window.location.href);
    url.searchParams.set("roster-columns", String(next));
    window.history.replaceState(window.history.state, "", url);
    setColumns(next);
  };
  return [columns, chooseColumns] as const;
}

export function RosterViewOptions({ columns, allowTwo, listId, onChange }: {
  columns: RosterColumns;
  allowTwo: boolean;
  listId: string;
  onChange: (columns: RosterColumns) => void;
}) {
  const { t } = useMock();
  return (
    <div className="roster-view-options" role="group" aria-label={t("명단 보기")} data-responsive-control
      title={allowTwo ? undefined : t("넓은 영역에서 2열을 사용할 수 있습니다.")}>
      {([1, 2] as const).map((value) => (
        <button type="button" key={value} aria-label={t(value === 1 ? "1열 보기" : "2열 보기")}
          aria-pressed={columns === value} aria-controls={listId} disabled={value === 2 && !allowTwo}
          onClick={() => onChange(value)}>
          {t(value === 1 ? "1열" : "2열")}
        </button>
      ))}
    </div>
  );
}
