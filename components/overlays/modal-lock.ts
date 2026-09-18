// Route transitions may share ownership of an inert content surface.
const inertLocks = new Map<HTMLElement, { count: number; wasInert: boolean }>();
let scrollLocks = 0;
let unlockedOverflow = "";
let unlockedRootOverflow = "";
let unlockedModalAttribute: string | null = null;
let themeColor: HTMLMetaElement | null = null;
let unlockedThemeColor: string | null = null;

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
    // Safari can expose the document canvas behind its translucent toolbar.
    // Continue the modal surface there without moving interactive content under it.
    unlockedModalAttribute = document.documentElement.getAttribute("data-modal-open");
    document.documentElement.setAttribute("data-modal-open", "true");
    themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    unlockedThemeColor = themeColor?.getAttribute("content") ?? null;
    const surface = getComputedStyle(document.documentElement).getPropertyValue("--app-surface").trim();
    if (surface) themeColor?.setAttribute("content", surface);
  }
  const releases = [...document.body.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== layer && !["SCRIPT", "STYLE", "LINK"].includes(element.tagName))
    .map(lockInertSurface);
  return () => {
    releases.forEach((release) => release());
    if (--scrollLocks === 0) {
      document.body.style.overflow = unlockedOverflow;
      document.documentElement.style.overflow = unlockedRootOverflow;
      if (unlockedModalAttribute === null) document.documentElement.removeAttribute("data-modal-open");
      else document.documentElement.setAttribute("data-modal-open", unlockedModalAttribute);
      if (unlockedThemeColor === null) themeColor?.removeAttribute("content");
      else themeColor?.setAttribute("content", unlockedThemeColor);
      themeColor = null;
    }
  };
}
