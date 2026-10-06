"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createRouteLoadingTracker,
  getRouteLoadingCompletionDelay,
} from "@/lib/route-loading";
import { announceRouteTransitionStart } from "@/lib/route-transition-events";
import Spinner from "./Spinner";
import { lockInertSurface } from "./overlays/modal-lock";
import { installNavigationProtection } from "./overlays/navigation-guard";
import { beginBrowserLoading, observeBrowserPerformance } from "@/lib/observability/browser-performance";

/**
 * pending: 화면은 잠갔지만 overlay는 아직 그리지 않은 짧은 유예 구간.
 * 빠른 이동은 여기서 바로 끝나 spinner를 깜빡이지 않는다.
 */
type TransitionPhase = "idle" | "pending" | "visible" | "leaving";

interface RouteTransitionContextValue {
  isRouteTransitionActive: boolean;
  /** True only once the loading overlay is painted; the page is locked earlier. */
  isRouteOverlayVisible: boolean;
  registerRouteLoadingTask: () => () => void;
  startRouteTransition: (href?: string) => boolean;
  requestFocusRestore: (
    targetRef: { current: HTMLElement | null },
  ) => () => void;
}

const SHOW_DELAY_MS = 120;
const MINIMUM_VISIBLE_MS = 160;
const EXIT_DURATION_MS = 140;
const TRANSITION_TIMEOUT_MS = 8_000;

const RouteTransitionContext = createContext<RouteTransitionContextValue | null>(
  null,
);

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(installNavigationProtection, []);
  const t = useTranslations("Common");
  const pathname = usePathname();
  const previousPathnameRef = useRef(pathname);
  const phaseRef = useRef<TransitionPhase>("idle");
  const visibleAtRef = useRef(0);
  const finishPerformanceRef = useRef<ReturnType<typeof beginBrowserLoading> | null>(null);
  const didTransitionTimeoutRef = useRef(false);
  const completionTimerRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  // The first hydration continues the server-rendered spinner, so it is shown without delay.
  const hasMountedRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);
  const routeRequestIdRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const requestedFocusRef = useRef<{
    id: number;
    targetRef: { current: HTMLElement | null };
  } | null>(null);
  const focusRequestIdRef = useRef(0);
  const focusFrameRef = useRef<number | null>(null);
  const focusFrameRequestIdRef = useRef<number | null>(null);
  const focusFrameIsRouteRestoreRef = useRef(false);
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [fadesIn, setFadesIn] = useState(false);
  const [loadingTracker] = useState(() => createRouteLoadingTracker(pathname));

  const updatePhase = useCallback((nextPhase: TransitionPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearTimer = useCallback(
    (timerRef: { current: number | null }) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const clearTimers = useCallback(() => {
    for (const timerRef of [completionTimerRef, exitTimerRef, safetyTimerRef, revealTimerRef]) {
      clearTimer(timerRef);
    }
  }, [clearTimer]);

  const clearFocusFrame = useCallback(() => {
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
      focusFrameRequestIdRef.current = null;
      focusFrameIsRouteRestoreRef.current = false;
    }
  }, []);

  const focusRequestedOrMain = useCallback((requested: {
    id: number;
    targetRef: { current: HTMLElement | null };
  } | null) => {
    if (requested && requestedFocusRef.current?.id === requested.id) {
      requestedFocusRef.current = null;
      const target = requested.targetRef.current;
      if (target?.isConnected && !target.closest("[inert]")) {
        target.focus({ preventScroll: true });
        return;
      }
    }
    const mainContent = contentRef.current?.querySelector<HTMLElement>("#main-content");
    if (!mainContent || mainContent.closest("[inert]")) return;
    mainContent.dataset.routeFocus = "true";
    mainContent.addEventListener(
      "blur",
      () => delete mainContent.dataset.routeFocus,
      { once: true },
    );
    mainContent.focus({ preventScroll: true });
  }, []);

  const scheduleFocusRestore = useCallback((requested: {
    id: number;
    targetRef: { current: HTMLElement | null };
  } | null, isRouteRestore = false) => {
    clearFocusFrame();
    focusFrameRequestIdRef.current = requested?.id ?? 0;
    focusFrameIsRouteRestoreRef.current = isRouteRestore;
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      focusFrameRequestIdRef.current = null;
      focusFrameIsRouteRestoreRef.current = false;
      if (phaseRef.current !== "idle") return;
      const active = document.activeElement;
      if (isRouteRestore && active instanceof HTMLElement && active !== document.body &&
        active.isConnected && active !== overlayRef.current && !active.closest("[inert]")) {
        requestedFocusRef.current = null;
        return;
      }
      focusRequestedOrMain(requested);
    });
  }, [clearFocusFrame, focusRequestedOrMain]);

  const requestFocusRestore = useCallback((targetRef: {
    current: HTMLElement | null;
  }) => {
    if (!loadingTracker.isCurrentRoute(pathname)) return () => {};
    requestedFocusRef.current = {
      id: ++focusRequestIdRef.current,
      targetRef,
    };

    if (phaseRef.current === "idle") {
      const inheritRouteRestore =
        focusFrameIsRouteRestoreRef.current || shouldRestoreFocusRef.current;
      scheduleFocusRestore(requestedFocusRef.current, inheritRouteRestore);
    }
    const requestId = requestedFocusRef.current.id;
    return () => {
      if (requestedFocusRef.current?.id !== requestId) return;
      requestedFocusRef.current = null;
      if (
        focusFrameRequestIdRef.current === requestId &&
        !focusFrameIsRouteRestoreRef.current
      ) clearFocusFrame();
    };
  }, [clearFocusFrame, loadingTracker, pathname, scheduleFocusRestore]);

  const finishPerformance = useCallback(() => {
    finishPerformanceRef.current?.(didTransitionTimeoutRef.current ? "timeout" : "ready");
    finishPerformanceRef.current = null;
  }, []);

  const finishTransition = useCallback(() => {
    updatePhase("leaving");
    exitTimerRef.current = window.setTimeout(() => {
      finishPerformance();
      updatePhase("idle");
      exitTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }, [finishPerformance, updatePhase]);

  const revealOverlay = useCallback((fade?: boolean) => {
    clearTimer(revealTimerRef);
    if (fade !== undefined) setFadesIn(fade);
    visibleAtRef.current = performance.now();
    updatePhase("visible");
  }, [clearTimer, updatePhase]);

  const showLoading = useCallback(() => {
    clearTimer(completionTimerRef);

    if (phaseRef.current === "leaving") {
      // The overlay is still painted, so keep it instead of hiding and delaying again.
      clearTimer(exitTimerRef);
      finishPerformanceRef.current?.("interrupted");
      finishPerformanceRef.current = beginBrowserLoading();
      didTransitionTimeoutRef.current = false;
      revealOverlay();
      return;
    }
    if (phaseRef.current !== "idle") return;

    finishPerformanceRef.current?.("interrupted");
    finishPerformanceRef.current = beginBrowserLoading();
    didTransitionTimeoutRef.current = false;
    if (!hasMountedRef.current) {
      revealOverlay(false);
      return;
    }
    updatePhase("pending");
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null;
      if (phaseRef.current === "pending") revealOverlay(true);
    }, SHOW_DELAY_MS);
  }, [clearTimer, revealOverlay, updatePhase]);

  const scheduleCompletion = useCallback(() => {
    if (loadingTracker.hasPendingWork()) return;

    if (phaseRef.current === "pending") {
      // Finished before the overlay was due: release the page without painting it.
      clearTimer(revealTimerRef);
      finishPerformance();
      updatePhase("idle");
      return;
    }
    if (phaseRef.current !== "visible") return;

    clearTimer(completionTimerRef);
    const elapsed = performance.now() - visibleAtRef.current;
    const completionDelay = getRouteLoadingCompletionDelay(
      elapsed,
      MINIMUM_VISIBLE_MS,
    );

    completionTimerRef.current = window.setTimeout(() => {
      completionTimerRef.current = null;
      if (
        phaseRef.current === "visible" &&
        !loadingTracker.hasPendingWork()
      ) {
        finishTransition();
      }
    }, completionDelay);
  }, [clearTimer, finishPerformance, finishTransition, loadingTracker, updatePhase]);

  const reconcileLoading = useCallback(() => {
    if (loadingTracker.hasPendingWork()) {
      showLoading();
      return;
    }

    scheduleCompletion();
  }, [loadingTracker, scheduleCompletion, showLoading]);

  const registerRouteLoadingTask = useCallback(() => {
    const releaseTask = loadingTracker.beginTask(pathname);
    reconcileLoading();

    return () => {
      releaseTask();
      reconcileLoading();
    };
  }, [loadingTracker, pathname, reconcileLoading]);

  const startRouteTransition = useCallback(
    (href?: string) => {
      const target = href ? new URL(href, window.location.href) : null;
      if (target && target.origin !== window.location.origin) return true;
      const isCurrentPath = target?.pathname === previousPathnameRef.current;
      if (isCurrentPath && phaseRef.current === "idle") return true;

      clearTimer(completionTimerRef);
      clearTimer(safetyTimerRef);
      clearFocusFrame();
      requestedFocusRef.current = null;
      const requestId = ++routeRequestIdRef.current;
      loadingTracker.startRoute(target?.pathname ?? pathname);
      if (isCurrentPath) loadingTracker.commitRoute(target.pathname);
      reconcileLoading();
      if (isCurrentPath) return true;
      safetyTimerRef.current = window.setTimeout(() => {
        if (requestId !== routeRequestIdRef.current) return;
        safetyTimerRef.current = null;
        didTransitionTimeoutRef.current = true;
        loadingTracker.commitRoute();
        reconcileLoading();
      }, TRANSITION_TIMEOUT_MS);
      return true;
    },
    [clearFocusFrame, clearTimer, loadingTracker, pathname, reconcileLoading],
  );

  useLayoutEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;

    // Only invalidate outgoing requests once navigation commits. A pending move
    // can be cancelled by choosing the current page, whose reads must still finish.
    announceRouteTransitionStart();
    if (!loadingTracker.commitRoute(pathname)) return;
    clearTimer(safetyTimerRef);
    reconcileLoading();
  }, [clearTimer, loadingTracker, pathname, reconcileLoading]);

  useEffect(() => {
    const handlePopState = () => startRouteTransition(window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [startRouteTransition]);

  useEffect(observeBrowserPerformance, []);

  // Child layout effects of the first commit run before this, so initial work shows at once.
  useEffect(() => {
    hasMountedRef.current = true;
  }, []);

  useEffect(
    () => () => {
      finishPerformanceRef.current?.("interrupted");
      finishPerformanceRef.current = null;
      clearTimers();
      clearFocusFrame();
    },
    [clearFocusFrame, clearTimers],
  );

  useEffect(() => {
    if (phase === "pending") {
      shouldRestoreFocusRef.current = true;
      return;
    }

    if (phase === "visible") {
      shouldRestoreFocusRef.current = true;
      const active = document.activeElement;
      if (!active || active === document.body || active.closest("[inert]")) {
        overlayRef.current?.focus({ preventScroll: true });
      }
      return;
    }

    if (phase === "idle" && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false;
      const requested = requestedFocusRef.current;
      scheduleFocusRestore(requested, true);
    }
  }, [phase, scheduleFocusRestore]);

  useLayoutEffect(() => {
    if (phase === "idle") return;
    // The overlay is absent while pending; the page is still locked meanwhile.
    const overlay = overlayRef.current;
    const content = contentRef.current;
    if (!content) return;
    let observedHeader: HTMLElement | null = null;
    const lockedSurfaces = new Map<HTMLElement, () => void>();
    const updateBounds = () => {
      // Page actions belong to the loading content; global navigation does not.
      const surfaces = new Set(content.querySelectorAll<HTMLElement>(
        "#main-content, .workspace-header-actions, .workspace-context-actions",
      ));
      for (const [surface, unlock] of lockedSurfaces) {
        if (surfaces.has(surface)) continue;
        unlock();
        lockedSurfaces.delete(surface);
      }
      for (const surface of surfaces) {
        if (lockedSurfaces.has(surface)) continue;
        if (surface.contains(document.activeElement)) overlay?.focus({ preventScroll: true });
        const previousBusy = surface.getAttribute("aria-busy");
        const unlock = lockInertSurface(surface);
        surface.setAttribute("aria-busy", "true");
        lockedSurfaces.set(surface, () => {
          unlock();
          if (previousBusy === null) surface.removeAttribute("aria-busy");
          else surface.setAttribute("aria-busy", previousBusy);
        });
      }
      if (!overlay) return;
      const header = content.querySelector<HTMLElement>(".workspace-header");
      if (header !== observedHeader) {
        resizeObserver?.disconnect();
        if (header) resizeObserver?.observe(header);
        observedHeader = header;
      }
      const bounds = header?.getBoundingClientRect();
      overlay.style.setProperty("--route-content-left", `${Math.max(0, bounds?.left ?? 0)}px`);
      overlay.style.setProperty("--route-content-top", `${Math.max(0, bounds?.bottom ?? 0)}px`);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateBounds);
    // The loading shell can be replaced before a saved sidebar preference is restored.
    const contentObserver = new MutationObserver(updateBounds);
    contentObserver.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-sidebar-collapsed"],
    });
    updateBounds();
    window.addEventListener("resize", updateBounds);
    return () => {
      contentObserver.disconnect();
      resizeObserver?.disconnect();
      for (const unlock of lockedSurfaces.values()) unlock();
      window.removeEventListener("resize", updateBounds);
    };
  }, [phase, pathname]);

  return (
    <RouteTransitionContext.Provider
      value={{
        isRouteTransitionActive: phase !== "idle",
        isRouteOverlayVisible: phase === "visible" || phase === "leaving",
        registerRouteLoadingTask,
        startRouteTransition,
        requestFocusRestore,
      }}
    >
      <div
        ref={contentRef}
        className="contents"
      >
        {children}
      </div>
      {(phase === "visible" || phase === "leaving") && (
        <div
          ref={overlayRef}
          className="route-transition-overlay"
          data-state={phase}
          data-enter={fadesIn ? "fade" : undefined}
          role="status"
          tabIndex={-1}
          aria-busy={phase === "visible"}
          aria-live="polite"
        >
          <Spinner mode="content" text={t("loading")} />
        </div>
      )}
    </RouteTransitionContext.Provider>
  );
}

/** Portal overlays share the route lock, including when rendered outside the inert page. */
export function useIsRouteTransitionActive() {
  return useContext(RouteTransitionContext)?.isRouteTransitionActive ?? false;
}

/** Lets locked surfaces stay painted until the overlay actually covers them. */
export function useIsRouteOverlayVisible() {
  return useContext(RouteTransitionContext)?.isRouteOverlayVisible ?? false;
}

export function useRouteTransition() {
  const context = useContext(RouteTransitionContext);

  if (!context) {
    throw new Error(
      "useRouteTransition must be used within RouteTransitionProvider",
    );
  }

  return context;
}

/**
 * 인증과 최초 베뉴 준비처럼 화면 진입에 필수인 작업만 등록합니다.
 * 목록·상세 조회는 각 영역의 skeleton을 사용하며 route 전환을 기다리게 하지 않습니다.
 */
export function useRouteLoadingTask(isLoading: boolean) {
  const { registerRouteLoadingTask } = useRouteTransition();

  useLayoutEffect(() => {
    if (!isLoading) return;
    return registerRouteLoadingTask();
  }, [isLoading, registerRouteLoadingTask]);
}
