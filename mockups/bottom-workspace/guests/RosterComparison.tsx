import { useState } from "react";
import { useMock } from "../data/MockData";
import "./roster-comparison.css";

export type RosterLayout = "columns" | "identity";

export function useRosterLayout() {
  const [layout, setLayout] = useState<RosterLayout>(() =>
    new URLSearchParams(window.location.search).get("door-layout") === "identity"
      ? "identity" : "columns",
  );
  const chooseLayout = (next: RosterLayout) => {
    const url = new URL(window.location.href);
    url.searchParams.set("door-layout", next);
    window.history.replaceState(window.history.state, "", url);
    setLayout(next);
  };
  return [layout, chooseLayout] as const;
}

export function RosterComparison({ layout, onChange }: {
  layout: RosterLayout;
  onChange: (layout: RosterLayout) => void;
}) {
  const { t } = useMock();
  return (
    <div className="roster-comparison" role="group" aria-label={t("명단 비교")}>
      <span>{t("명단 비교")}</span>
      <button type="button" aria-pressed={layout === "columns"} onClick={() => onChange("columns")}>
        {t("A · 열 정렬")}
      </button>
      <button type="button" aria-pressed={layout === "identity"} onClick={() => onChange("identity")}>
        {t("B · 이름 중심")}
      </button>
    </div>
  );
}
