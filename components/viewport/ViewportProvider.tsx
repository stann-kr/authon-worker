"use client";

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

const KeyboardContext = createContext(false);
export const useKeyboardOpen = () => useContext(KeyboardContext);

function isTextEntry(element: Element | null) {
  return element instanceof HTMLElement && (
    element.isContentEditable ||
    (element instanceof window.HTMLTextAreaElement && !element.readOnly && !element.disabled) ||
    (element instanceof window.HTMLInputElement && !element.readOnly && !element.disabled &&
      ["text", "search", "email", "url", "tel", "password", "number"].includes(element.type))
  );
}

/** One viewport owner for portal sheets and the workspace chrome. */
export default function ViewportProvider({ children }: { children: ReactNode }) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let baseline = window.innerHeight;
    let width = window.innerWidth;
    let open = false;
    let frame = 0;

    const measure = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const unscaled = Math.abs((viewport?.scale ?? 1) - 1) < 0.05;
      const editing = isTextEntry(document.activeElement);
      // Rebase on orientation/layout changes, not on the keyboard's height.
      if (Math.abs(window.innerWidth - width) > 1) {
        baseline = window.innerHeight;
        width = window.innerWidth;
      }
      if (!open && !editing) baseline = window.innerHeight;
      // Wait for the keyboard's closing movement to settle before returning chrome.
      const threshold = open ? 64 : Math.max(120, baseline * 0.18);
      const obscured = Math.max(window.innerHeight, root.clientHeight) - height;
      const resizedTouchViewport = window.matchMedia("(any-pointer: coarse)").matches && baseline - height > threshold;
      // Browser toolbars and pinch zoom must not be mistaken for a keyboard.
      open = unscaled && (obscured > threshold || resizedTouchViewport) && (editing || open);
      root.style.setProperty("--app-viewport-height", `${height}px`);
      root.style.setProperty("--app-viewport-top", `${top}px`);
      root.dataset.keyboardOpen = String(open);
      setKeyboardOpen(open);
      if (!open && unscaled && !editing) baseline = window.innerHeight;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    document.addEventListener("focusin", measure);
    // Wait until focus has actually moved, including input-to-input changes.
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", schedule);
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-top");
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return <KeyboardContext value={keyboardOpen}>{children}</KeyboardContext>;
}
