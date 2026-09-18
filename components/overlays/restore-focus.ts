/** A missing opener falls back to the page landmark, without outlining the whole page. */
export function restoreOverlayFocus(target: HTMLElement | null | undefined) {
  if (target?.tagName === "MAIN" && target.dataset.overlayFocus !== "true") {
    target.dataset.overlayFocus = "true";
    target.addEventListener("blur", () => { delete target.dataset.overlayFocus; }, { once: true });
  }
  target?.focus({ preventScroll: true });
}
