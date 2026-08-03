import { isDemoSession, type DemoSession } from "./auth";
import { createDemoState, isDemoState, type DemoState } from "./state";

export const DEMO_STORAGE_KEY = "authon:portfolio-demo:v1";
export const DEMO_SESSION_KEY = "authon:portfolio-demo-session:v1";

function readStoredValue(storage: Storage, key: string): unknown {
  const stored = storage.getItem(key);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as unknown;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function readDemoState(storage: Storage): DemoState {
  const stored = readStoredValue(storage, DEMO_STORAGE_KEY);
  return isDemoState(stored) ? stored : createDemoState();
}

export function readDemoSession(storage: Storage): DemoSession | null {
  const stored = readStoredValue(storage, DEMO_SESSION_KEY);
  return isDemoSession(stored) ? stored : null;
}

export function writeDemoState(storage: Storage, state: DemoState): void {
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
}

export function writeDemoSession(storage: Storage, session: DemoSession): void {
  storage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
}

export function clearDemoSession(storage: Storage): void {
  storage.removeItem(DEMO_SESSION_KEY);
}
