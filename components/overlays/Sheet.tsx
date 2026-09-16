"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import Button from "../Button";
import Icon from "../Icon";

interface SheetProps {
  open?: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  presentation?: "modal" | "detail";
  wide?: boolean;
  busy?: boolean;
  dirty?: boolean;
  protectEdits?: boolean;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const controlValue = (field: Control) =>
  field instanceof window.HTMLInputElement && ["checkbox", "radio"].includes(field.type)
    ? String(field.checked) : field.value;

const modalLocks = new Map<HTMLElement, { count: number; wasInert: boolean }>();
let scrollLocks = 0;
let unlockedOverflow = "";
function lockBackground(shell: HTMLElement | null) {
  if (scrollLocks++ === 0) { unlockedOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
  if (shell) {
    const lock = modalLocks.get(shell) ?? { count: 0, wasInert: shell.hasAttribute("inert") };
    lock.count++;
    modalLocks.set(shell, lock);
    shell.setAttribute("inert", "");
  }
  return () => {
    if (--scrollLocks === 0) document.body.style.overflow = unlockedOverflow;
    const lock = shell && modalLocks.get(shell);
    if (shell && lock && --lock.count === 0) {
      if (!lock.wasInert) shell.removeAttribute("inert");
      modalLocks.delete(shell);
    }
  };
}

// The same panel and form stay mounted when the available workspace changes.
export default function Sheet({ open = true, title, children, onClose, presentation = "modal",
  wide = false, busy = false, dirty = false, protectEdits = false }: SheetProps) {
  const t = useTranslations("Sheet");
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
    const hasChangedFields = protectEdits && [...(panelRef.current?.querySelectorAll<Control>("input, select, textarea") ?? [])]
      .some((field) => controlValue(field) !== (baseline.current.get(field) ?? ""));
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
    panel?.querySelectorAll<Control>("input, select, textarea").forEach((field) => baseline.current.set(field, controlValue(field)));
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (active !== document.body && active?.isConnected && !panel?.contains(active)) return;
      queueMicrotask(() => {
        // Wait for this layer's inert/scroll cleanup before restoring focus.
        if (document.activeElement !== document.body && document.activeElement?.isConnected) return;
        const target = opener?.isConnected && !opener.closest("[inert]") && !opener.matches(":disabled")
          ? opener : document.getElementById("main-content");
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
    const measure = () => {
      const width = main?.getBoundingClientRect().width ?? 0;
      const canShowInline = presentation === "detail" && !dirty && !edited && width >= 980 && window.innerHeight >= 480;
      setInline(canShowInline);
      main?.classList.toggle("workspace-has-detail", canShowInline);
      if (panelRef.current && main) {
        panelRef.current.style.setProperty("--sheet-right", `${Math.max(16, window.innerWidth - main.getBoundingClientRect().right + 24)}px`);
        panelRef.current.style.setProperty("--sheet-top", `${Math.max(16, header?.getBoundingClientRect().bottom ?? 72) + 16}px`);
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (main) observer?.observe(main);
    if (header) observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); main?.classList.remove("workspace-has-detail"); };
  }, [open, presentation, dirty, edited]);

  useLayoutEffect(() => {
    if (!open) return;
    const shell = document.querySelector<HTMLElement>(".workspace-shell") ?? document.getElementById("main-content");
    const unlock = !inline ? lockBackground(shell) : undefined;
    const keydown = (event: KeyboardEvent) => {
      // A confirmation opened from this sheet owns its own keyboard scope.
      if (event.defaultPrevented || document.querySelector(".app-dialog-backdrop")) return;
      const panel = panelRef.current;
      if (![...document.querySelectorAll(".product-sheet-layer")].at(-1)?.contains(panel)) return;
      if (!panel || (inline && !panel.contains(document.activeElement))) return;
      if (event.key === "Escape") { event.preventDefault(); requestCloseRef.current(); }
      if (event.key !== "Tab" || inline) return;
      const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        .filter((element) => !element.closest("[hidden], [inert]"));
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
  }, [open, inline]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="product-sheet-layer" data-inline={inline} onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={panelRef} className="product-sheet" data-wide={wide} role="dialog" aria-modal={!inline}
        aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
        onChangeCapture={() => {
          if (!protectEdits) return;
          setEdited([...panelRef.current!.querySelectorAll<Control>("input, select, textarea")].some((field) =>
            controlValue(field) !== (baseline.current.get(field) ?? "")));
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
