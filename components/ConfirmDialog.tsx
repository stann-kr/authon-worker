"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Button from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  tone?: "danger" | "primary";
  children?: ReactNode;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  isLoading = false,
  tone = "danger",
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const isLoadingRef = useRef(isLoading);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
    isLoadingRef.current = isLoading;
  }, [isLoading, onCancel]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const mainContent = document.getElementById("main-content");
    const mainContentWasInert = mainContent?.hasAttribute("inert") ?? false;
    document.body.style.overflow = "hidden";
    if (mainContent && !mainContentWasInert) {
      mainContent.setAttribute("inert", "");
    }
    cancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!isLoadingRef.current) onCancelRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (mainContent && !mainContentWasInert) {
        mainContent.removeAttribute("inert");
      }
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="app-dialog-backdrop fixed inset-0 z-[var(--app-z-dialog)] flex items-center justify-center bg-canvas/80 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-busy={isLoading}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="app-dialog-panel max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto border border-border-strong bg-canvas p-5 sm:p-6"
      >
        <h2 id={titleId} className="type-panel-title">
          {title}
        </h2>
        <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-text-muted">
          {description}
        </p>
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
