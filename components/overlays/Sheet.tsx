"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import Button from "../Button";
import Icon from "../Icon";
import { lockModalBackground } from "./modal-lock";
import { useIsRouteTransitionActive } from "../RouteTransitionProvider";

interface SheetProps {
  open?: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  presentation?: "modal" | "detail";
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

const inlinePanels = new Set<HTMLElement>();

// The same panel and form stay mounted when the available workspace changes.
export default function Sheet({ open = true, title, children, onClose, presentation = "modal",
  wide = false, size = "default", busy = false, dirty = false, protectEdits = false,
  blockDuringRouteTransition = true }: SheetProps) {
  const t = useTranslations("Sheet");
  const routeTransitionActive = useIsRouteTransitionActive();
  const transitioning = blockDuringRouteTransition && routeTransitionActive;
  const layerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const editFocus = useRef<HTMLElement | null>(null);
  const baseline = useRef(new Map<Element, string>());
  const [edited, setEdited] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [inline, setInline] = useState(false);
  const latest = useRef({ busy, dirty, edited, discard, onClose });
  useLayoutEffect(() => { latest.current = { busy, dirty, edited, discard, onClose }; });

  const keepEditing = () => {
    setDiscard(false);
    requestAnimationFrame(() => editFocus.current?.isConnected && editFocus.current.focus({ preventScroll: true }));
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
    } else state.onClose();
  };
  const requestCloseRef = useRef(requestClose);
  useLayoutEffect(() => { requestCloseRef.current = requestClose; });

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const opener = document.activeElement as HTMLElement | null;
    baseline.current.clear();
    panel?.querySelectorAll<Control>(draftControls).forEach((field) => baseline.current.set(field, controlValue(field)));
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (active !== document.body && active?.isConnected && !panel?.contains(active)) return;
      queueMicrotask(() => {
        // Wait for this layer's inert/scroll cleanup before restoring focus.
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
    setEdited(false);
    setDiscard(false);
  }, [open]);

  useLayoutEffect(() => {
    if (discard) continueRef.current?.focus();
  }, [discard]);

  useLayoutEffect(() => {
    if (!open) return;
    const main = document.querySelector<HTMLElement>(".workspace-shell #main-content");
    const header = document.querySelector<HTMLElement>(".workspace-header");
    const panel = panelRef.current;
    const measure = () => {
      const viewport = window.visualViewport;
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      layerRef.current?.style.setProperty("--sheet-viewport-top", `${top}px`);
      layerRef.current?.style.setProperty("--sheet-viewport-bottom", `${Math.max(0, window.innerHeight - top - visibleHeight)}px`);
      layerRef.current?.style.setProperty("--sheet-max-height", `${Math.max(120, visibleHeight - 32)}px`);
      const width = main?.getBoundingClientRect().width ?? 0;
      const canShowInline = presentation === "detail" && size !== "record" && !dirty && !edited && width >= 980 && visibleHeight >= 480;
      setInline(canShowInline);
      if (panel) {
        if (canShowInline) inlinePanels.add(panel);
        else inlinePanels.delete(panel);
      }
      main?.classList.toggle("workspace-has-detail", inlinePanels.size > 0);
      if (panelRef.current && main) {
        panelRef.current.style.setProperty("--sheet-right", `${Math.max(16, window.innerWidth - main.getBoundingClientRect().right + 24)}px`);
        panelRef.current.style.setProperty("--sheet-top", `${Math.max(0, (header?.getBoundingClientRect().bottom ?? 72) - top) + 16}px`);
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (main) observer?.observe(main);
    if (header) observer?.observe(header);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer?.disconnect(); window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      if (panel) inlinePanels.delete(panel);
      main?.classList.toggle("workspace-has-detail", inlinePanels.size > 0);
    };
  }, [open, presentation, size, dirty, edited]);

  useLayoutEffect(() => {
    if (!open) return;
    const shell = document.querySelector<HTMLElement>(".workspace-shell") ?? document.getElementById("main-content");
    const unlock = !inline ? lockModalBackground(shell) : undefined;
    const keydown = (event: KeyboardEvent) => {
      // A confirmation opened from this sheet owns its own keyboard scope.
      if (transitioning || event.defaultPrevented || document.querySelector(".app-dialog-backdrop")) return;
      const panel = panelRef.current;
      if (![...document.querySelectorAll(".product-sheet-layer")].at(-1)?.contains(panel)) return;
      if (!panel || (inline && !panel.contains(document.activeElement))) return;
      if (event.key === "Escape") { event.preventDefault(); requestCloseRef.current(); }
      if (event.key !== "Tab" || inline) return;
      const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"], summary:not([aria-disabled="true"])')]
         .filter((element) => {
          const collapsed = element.closest("details:not([open])");
          return !element.closest("[hidden], [inert]") && element.getAttribute("type") !== "hidden" &&
            (!collapsed || collapsed.querySelector("summary") === element);
        });
      const first = controls[0] ?? panel;
      const last = controls.at(-1) ?? panel;
      if (!panel.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); first.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      unlock?.();
    };
  }, [open, inline, transitioning]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={layerRef} className="product-sheet-layer" data-inline={inline} data-transitioning={transitioning} inert={transitioning || undefined} aria-hidden={transitioning || undefined} onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={panelRef} className="product-sheet" data-wide={wide} data-size={size} role="dialog" aria-modal={!inline}
        aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
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
          setEdited(fields.some((field) => controlValue(field) !== baseline.current.get(field)));
        }}>
        <header className="product-sheet-header">
          <h2 id={titleId}>{title}</h2>
          <Button ref={closeRef} variant="ghost" onClick={requestClose} disabled={busy} aria-label={t("close")}><Icon name="close" size={20} /></Button>
        </header>
        {discard && <div className="product-sheet-discard" role="group" aria-label={t("unsaved")}>
          <p>{t("unsaved")}</p>
          <Button ref={continueRef} onClick={keepEditing}>{t("continue")}</Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("discard")}</Button>
        </div>}
        <div className="product-sheet-body" hidden={discard}>{children}</div>
      </div>
    </div>, document.body);
}
