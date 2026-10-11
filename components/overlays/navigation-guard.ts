type NavigationGuard = {
  hasPendingWork: () => boolean;
  confirmLeave: () => boolean;
};

const guards = new Set<NavigationGuard>();
let approvedNavigation = 0;
const historyKey = "__authonHistoryIndex";

export function registerNavigationGuard(guard: NavigationGuard) {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function confirmWorkspaceNavigation() {
  return approvedNavigation > 0 || [...guards].reverse().every((guard) => guard.confirmLeave());
}

export function withConfirmedClose(run: () => void) {
  approvedNavigation += 1;
  try { run(); }
  finally { approvedNavigation -= 1; }
}

/** Logout may navigate after its request completes; do not ask twice on unload. */
export async function withApprovedNavigation<T>(run: () => Promise<T>): Promise<T> {
  approvedNavigation += 1;
  try { return await run(); }
  finally { approvedNavigation -= 1; }
}

/** Keep the router on its current entry when browser back/forward is cancelled. */
export function installNavigationProtection() {
  const history = window.history;
  const readIndex = (state: unknown): number | null => {
    if (!state || typeof state !== "object") return null;
    const value = (state as Record<string, unknown>)[historyKey];
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  };
  let currentIndex = readIndex(history.state) ?? 0;
  let restoring = false;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const indexed = (state: unknown, index: number) => ({
    ...(state && typeof state === "object" ? state : {}), [historyKey]: index,
  });
  originalReplace.call(history, indexed(history.state, currentIndex), "");
  const push: History["pushState"] = function (this: History, state, unused, url) {
    const next = currentIndex + 1;
    originalPush.call(this, indexed(state, next), unused, url);
    currentIndex = next;
  };
  const replace: History["replaceState"] = function (this: History, state, unused, url) {
    originalReplace.call(this, indexed(state, currentIndex), unused, url);
  };
  history.pushState = push;
  history.replaceState = replace;
  const onPopState = (event: PopStateEvent) => {
    if (restoring) {
      restoring = false;
      event.stopImmediatePropagation();
      return;
    }
    const next = readIndex(event.state);
    // Cross-document entries are protected by beforeunload instead.
    if (next === null || next === currentIndex) return;
    if (confirmWorkspaceNavigation()) { currentIndex = next; return; }
    event.stopImmediatePropagation();
    restoring = true;
    history.go(currentIndex - next);
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (approvedNavigation > 0 || ![...guards].some((guard) => guard.hasPendingWork())) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("popstate", onPopState, true);
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    window.removeEventListener("popstate", onPopState, true);
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
  };
}
