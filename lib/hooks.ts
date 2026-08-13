import { useState, useEffect, useCallback, useRef } from "react";
import {
  createLatestRequestGuard,
  createScopedOperationGuard,
  type LatestRequestGuard,
  type ScopedOperationGuard,
} from "./latest-request";
import {
  createPollingCoordinator,
  type PollingCoordinator,
} from "./polling-coordinator";
import { subscribeToRouteTransitionStart } from "./route-transition-events";

/**
 * useState와 동일하지만 localStorage에 값을 영속화합니다.
 * SSR 환경에서도 안전하게 동작합니다.
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const valueToStore = value instanceof Function ? value(prev) : value;
        try {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
          }
        } catch (e) {
          console.warn(`useLocalStorage: failed to save key "${key}"`, e);
        }
        return valueToStore;
      });
    },
    [key],
  );

  return [storedValue, setValue] as const;
}

/**
 * 주기적으로 게스트 목록을 갱신하는 폴링 훅
 */
export function useGuestPolling(
  fetchFn: () => Promise<void>,
  intervalMs: number = 15000,
  active: boolean = true,
): PollingCoordinator {
  const [coordinator] = useState(createPollingCoordinator);
  const fetchRef = useRef(fetchFn);

  useEffect(() => {
    fetchRef.current = fetchFn;
  }, [fetchFn]);

  useEffect(() => {
    const isAvailable = () =>
      active &&
      document.visibilityState === "visible" &&
      navigator.onLine !== false;
    const runPoll = () => {
      void coordinator.run(async () => fetchRef.current()).catch(() => {
        // Silent fail for polling
      });
    };
    const syncAvailability = (refreshWhenAvailable: boolean) => {
      const available = isAvailable();
      coordinator.setEnabled(available);
      if (available && refreshWhenAvailable) runPoll();
    };

    syncAvailability(false);
    const interval = window.setInterval(runPoll, intervalMs);
    const handleVisibilityChange = () => syncAvailability(true);
    const handleOnline = () => syncAvailability(true);
    const handleOffline = () => syncAvailability(false);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      coordinator.setEnabled(false);
    };
  }, [active, coordinator, intervalMs]);

  useEffect(
    () => () => {
      coordinator.dispose();
    },
    [coordinator],
  );

  return coordinator;
}

/**
 * 겹친 비동기 조회 중 최신 요청만 화면 상태를 갱신하도록 판별합니다.
 * 컴포넌트가 unmount되면 진행 중인 모든 요청을 자동으로 무효화합니다.
 */
export function useLatestRequestGuard(): LatestRequestGuard {
  const [guard] = useState(createLatestRequestGuard);

  useEffect(() => {
    const unsubscribe = subscribeToRouteTransitionStart(
      guard.invalidateRequests,
    );

    return () => {
      unsubscribe();
      guard.invalidateRequests();
    };
  }, [guard]);

  return guard;
}

/**
 * mutation 시작 scope와 operation id를 캡처하고 route 전환/unmount 시 폐기합니다.
 */
export function useScopedOperationGuard(): ScopedOperationGuard {
  const [guard] = useState(createScopedOperationGuard);

  useEffect(() => {
    const unsubscribe = subscribeToRouteTransitionStart(
      () => guard.invalidateOperations(),
    );

    return () => {
      unsubscribe();
      guard.invalidateOperations();
    };
  }, [guard]);

  return guard;
}
