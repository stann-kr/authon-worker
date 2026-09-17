"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockModalBackground } from "../overlays/modal-lock";

export default function WorkspaceMenu({ open, motion, title, closeLabel, onClose, children }: {
  open: boolean;
  motion: boolean;
  title: string;
  closeLabel: string;
  onClose: (motion?: boolean) => void;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const visible = open || present;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (!motion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPresent(false);
      return;
    }
    // A fallback also releases focus/scroll locks if transitionend is interrupted.
    const timeout = window.setTimeout(() => setPresent(false), 220);
    return () => window.clearTimeout(timeout);
  }, [open, motion]);

  useEffect(() => {
    if (!visible) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>(".workspace-shell");
    const unlock = lockModalBackground(shell);
    closeRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current(false);
      }
      if (event.key !== "Tab") return;
      const targets = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), [tabindex="0"]',
      ) ?? []);
      const first = targets[0];
      const last = targets.at(-1);
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      unlock();
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) {
        previousFocus.focus({ preventScroll: true });
      } else {
        document.getElementById("main-content")?.focus({ preventScroll: true });
      }
    };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div className="workspace-menu-backdrop" data-state={open ? "open" : "closing"} data-motion={motion}
      inert={!open || undefined} aria-hidden={!open || undefined} onClick={(event) => {
      if (event.target === event.currentTarget) onClose(event.detail > 0);
    }}>
      <div ref={panelRef} id="workspace-all-menu" className="workspace-menu-panel"
        role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onTransitionEnd={(event) => {
          if (!open && event.target === event.currentTarget && event.propertyName === "transform") setPresent(false);
        }}>
        <header><h2 id={titleId}>{title}</h2>
          <button ref={closeRef} type="button" onClick={(event) => onClose(event.detail > 0)}>{closeLabel}</button>
        </header>
        {children}
      </div>
    </div>, document.body,
  );
}
