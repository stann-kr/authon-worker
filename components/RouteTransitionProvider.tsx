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
  shouldRegisterRouteLoadingTask,
} from "@/lib/route-loading";
import { announceRouteTransitionStart } from "@/lib/route-transition-events";
import Spinner from "./Spinner";

type TransitionPhase = "idle" | "visible" | "leaving";

interface RouteTransitionContextValue {
  isRouteTransitionActive: boolean;
  registerRouteLoadingTask: (options?: {
    startWhenIdle?: boolean;
  }) => () => void;
  startRouteTransition: (href?: string) => boolean;
}

const MINIMUM_VISIBLE_MS = 160;
const TASK_HANDOFF_GRACE_MS = 80;
const EXIT_DURATION_MS = 140;
const TRANSITION_TIMEOUT_MS = 8_000;

const RouteTransitionContext = createContext<RouteTransitionContextValue | null>(
  null,
);

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("Common");
  const pathname = usePathname();
  const previousPathnameRef = useRef(pathname);
  const phaseRef = useRef<TransitionPhase>("idle");
  const visibleAtRef = useRef(0);
  const completionTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [loadingTracker] = useState(createRouteLoadingTracker);

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
    for (const timerRef of [completionTimerRef, exitTimerRef, safetyTimerRef]) {
      clearTimer(timerRef);
    }
  }, [clearTimer]);

  const finishTransition = useCallback(() => {
    updatePhase("leaving");
    exitTimerRef.current = window.setTimeout(() => {
      updatePhase("idle");
      exitTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }, [updatePhase]);

  const showLoading = useCallback(() => {
    clearTimer(completionTimerRef);

    if (phaseRef.current === "idle" || phaseRef.current === "leaving") {
      clearTimer(exitTimerRef);
      visibleAtRef.current = performance.now();
      updatePhase("visible");
    }
  }, [clearTimer, updatePhase]);

  const scheduleCompletion = useCallback(() => {
    if (
      phaseRef.current !== "visible" ||
      loadingTracker.hasPendingWork()
    ) {
      return;
    }

    clearTimer(completionTimerRef);
    const elapsed = performance.now() - visibleAtRef.current;
    const remainingMinimum = Math.max(0, MINIMUM_VISIBLE_MS - elapsed);

    completionTimerRef.current = window.setTimeout(() => {
      completionTimerRef.current = null;
      if (
        phaseRef.current === "visible" &&
        !loadingTracker.hasPendingWork()
      ) {
        finishTransition();
      }
    }, Math.max(TASK_HANDOFF_GRACE_MS, remainingMinimum));
  }, [clearTimer, finishTransition, loadingTracker]);

  const reconcileLoading = useCallback(() => {
    if (loadingTracker.hasPendingWork()) {
      showLoading();
      return;
    }

    scheduleCompletion();
  }, [loadingTracker, scheduleCompletion, showLoading]);

  const registerRouteLoadingTask = useCallback((options?: {
    startWhenIdle?: boolean;
  }) => {
    if (!shouldRegisterRouteLoadingTask(
      options?.startWhenIdle ?? true,
      phaseRef.current === "visible",
    )) {
      return () => {};
    }

    const releaseTask = loadingTracker.beginTask();
    reconcileLoading();

    return () => {
      releaseTask();
      reconcileLoading();
    };
  }, [loadingTracker, reconcileLoading]);

  const startRouteTransition = useCallback(
    (href?: string) => {
      if (phaseRef.current !== "idle") {
        return false;
      }

      if (href) {
        const target = new URL(href, window.location.href);
        if (
          target.origin !== window.location.origin ||
          target.pathname === window.location.pathname
        ) {
          return true;
        }
      }

      clearTimers();
      loadingTracker.startRoute();
      announceRouteTransitionStart();
      reconcileLoading();
      safetyTimerRef.current = window.setTimeout(() => {
        safetyTimerRef.current = null;
        loadingTracker.commitRoute();
        reconcileLoading();
      }, TRANSITION_TIMEOUT_MS);
      return true;
    },
    [clearTimers, loadingTracker, reconcileLoading],
  );

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;

    clearTimer(safetyTimerRef);
    loadingTracker.commitRoute();
    reconcileLoading();
  }, [clearTimer, loadingTracker, pathname, reconcileLoading]);

  useEffect(() => clearTimers, [clearTimers]);

  return (
    <RouteTransitionContext.Provider
      value={{
        isRouteTransitionActive: phase !== "idle",
        registerRouteLoadingTask,
        startRouteTransition,
      }}
    >
      {children}
      {phase !== "idle" && (
        <div
          className="route-transition-overlay"
          data-state={phase}
          aria-busy={phase === "visible"}
        >
          <Spinner mode="content" text={t("loading")} />
        </div>
      )}
    </RouteTransitionContext.Provider>
  );
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
 * 인증, 베뉴 준비, 운영 데이터 조회처럼 화면 준비에 필요한 작업을
 * 현재 route loading cycle에 등록합니다.
 */
export function useRouteLoadingTask(isLoading: boolean) {
  useLoadingTask(isLoading, true);
}

/**
 * 목록처럼 화면 내부에서 다시 조회할 수 있는 작업입니다.
 * route loading 중에는 목적지 준비에 합류하고, 화면이 열린 뒤에는
 * 전체 overlay를 새로 띄우지 않아 section 자체의 loading UI를 유지합니다.
 */
export function useSectionLoadingTask(isLoading: boolean) {
  useLoadingTask(isLoading, false);
}

function useLoadingTask(isLoading: boolean, startWhenIdle: boolean) {
  const { registerRouteLoadingTask } = useRouteTransition();

  useLayoutEffect(() => {
    if (!isLoading) return;
    return registerRouteLoadingTask({ startWhenIdle });
  }, [isLoading, registerRouteLoadingTask, startWhenIdle]);
}
