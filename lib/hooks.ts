import { useState, useEffect, useCallback } from "react";

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
export function useGuestPolling(fetchFn: () => Promise<void>, intervalMs: number = 15000, active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(async () => {
      try {
        await fetchFn();
      } catch {
        // Silent fail for polling
      }
    }, intervalMs);
    return () => clearInterval(interval);
  }, [fetchFn, intervalMs, active]);
}
