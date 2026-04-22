import { useState, useEffect } from "react";

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

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (e) {
      console.warn(`useLocalStorage: failed to save key "${key}"`, e);
    }
  };

  return [storedValue, setValue] as const;
}
