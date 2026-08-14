import type { IsLatestRequest } from "./latest-request";

export type PollingTask = (isCurrent: IsLatestRequest) => Promise<void>;

export interface PollingCoordinator {
  run: (task: PollingTask) => Promise<boolean>;
  setEnabled: (enabled: boolean) => void;
  suspend: () => () => void;
  clearSuspensions: () => void;
  invalidate: () => void;
  dispose: () => void;
  isInFlight: () => boolean;
}

/**
 * 느린 poll의 중첩 실행을 막고, scope/mutation 전환 시 진행 중 결과를
 * stale 처리합니다. suspend는 token 기반이라 여러 mutation이 겹쳐도 마지막
 * 작업이 끝나기 전 poll이 재개되지 않습니다.
 */
export function createPollingCoordinator(): PollingCoordinator {
  let enabled = false;
  let disposed = false;
  let inFlight = false;
  let generation = 0;
  let nextSuspensionId = 0;
  const suspensions = new Set<number>();

  const invalidate = () => {
    generation += 1;
  };

  return {
    async run(task) {
      if (!enabled || disposed || inFlight || suspensions.size > 0) {
        return false;
      }

      const runGeneration = ++generation;
      inFlight = true;
      try {
        await task(
          () =>
            !disposed &&
            enabled &&
            suspensions.size === 0 &&
            generation === runGeneration,
        );
        return true;
      } finally {
        inFlight = false;
      }
    },
    setEnabled(nextEnabled) {
      if (nextEnabled && disposed) disposed = false;
      if (enabled === nextEnabled) return;
      enabled = nextEnabled;
      if (!enabled) invalidate();
    },
    suspend() {
      const suspensionId = ++nextSuspensionId;
      suspensions.add(suspensionId);
      invalidate();
      return () => {
        suspensions.delete(suspensionId);
      };
    },
    clearSuspensions() {
      suspensions.clear();
      invalidate();
    },
    invalidate,
    dispose() {
      disposed = true;
      enabled = false;
      suspensions.clear();
      invalidate();
    },
    isInFlight() {
      return inFlight;
    },
  };
}
