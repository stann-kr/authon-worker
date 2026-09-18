// Route transitions may share ownership of an inert content surface.
const inertLocks = new Map<HTMLElement, { count: number; wasInert: boolean }>();
let scrollLocks = 0;
let unlockedOverflow = "";
let unlockedRootOverflow = "";

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

export function lockModalBackground(layer: HTMLElement) {
  if (scrollLocks++ === 0) {
    unlockedOverflow = document.body.style.overflow;
    unlockedRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }
  const releases = [...document.body.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== layer && !["SCRIPT", "STYLE", "LINK"].includes(element.tagName))
    .map(lockInertSurface);
  return () => {
    releases.forEach((release) => release());
    if (--scrollLocks === 0) {
      document.body.style.overflow = unlockedOverflow;
      document.documentElement.style.overflow = unlockedRootOverflow;
    }
  };
}
