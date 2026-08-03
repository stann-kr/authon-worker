"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import Spinner from "./Spinner";

type TransitionPhase = "idle" | "visible" | "leaving";

interface RouteTransitionContextValue {
  startRouteTransition: (href?: string) => void;
}

const MINIMUM_VISIBLE_MS = 160;
const EXIT_DURATION_MS = 140;
const TRANSITION_TIMEOUT_MS = 8_000;

const RouteTransitionContext = createContext<RouteTransitionContextValue | null>(
  null,
);

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const previousPathnameRef = useRef(pathname);
  const phaseRef = useRef<TransitionPhase>("idle");
  const visibleAtRef = useRef(0);
  const completionTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<TransitionPhase>("idle");

  const updatePhase = useCallback((nextPhase: TransitionPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearTimers = useCallback(() => {
    for (const timerRef of [
      completionTimerRef,
      exitTimerRef,
      safetyTimerRef,
    ]) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  const finishTransition = useCallback(() => {
    updatePhase("leaving");
    exitTimerRef.current = window.setTimeout(() => {
      updatePhase("idle");
      exitTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }, [updatePhase]);

  const startRouteTransition = useCallback(
    (href?: string) => {
      if (href) {
        const target = new URL(href, window.location.href);
        if (
          target.origin !== window.location.origin ||
          target.pathname === window.location.pathname
        ) {
          return;
        }
      }

      clearTimers();
      visibleAtRef.current = performance.now();
      updatePhase("visible");
      safetyTimerRef.current = window.setTimeout(
        finishTransition,
        TRANSITION_TIMEOUT_MS,
      );
    },
    [clearTimers, finishTransition, updatePhase],
  );

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;

    if (phaseRef.current === "idle") return;

    clearTimers();
    const elapsed = performance.now() - visibleAtRef.current;
    const remaining = Math.max(0, MINIMUM_VISIBLE_MS - elapsed);

    completionTimerRef.current = window.setTimeout(() => {
      finishTransition();
      completionTimerRef.current = null;
    }, remaining);
  }, [clearTimers, finishTransition, pathname]);

  useEffect(() => clearTimers, [clearTimers]);

  return (
    <RouteTransitionContext.Provider value={{ startRouteTransition }}>
      {children}
      {phase !== "idle" && (
        <div
          className="route-transition-overlay"
          data-state={phase}
          aria-busy={phase === "visible"}
        >
          <Spinner mode="fullscreen" text="Loading workspace" />
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
