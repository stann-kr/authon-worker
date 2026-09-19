"use client";

import { createContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import GuestSearchInput from "../GuestSearchInput";
import Icon from "../Icon";
import Sheet from "../overlays/Sheet";

export type RosterStatus = "all" | "pending" | "checked";
export const RosterSelection = createContext<{ selectedId: string | null; select: (id: string | null) => void } | null>(null);

export default function RosterView({ header, filters, filtersActive = false, variant = "registration", query, onQueryChange, status, onStatusChange, counts, loading = false, children }: {
  header: ReactNode;
  filters?: ReactNode;
  filtersActive?: boolean;
  variant?: "registration" | "operations";
  query: string;
  onQueryChange: (value: string) => void;
  status: RosterStatus;
  onStatusChange: (status: RosterStatus) => void;
  counts: { all: number; pending: number; checked: number };
  loading?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Roster");
  const commonT = useTranslations("Common");
  const ref = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const restoreSearchFocus = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const [wideSearch, setWideSearch] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columns, setColumns] = useState<1 | 2>(1);
  const [canUseTwo, setCanUseTwo] = useState(false);
  const [selectedId, select] = useState<string | null>(null);
  useEffect(() => {
    try { if (window.localStorage.getItem("workspace:rosterColumns") === "2") setColumns(2); } catch { /* View preferences are optional. */ }
  }, []);
  useEffect(() => { select(null); }, [query, status]);
  useLayoutEffect(() => {
    const measure = () => {
      const width = ref.current?.getBoundingClientRect().width ?? 0;
      const wide = width >= 760;
      const hasWideSearch = width >= 700;
      if (hasWideSearch) setFiltersOpen(false);
      const active = document.activeElement;
      if ((hasWideSearch && (active === searchToggleRef.current || filterPanelRef.current?.contains(active))) ||
        (!hasWideSearch && toolsRef.current?.contains(active)) ||
        ((!wide || window.innerWidth < 1000) && optionsRef.current?.contains(active))) {
        restoreSearchFocus.current = true;
        setSearchOpen(true);
      }
      setWideSearch(hasWideSearch);
      if (width < 700 && document.activeElement === searchRef.current) setSearchOpen(true);
      setCanUseTwo(wide);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const searchVisible = wideSearch || searchOpen || query.length > 0;
  useLayoutEffect(() => { if (searchOpen) searchRef.current?.focus({ preventScroll: true }); }, [searchOpen]);
  useLayoutEffect(() => {
    if (restoreSearchFocus.current) searchRef.current?.focus({ preventScroll: true });
    restoreSearchFocus.current = false;
  }, [searchOpen, wideSearch, canUseTwo]);
  const closeSearch = () => {
    onQueryChange("");
    setSearchOpen(false);
    searchToggleRef.current?.focus({ preventScroll: true });
  };
  return <RosterSelection.Provider value={{ selectedId, select }}>
    <div ref={ref} className="product-roster" data-columns={canUseTwo ? columns : 1} data-variant={variant}>
      <div className="product-roster-controls" data-wide={wideSearch}>
       <div className="product-roster-summary">
        <div className="product-roster-filters" role="group" aria-label={t("status")}>
          {(["all", "pending", "checked"] as const).map((value) => <button type="button" key={value}
            aria-pressed={status === value} onClick={() => onStatusChange(value)}>
            {t(value)} <span>{loading ? "—" : counts[value]}</span>
          </button>)}
        </div>
        {!wideSearch && <div className="product-roster-icon-actions">
          <button ref={searchToggleRef} type="button" className="product-roster-icon" aria-label={commonT("searchGuestNames")}
            aria-expanded={searchVisible} aria-controls={searchId} onClick={() => searchVisible ? closeSearch() : setSearchOpen(true)}>
            <Icon name="search" size={18} />
          </button>
          <button type="button" className="product-roster-icon" data-active={filtersActive}
            aria-label={filtersActive ? t("filtersApplied") : t("filters")}
            aria-expanded={filtersOpen} aria-controls={filtersOpen ? `${searchId}-filters` : undefined} onClick={() => setFiltersOpen((open) => !open)}><Icon name="settings" size={18} /></button>
        </div>}
       </div>
       <div ref={toolsRef} id={searchId} className="product-roster-tools" hidden={!searchVisible}>
        <GuestSearchInput inputRef={searchRef} value={query} onChange={onQueryChange} placeholder={t("search")}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (query) { setSearchOpen(true); onQueryChange(""); }
            else if (!wideSearch) closeSearch();
          }} />
        {wideSearch && filters && <div className="product-roster-owner-filter">{filters}</div>}
       </div>
       {wideSearch && <div className="product-roster-desktop-options">
        <div ref={optionsRef} className="product-roster-columns" role="group" aria-label={t("columns")}>
          {([1, 2] as const).map((count) => <button type="button" key={count} disabled={count === 2 && !canUseTwo}
            aria-pressed={(canUseTwo ? columns : 1) === count} onClick={() => {
              setColumns(count);
              try { window.localStorage.setItem("workspace:rosterColumns", String(count)); } catch { /* Keep the in-memory choice. */ }
            }}>{t(count === 1 ? "oneColumn" : "twoColumns")}</button>)}
        </div>
        <div className="product-roster-extra">{header}</div>
       </div>}
      </div>
      <Sheet presentation="modal" id={`${searchId}-filters`} open={filtersOpen && !wideSearch} title={t("filters")} onClose={() => setFiltersOpen(false)}>
        <div ref={filterPanelRef} className="product-roster-filter-panel">
          {filters}
          <div className="product-roster-filter-actions">{header}</div>
        </div>
      </Sheet>
      {variant === "operations" && <div className="product-roster-headings" aria-hidden="true">
        <span>{t("guestName")}</span><span>{t("rowActions")}</span><span>{t("owner")}</span><span className="product-guest-registered-time">{t("registeredAt")}</span><span className="product-guest-checked-time">{t("checkedInAt")}</span><span>{t("status")}</span>
      </div>}
      {children}
    </div>
  </RosterSelection.Provider>;
}
