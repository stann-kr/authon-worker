"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Button from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  confirmDisabled?: boolean;
  tone?: "danger" | "primary";
  children?: ReactNode;
}

export default function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel,
  onConfirm, onCancel, isLoading = false, confirmDisabled = false, tone = "danger", children,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    cancelRef.current?.focus();
    return () => {
      const active = document.activeElement;
      if (active !== document.body && active?.isConnected && !panel?.contains(active)) return;
      const available = opener?.isConnected && !opener.closest("[hidden], [inert]") && !opener.matches(":disabled");
      const target = available ? opener : document.getElementById("main-content");
      if (target && !target.hasAttribute("tabindex") && target.tagName === "MAIN") target.tabIndex = -1;
      target?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return <div ref={panelRef} role="group" className="inline-confirmation" aria-busy={isLoading}
    aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      if (!isLoading) onCancel();
    }}>
    <h3 id={titleId} className="text-sm font-semibold text-text-heading">{title}</h3>
    {description && <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-text-muted">{description}</p>}
    {children && <div className="mt-4">{children}</div>}
    <div className="mt-4 flex flex-wrap justify-end gap-3">
      <Button ref={cancelRef} type="button" variant="outline" onClick={onCancel} disabled={isLoading}>{cancelLabel}</Button>
      <Button type="button" variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}
        isLoading={isLoading} disabled={confirmDisabled}>{confirmLabel}</Button>
    </div>
  </div>;
}
