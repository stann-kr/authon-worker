"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Button from "../Button";
import Icon from "../Icon";
import { useIsRouteTransitionActive } from "../RouteTransitionProvider";

interface SheetProps {
  id?: string;
  open?: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  presentation?: "detail";
  wide?: boolean;
  size?: "default" | "record";
  busy?: boolean;
  dirty?: boolean;
  protectEdits?: boolean;
  blockDuringRouteTransition?: boolean;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const controlValue = (field: Control) =>
  field instanceof window.HTMLInputElement && ["checkbox", "radio"].includes(field.type)
    ? String(field.checked) : field.value;
const controlDefaultValue = (field: Control) => {
  if (field instanceof window.HTMLSelectElement)
    return field.querySelector<HTMLOptionElement>("option[selected]")?.value ?? field.options[0]?.value ?? "";
  if (field instanceof window.HTMLInputElement && ["checkbox", "radio"].includes(field.type))
    return String(field.defaultChecked);
  return field.defaultValue;
};
const draftControls = "input:not([data-preserve-on-close]), select:not([data-preserve-on-close]), textarea:not([data-preserve-on-close])";

function canRestoreFocus(target: HTMLElement | null): target is HTMLElement {
  if (!target?.isConnected || target === document.body || target.closest("[hidden], [inert]") || target.matches(":disabled")) return false;
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

export function requestSheetClose(id: string, onClosed?: () => void) {
  document.getElementById(id)?.dispatchEvent(new window.CustomEvent("sheet-close", { detail: onClosed }));
}

// Every workspace form and detail expands in its owner's document flow.
export default function Sheet({ id, open = true, title, children, onClose, presentation = "detail",
  wide = false, size = "default", busy = false, dirty = false, protectEdits = false,
  blockDuringRouteTransition = true }: SheetProps) {
  const t = useTranslations("Sheet");
  const routeTransitionActive = useIsRouteTransitionActive();
  const transitioning = blockDuringRouteTransition && routeTransitionActive;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const editFocus = useRef<HTMLElement | null>(null);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const baseline = useRef(new Map<Element, string>());
  const [discard, setDiscard] = useState(false);
  const latest = useRef({ busy, dirty, discard, onClose });
  useLayoutEffect(() => { latest.current = { busy, dirty, discard, onClose }; });

  const keepEditing = () => {
    afterClose.current = undefined;
    setDiscard(false);
    requestAnimationFrame(() => editFocus.current?.isConnected && editFocus.current.focus({ preventScroll: true }));
  };
  const completeClose = () => {
    const followup = afterClose.current;
    afterClose.current = undefined;
    latest.current.onClose();
    followup?.();
  };
  const requestClose = () => {
    const state = latest.current;
    if (state.busy) return;
    if (state.discard) { keepEditing(); return; }
    const hasChangedFields = protectEdits && [...(panelRef.current?.querySelectorAll<Control>(draftControls) ?? [])]
      .some((field) => controlValue(field) !== (baseline.current.get(field) ?? controlDefaultValue(field)));
    if (state.dirty || hasChangedFields) {
      editFocus.current = document.activeElement as HTMLElement;
      setDiscard(true);
    } else completeClose();
  };
  const requestCloseRef = useRef(requestClose);
  useLayoutEffect(() => { requestCloseRef.current = requestClose; });

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const opener = document.activeElement as HTMLElement | null;
    baseline.current.clear();
    panel?.querySelectorAll<Control>(draftControls).forEach((field) => baseline.current.set(field, controlValue(field)));
    closeRef.current?.focus();
    return () => {
      const active = document.activeElement;
      if (active !== document.body && active?.isConnected && !panel?.contains(active)) return;
      queueMicrotask(() => {
        // Restore only after the closed panel has left the document.
        if (document.activeElement !== document.body && document.activeElement?.isConnected) return;
        const remainingSheet = [...document.querySelectorAll<HTMLElement>(".product-sheet")].at(-1);
        const target = canRestoreFocus(opener) ? opener
          : remainingSheet?.querySelector<HTMLElement>("button:not(:disabled)") ?? document.getElementById("main-content");
        target?.focus({ preventScroll: true });
      });
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) return;
    setDiscard(false);
  }, [open]);

  useLayoutEffect(() => {
    if (discard) continueRef.current?.focus();
  }, [discard]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const close = (event: Event) => {
      if (latest.current.busy) return;
      afterClose.current = (event as CustomEvent<(() => void) | undefined>).detail;
      requestCloseRef.current();
    };
    panel?.addEventListener("sheet-close", close);
    return () => panel?.removeEventListener("sheet-close", close);
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return (
    <div className="product-sheet-layer" data-transitioning={transitioning} inert={transitioning || undefined} hidden={transitioning}>
      <div id={id} ref={panelRef} className="product-sheet" data-wide={wide} data-size={size} role="region" data-presentation={presentation}
        aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || transitioning) return;
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        }}
        onFocusCapture={() => {
          panelRef.current?.querySelectorAll<Control>(draftControls).forEach((field) => {
            if (!baseline.current.has(field)) baseline.current.set(field, controlValue(field));
          });
        }}
        onChangeCapture={() => {
          if (!protectEdits) return;
          const fields = [...panelRef.current!.querySelectorAll<Control>(draftControls)];
          fields.forEach((field) => {
            if (!baseline.current.has(field)) baseline.current.set(field, controlDefaultValue(field));
          });
        }}>
        <header className="product-sheet-header">
          <h2 id={titleId}>{title}</h2>
          <Button ref={closeRef} variant="ghost" onClick={requestClose} disabled={busy} aria-label={t("close")} aria-expanded="true" aria-controls={`${titleId}-body`}><Icon name="chevron-down" className="rotate-180" size={20} /></Button>
        </header>
        {discard && <div className="product-sheet-discard" role="group" aria-label={t("unsaved")}>
          <p>{t("unsaved")}</p>
          <Button ref={continueRef} onClick={keepEditing}>{t("continue")}</Button>
          <Button variant="outline" onClick={completeClose} disabled={busy}>{t("discard")}</Button>
        </div>}
        <div id={`${titleId}-body`} className="product-sheet-body" hidden={discard}>{children}</div>
      </div>
    </div>);
}
