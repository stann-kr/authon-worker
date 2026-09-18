import { useLayoutEffect, useRef, type RefObject } from "react";

// Presentation changes keep the same dialog and form nodes alive.
export function useSheetLayout(
  ref: RefObject<HTMLDialogElement | null>,
  presentation: "modal" | "detail",
  size: "default" | "wide",
  locked: boolean,
) {
  const opened = useRef(false);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const frame = document.querySelector<HTMLElement>(".preview-frame");
    const main = frame?.querySelector<HTMLElement>(".workspace-scroll");
    const header = frame?.querySelector<HTMLElement>(".workspace-header");
    const dock = frame?.querySelector<HTMLElement>(".dock-region");
    if (!dialog || !frame) return;
    const layout = () => {
      const box = (frame.querySelector(".app-shell") ?? frame).getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = Math.max(box.top, viewport?.offsetTop ?? 0);
      const bottom = Math.min(box.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
      const panelTop = Math.max(top + 12, main?.getBoundingClientRect().top ?? top);
      const panelBottom = Math.min(bottom - 12, dock?.getBoundingClientRect().top ?? bottom - 12);
      const contentWidth = frame.querySelector(".workspace-header")?.getBoundingClientRect().width ?? box.width;
      const inline = presentation === "detail" && !locked && contentWidth >= 980 && panelBottom - panelTop >= 240;
      const wide = !inline && size === "wide" && box.width >= 768;
      const width = inline ? 360 : Math.min(box.width, wide ? 800 : 560);
      const inset = box.width >= 768 && !inline ? 16 : 0;
      const height = inline ? Math.max(120, panelBottom - panelTop) : Math.max(0, bottom - top - 12 - inset);
      dialog.style.setProperty("--sheet-left", `${inline ? box.right - width - 20 : box.left + (box.width - width) / 2}px`);
      dialog.style.setProperty("--sheet-width", `${width}px`);
      dialog.style.setProperty("--sheet-bottom", `${Math.max(0, window.innerHeight - (inline ? panelBottom : bottom - inset))}px`);
      dialog.style.setProperty("--sheet-max-height", `${height}px`);
      dialog.dataset.inline = String(inline);
      dialog.dataset.wide = String(wide);
      if (!opened.current || dialog.getAttribute("aria-modal") !== String(!inline)) {
        const focus = document.activeElement as HTMLElement | null;
        const body = dialog.querySelector<HTMLElement>(".sheet-body");
        const scrollTop = body?.scrollTop ?? 0;
        const preserve = opened.current && focus && dialog.contains(focus);
        if (dialog.open) dialog.close();
        dialog.setAttribute("aria-modal", String(!inline));
        if (inline) dialog.show();
        else dialog.showModal();
        if (preserve) focus.focus({ preventScroll: true });
        if (body) body.scrollTop = scrollTop;
        opened.current = true;
      }
      main?.classList.toggle("has-detail", !!document.querySelector('dialog[open][data-inline="true"]'));
    };
    layout();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layout);
    observer?.observe(frame);
    if (header) observer?.observe(header);
    if (dock) observer?.observe(dock);
    window.addEventListener("resize", layout);
    window.visualViewport?.addEventListener("resize", layout);
    window.visualViewport?.addEventListener("scroll", layout);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", layout);
      window.visualViewport?.removeEventListener("resize", layout);
      window.visualViewport?.removeEventListener("scroll", layout);
      main?.classList.toggle("has-detail", [...document.querySelectorAll('dialog[open][data-inline="true"]')].some((other) => other !== dialog));
    };
  }, [ref, presentation, size, locked]);
}
