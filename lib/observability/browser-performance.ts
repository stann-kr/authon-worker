const STORAGE_KEY = "authon:performance";
const ROUTES = new Set(["/", "/door", "/guest", "/admin", "/auth/login", "/auth/reset-password", "/auth/setup-password"]);

export function isBrowserPerformanceEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function routeCategory(pathname: string): string {
  return ROUTES.has(pathname) ? pathname : "other";
}

/** Only fixed categories and numeric timings leave the PerformanceEntry. URLs can contain tokens. */
export function browserTimingRecord(entry: PerformanceResourceTiming, origin: string) {
  const url = new URL(entry.name);
  if (url.origin !== origin) return null;
  const isNavigation = entry.entryType === "navigation";
  if (!isNavigation && !["fetch", "xmlhttprequest"].includes(entry.initiatorType)) return null;
  const requestId = entry.serverTiming?.find((timing) => timing.name === "request")?.description;
  const middlewareMs = entry.serverTiming?.find((timing) => timing.name === "middleware")?.duration;
  return {
    event: isNavigation ? "browser.document" : "browser.request",
    route: routeCategory(url.pathname),
    kind: isNavigation ? "document" : url.searchParams.has("_rsc") ? "rsc" : "fetch",
    durationMs: entry.duration,
    ttfbMs: Math.max(0, entry.responseStart - entry.requestStart),
    downloadMs: Math.max(0, entry.responseEnd - entry.responseStart),
    transferBytes: entry.transferSize,
    ...(typeof middlewareMs === "number" && Number.isFinite(middlewareMs) ? { middlewareMs } : {}),
    ...(requestId && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(requestId) ? { requestId } : {}),
  };
}

function emit(record: object) {
  try {
    console.info(JSON.stringify(record));
  } catch {
    // Diagnostics cannot interrupt navigation or a successful mutation.
  }
}

export function observeBrowserPerformance(): () => void {
  if (!isBrowserPerformanceEnabled() || typeof PerformanceObserver === "undefined") return () => {};
  const observers: PerformanceObserver[] = [];
  for (const type of ["navigation", "resource"]) {
    try {
      const observer = new PerformanceObserver((list) => {
        if (!isBrowserPerformanceEnabled()) return;
        for (const entry of list.getEntries()) {
          try {
            const record = browserTimingRecord(entry as PerformanceResourceTiming, window.location.origin);
            if (record) emit(record);
          } catch {
            // An unsupported entry does not prevent the remaining samples.
          }
        }
      });
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      // Entry support differs by browser.
    }
  }
  return () => observers.forEach((observer) => observer.disconnect());
}

export function beginBrowserLoading(): (outcome: "ready" | "timeout" | "interrupted") => void {
  if (!isBrowserPerformanceEnabled()) return () => {};
  const start = performance.now();
  let finished = false;
  return (outcome) => {
    if (finished) return;
    finished = true;
    if (!isBrowserPerformanceEnabled()) return;
    emit({
      event: "browser.loading",
      route: routeCategory(window.location.pathname),
      durationMs: Math.round((performance.now() - start) * 100) / 100,
      outcome,
    });
  };
}
