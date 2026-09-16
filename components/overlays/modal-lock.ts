// Sheets, confirmations and the workspace menu can overlap and close in either order.
const inertLocks = new Map<HTMLElement, { count: number; wasInert: boolean }>();
let scrollLocks = 0;
let unlockedOverflow = "";

export function lockModalBackground(surface: HTMLElement | null) {
  if (scrollLocks++ === 0) {
    unlockedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  if (surface) {
    const lock = inertLocks.get(surface) ?? { count: 0, wasInert: surface.hasAttribute("inert") };
    lock.count++;
    inertLocks.set(surface, lock);
    surface.setAttribute("inert", "");
  }
  return () => {
    if (--scrollLocks === 0) document.body.style.overflow = unlockedOverflow;
    const lock = surface && inertLocks.get(surface);
    if (surface && lock && --lock.count === 0) {
      if (!lock.wasInert) surface.removeAttribute("inert");
      inertLocks.delete(surface);
    }
  };
}
