"use client";

import { createContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import GuestSearchInput from "../GuestSearchInput";

export type RosterStatus = "all" | "pending" | "checked";
export const RosterSelection = createContext<{ selectedId: string | null; select: (id: string | null) => void } | null>(null);

export default function RosterView({ header, query, onQueryChange, status, onStatusChange, counts, loading = false, children }: {
  header: ReactNode;
  query: string;
  onQueryChange: (value: string) => void;
  status: RosterStatus;
  onStatusChange: (status: RosterStatus) => void;
  counts: { all: number; pending: number; checked: number };
  loading?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Roster");
  const ref = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<1 | 2>(1);
  const [canUseTwo, setCanUseTwo] = useState(false);
  const [selectedId, select] = useState<string | null>(null);
  useEffect(() => {
    try { if (window.localStorage.getItem("workspace:rosterColumns") === "2") setColumns(2); } catch { /* View preferences are optional. */ }
  }, []);
  useEffect(() => { select(null); }, [query, status]);
  useLayoutEffect(() => {
    const measure = () => {
      const wide = (ref.current?.getBoundingClientRect().width ?? 0) >= 760;
      setCanUseTwo(wide);
      if ((!wide || window.innerWidth < 1000) && optionsRef.current?.contains(document.activeElement)) {
        ref.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return <RosterSelection.Provider value={{ selectedId, select }}>
    <div ref={ref} className="product-roster main-content-panel" data-columns={canUseTwo ? columns : 1}>
      {header}
      <div className="product-roster-tools">
        <GuestSearchInput value={query} onChange={onQueryChange} placeholder={t("search")} />
        <div className="product-roster-filters" role="group" aria-label={t("status")}>
          {(["all", "pending", "checked"] as const).map((value) => <button type="button" key={value}
            aria-pressed={status === value} onClick={() => onStatusChange(value)}>
            {t(value)} <span>{loading ? "—" : counts[value]}</span>
          </button>)}
        </div>
        <div ref={optionsRef} className="product-roster-columns" role="group" aria-label={t("columns")}>
          {([1, 2] as const).map((count) => <button type="button" key={count} disabled={count === 2 && !canUseTwo}
            aria-pressed={(canUseTwo ? columns : 1) === count} onClick={() => {
              setColumns(count);
              try { window.localStorage.setItem("workspace:rosterColumns", String(count)); } catch { /* Keep the in-memory choice. */ }
            }}>{t(count === 1 ? "oneColumn" : "twoColumns")}</button>)}
        </div>
      </div>
      {children}
    </div>
  </RosterSelection.Provider>;
}
