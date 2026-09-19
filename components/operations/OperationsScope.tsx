"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/Icon";
import Sheet from "@/components/overlays/Sheet";

/** The mobile scope sheet and desktop controls share the caller's scope state. */
export default function OperationsScope({ venueName, date, label, disabled = false, children }: {
  venueName?: string; date: string; label: string; disabled?: boolean; children: ReactNode;
}) {
  const t = useTranslations("Workspace");
  const summaryId = useId();
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreDesktopFocus = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1000px)");
    const update = () => {
      if (media.matches) restoreDesktopFocus.current = document.activeElement === triggerRef.current ||
        (controlsRef.current?.contains(document.activeElement) ?? false);
      else if (controlsRef.current?.contains(document.activeElement)) setOpen(true);
      setDesktop(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    if (desktop && restoreDesktopFocus.current) {
      controlsRef.current?.querySelector<HTMLElement>("input, select, button")?.focus({ preventScroll: true });
      restoreDesktopFocus.current = false;
    }
  }, [desktop]);
  const controls = <div ref={controlsRef} className="operations-scope">{children}</div>;
  return <div className="operations-scope-bar">
    {desktop ? controls : <>
      <button ref={triggerRef} type="button" className="operations-scope-trigger" disabled={disabled}
        aria-label={t("chooseScope")} aria-describedby={`${summaryId}-date ${summaryId}-event`} aria-expanded={open} aria-controls={open ? `${summaryId}-panel` : undefined} onClick={() => setOpen((current) => !current)}>
        <span className="operations-scope-dot" aria-hidden="true" />
        <span id={`${summaryId}-date`} className="operations-scope-date">{venueName ? `${venueName} · ` : ""}{date.slice(5).replace("-", ".")}</span>
        <span id={`${summaryId}-event`} className="operations-scope-name">{label}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      <Sheet presentation="modal" id={`${summaryId}-panel`} open={open} title={t("chooseScope")} onClose={() => setOpen(false)} busy={disabled}>
        {controls}
        <button type="button" className="app-button rounded-control bg-surface-raised px-4 py-3 text-sm" disabled={disabled} onClick={() => setOpen(false)}>{t("applyScope")}</button>
      </Sheet>
    </>}
  </div>;
}
