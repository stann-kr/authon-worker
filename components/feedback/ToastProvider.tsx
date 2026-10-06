"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/Icon";

export const TOAST_DURATION_MS = 6000;

export interface ToastOptions {
  message: string;
  tone?: "success" | "neutral";
  /** Set false when the owner already announces the same result through its own live region. */
  announce?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  /** Runs once when this toast leaves for any reason: timeout, action, dismissal or replacement. */
  onClose?: () => void;
}

type ToastEntry = ToastOptions & { id: number };

const ToastContext = createContext<(options: ToastOptions) => void>(() => {});

/** One transient confirmation at a time; a newer action replaces the previous toast. */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastEntry | null>(null);
  const nextId = useRef(0);
  const current = useRef<ToastEntry | null>(null);

  const close = useCallback((id: number) => {
    const entry = current.current;
    if (!entry || entry.id !== id) return;
    current.current = null;
    setToast(null);
    entry.onClose?.();
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const previous = current.current;
    const entry = { ...options, id: ++nextId.current };
    current.current = entry;
    setToast(entry);
    previous?.onClose?.();
  }, []);

  useEffect(() => () => {
    const entry = current.current;
    current.current = null;
    entry?.onClose?.();
  }, []);

  return <ToastContext.Provider value={show}>
    {children}
    <div className="app-toast-region" role="status" aria-live={toast?.announce === false ? "off" : "polite"} aria-atomic="true">
      {toast && <Toast key={toast.id} toast={toast} onClose={close} />}
    </div>
  </ToastContext.Provider>;
}

function Toast({ toast, onClose: closeToast }: { toast: ToastEntry; onClose: (id: number) => void }) {
  const t = useTranslations("Common");
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_DURATION_MS);
  const startedAt = useRef(0);
  const { id } = toast;
  const onClose = useCallback(() => closeToast(id), [closeToast, id]);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(onClose, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1200, remaining.current - (Date.now() - startedAt.current));
    };
  }, [onClose, paused]);

  const pause = useMemo(() => ({
    onPointerEnter: () => setPaused(true),
    onPointerLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: () => setPaused(false),
  }), []);

  return <div className="app-toast" data-tone={toast.tone ?? "success"} {...pause}>
    <span className="app-toast-icon" aria-hidden="true"><Icon name="check" size={14} /></span>
    <p className="app-toast-message">{toast.message}</p>
    {toast.actionLabel && toast.onAction && <button type="button" className="app-toast-action"
      onClick={() => { toast.onAction?.(); onClose(); }}>{toast.actionLabel}</button>}
    <button type="button" className="app-toast-close" aria-label={t("dismissNotice")} onClick={onClose}>
      <Icon name="close" size={16} />
    </button>
  </div>;
}
