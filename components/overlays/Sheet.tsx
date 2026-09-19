"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import Button from "../Button";
import Icon from "../Icon";
import { useIsRouteTransitionActive } from "../RouteTransitionProvider";
import { lockModalBackground } from "./modal-lock";
import { restoreOverlayFocus } from "./restore-focus";
import { useKeyboardOpen } from "../viewport/ViewportProvider";
import { registerNavigationGuard, withConfirmedClose } from "./navigation-guard";

interface SheetProps {
  id?: string;
  open?: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  presentation?: "detail" | "modal" | "inline" | "page";
  labelledBy?: string;
  revealOnOpen?: boolean;
  wide?: boolean;
  size?: "default" | "record" | "form";
  busy?: boolean;
  dirty?: boolean;
  closeWarning?: string;
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

function canRestoreFocus(target: HTMLElement | null, allowInert = false): target is HTMLElement {
  if (!target?.isConnected || target === document.body || target.closest("[hidden]") ||
    (!allowInert && target.closest("[inert]")) || target.matches(":disabled")) return false;
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

export function requestSheetClose(id: string, onClosed?: () => void) {
  document.getElementById(id)?.dispatchEvent(new window.CustomEvent("sheet-close", { detail: onClosed }));
}

// Record details and forms stay in the page; only auxiliary selectors are modal.
export default function Sheet({ id, open = true, title, children, onClose, presentation = "detail",
  labelledBy, revealOnOpen = presentation === "page",
  wide = false, size = "default", busy = false, dirty = false, closeWarning, protectEdits = false,
  blockDuringRouteTransition = true }: SheetProps) {
  const t = useTranslations("Sheet");
  const keyboardOpen = useKeyboardOpen();
  const routeTransitionActive = useIsRouteTransitionActive();
  const transitioning = blockDuringRouteTransition && routeTransitionActive;
  const modal = presentation === "modal";
  const Heading = presentation === "page" ? "h1" : "h2";
  const [host] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  const anchorRef = useRef<HTMLDivElement>(null);
  const movingFocus = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const editFocus = useRef<HTMLElement | null>(null);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const backdropDismissedKeyboard = useRef(false);
  const baseline = useRef(new Map<Element, string>());
  const [discard, setDiscard] = useState(false);
  const latest = useRef({ busy, dirty, discard, onClose, closeWarning, protectEdits });
  useLayoutEffect(() => { latest.current = { busy, dirty, discard, onClose, closeWarning, protectEdits }; });

  const hasUnsavedChanges = () => latest.current.dirty || Boolean(latest.current.closeWarning) ||
    (latest.current.protectEdits && [...(panelRef.current?.querySelectorAll<Control>(draftControls) ?? [])]
      .some((field) => controlValue(field) !== (baseline.current.get(field) ?? controlDefaultValue(field))));
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  useLayoutEffect(() => { hasUnsavedChangesRef.current = hasUnsavedChanges; });

  const keepEditing = () => {
    afterClose.current = undefined;
    setDiscard(false);
    requestAnimationFrame(() => editFocus.current?.isConnected && editFocus.current.focus({ preventScroll: true }));
  };
  const completeClose = () => {
    const followup = afterClose.current;
    afterClose.current = undefined;
    withConfirmedClose(() => {
      latest.current.onClose();
      followup?.();
    });
  };
  const requestClose = () => {
    const state = latest.current;
    if (state.busy) return;
    if (state.discard) { keepEditing(); return; }
    if (hasUnsavedChangesRef.current()) {
      editFocus.current = document.activeElement as HTMLElement;
      setDiscard(true);
    } else completeClose();
  };
  const requestCloseRef = useRef(requestClose);
  useLayoutEffect(() => { requestCloseRef.current = requestClose; });

  useLayoutEffect(() => {
    if (!open) return;
    return registerNavigationGuard({
      hasPendingWork: () => latest.current.busy || hasUnsavedChangesRef.current(),
      confirmLeave: () => !latest.current.busy && (!hasUnsavedChangesRef.current() ||
        window.confirm(latest.current.closeWarning ?? t("unsaved"))),
    });
  }, [open, t]);

  useLayoutEffect(() => {
    if (!open || !host) return;
    host.style.display = "contents";
    (modal ? document.body : anchorRef.current)?.appendChild(host);
    movingFocus.current?.focus({ preventScroll: true });
    movingFocus.current = null;
    return () => {
      movingFocus.current = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      host.remove();
    };
  }, [host, open, modal]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // Safari pointer activation need not focus the button. Its aria-controls
    // relationship is a more reliable return target than the page's old focus.
    const trigger = id ? [...document.querySelectorAll<HTMLElement>("[aria-controls]")]
      .find((element) => element.getAttribute("aria-controls")?.split(/\s+/).includes(id) &&
        !host?.contains(element) && canRestoreFocus(element, true)) : undefined;
    const opener = trigger ?? document.activeElement as HTMLElement | null;
    baseline.current.clear();
    panel?.querySelectorAll<Control>(draftControls).forEach((field) => baseline.current.set(field, controlValue(field)));
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (active !== document.body && active?.isConnected && !panel?.contains(active)) return;
      queueMicrotask(() => {
        // Restore only after the closed panel has left the document.
        if (document.activeElement !== document.body && document.activeElement?.isConnected) return;
        const remainingSheet = [...document.querySelectorAll<HTMLElement>(".product-sheet")].at(-1);
        const target = canRestoreFocus(opener) ? opener
          : remainingSheet?.querySelector<HTMLElement>("button:not(:disabled)") ?? document.getElementById("main-content");
        restoreOverlayFocus(target);
      });
    };
  }, [open, id, host]);

  useLayoutEffect(() => {
    // A route-owned sheet can mount while hidden by the loading overlay.
    // Focus it when that overlay releases, after the panel becomes available.
    if (open && !transitioning && !host?.contains(document.activeElement)) {
      closeRef.current?.focus({ preventScroll: true });
    }
    if (open && !transitioning && revealOnOpen) panelRef.current?.scrollIntoView?.({ block: "start" });
  }, [open, transitioning, host, revealOnOpen]);

  useLayoutEffect(() => {
    if (open) return;
    setDiscard(false);
  }, [open]);

  useLayoutEffect(() => {
    if (discard) continueRef.current?.focus({ preventScroll: true });
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

  useLayoutEffect(() => {
    if (!open || !modal || !keyboardOpen || transitioning) return;
    let frame = 0;
    const revealInput = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const body = bodyRef.current;
        const panel = panelRef.current;
        const input = document.activeElement;
        if (!body || !panel || !(input instanceof HTMLElement) || !body.contains(input)) return;
        const visible = body.getBoundingClientRect();
        const top = visible.top;
        const field = input.getBoundingClientRect();
        if (field.top < top + 12) body.scrollTop += field.top - top - 12;
        else if (field.bottom > visible.bottom - 12) {
          body.scrollTop += Math.min(field.top - top - 12, field.bottom - visible.bottom + 12);
        }
      });
    };
    revealInput();
    const body = bodyRef.current;
    body?.addEventListener("focusin", revealInput);
    window.visualViewport?.addEventListener("resize", revealInput);
    return () => {
      cancelAnimationFrame(frame);
      body?.removeEventListener("focusin", revealInput);
      window.visualViewport?.removeEventListener("resize", revealInput);
    };
  }, [open, modal, keyboardOpen, transitioning]);

  useLayoutEffect(() => {
    if (!open || !modal || transitioning || !host) return;
    const layer = layerRef.current;
    if (!layer) return;
    const unlock = lockModalBackground(host);
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const panel = panelRef.current;
      if (event.defaultPrevented || !panel ||
        [...document.querySelectorAll('.product-sheet-layer[data-modal="true"]:not([hidden])')].at(-1) !== layer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"], summary')]
        .filter((element) => {
          const collapsed = element.closest("details:not([open])");
          return !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getAttribute("type") !== "hidden" &&
            getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden" &&
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
      unlock();
    };
  }, [open, modal, transitioning, host]);

  if (!open || !host) return null;
  const isBackdrop = (target: EventTarget) => target === layerRef.current || target === layerRef.current?.firstElementChild;
  const content = (
    <div ref={layerRef} className="product-sheet-layer" data-modal={modal} data-transitioning={transitioning} inert={transitioning || undefined} hidden={transitioning}
      onPointerDown={(event) => {
        backdropDismissedKeyboard.current = modal && keyboardOpen && isBackdrop(event.target);
        if (!backdropDismissedKeyboard.current) return;
        // Consume this gesture before native blur changes the viewport. Closing
        // the keyboard must not also replace the form with a discard panel.
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
      onPointerCancel={() => { backdropDismissedKeyboard.current = false; }}
      onClick={(event) => {
        if (!modal || !isBackdrop(event.target)) return;
        if (backdropDismissedKeyboard.current || keyboardOpen) {
          backdropDismissedKeyboard.current = false;
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          return;
        }
        requestClose();
      }}>
      <div className="product-sheet-viewport">
      <div id={id} ref={panelRef} className="product-sheet" data-wide={wide} data-size={size} role={modal ? "dialog" : "region"} aria-modal={modal || undefined} data-presentation={presentation}
        aria-labelledby={labelledBy && !modal ? labelledBy : titleId} aria-busy={busy} tabIndex={-1}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
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
        {(!labelledBy || modal) && <header className="product-sheet-header">
          <Heading id={titleId}>{title}</Heading>
          <Button ref={closeRef} variant="ghost" onClick={requestClose} disabled={busy}
            aria-label={presentation === "page" ? t("backToList") : t("close")}
            aria-expanded={modal || presentation === "page" ? undefined : true} aria-controls={`${titleId}-body`}>
            {presentation === "page" ? t("backToList") : <Icon name={modal ? "close" : "chevron-down"} className={modal ? undefined : "rotate-180"} size={20} />}
          </Button>
        </header>}
        {discard && <div className="product-sheet-discard" role="group" aria-label={closeWarning ?? t("unsaved")}>
          <p>{closeWarning ?? t("unsaved")}</p>
          <Button ref={continueRef} onClick={keepEditing}>{t("continue")}</Button>
          <Button variant="outline" onClick={completeClose} disabled={busy}>{t("discard")}</Button>
        </div>}
        <div ref={bodyRef} id={`${titleId}-body`} className="product-sheet-body" hidden={discard}>{children}</div>
      </div>
      </div>
    </div>);
  return <><div ref={anchorRef} style={{ display: "contents" }} />{createPortal(content, host)}</>;
}
