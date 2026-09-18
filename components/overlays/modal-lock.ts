// Route transitions may share ownership of an inert content surface.
const inertLocks = new Map<HTMLElement, { count: number; wasInert: boolean }>();

export function lockInertSurface(surface: HTMLElement | null) {
  if (surface) {
    const lock = inertLocks.get(surface) ?? { count: 0, wasInert: surface.hasAttribute("inert") };
    lock.count++;
    inertLocks.set(surface, lock);
    surface.setAttribute("inert", "");
  }
  return () => {
    const lock = surface && inertLocks.get(surface);
    if (surface && lock && --lock.count === 0) {
      if (!lock.wasInert) surface.removeAttribute("inert");
      inertLocks.delete(surface);
    }
  };
}
