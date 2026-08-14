export type IsLatestRequest = () => boolean;

export interface LatestRequestGuard {
  beginRequest: () => IsLatestRequest;
  invalidateRequests: () => void;
}

export interface ScopedOperation {
  id: number;
  operationKey: string;
  scopeKey: string;
  isCurrent: (currentScopeKey: string) => boolean;
  finish: (currentScopeKey: string) => boolean;
}

export interface ScopedOperationGuard {
  beginOperation: (
    scopeKey: string,
    operationKey?: string,
  ) => ScopedOperation;
  invalidateOperations: (operationKey?: string) => void;
}

/**
 * 비동기 조회가 겹칠 때 가장 최근에 시작한 요청만 상태를 갱신하게 합니다.
 * 네트워크 요청 자체를 취소할 수 없는 Server Action 호출에도 사용할 수 있습니다.
 */
export function createLatestRequestGuard(): LatestRequestGuard {
  let latestRequestId = 0;

  return {
    beginRequest() {
      const requestId = ++latestRequestId;
      return () => requestId === latestRequestId;
    },
    invalidateRequests() {
      latestRequestId += 1;
    },
  };
}

/**
 * mutation이 시작된 scope와 operation 소유권을 함께 추적합니다.
 * 같은 operation key로 더 늦게 시작한 작업이나 scope 전환 뒤의 응답은
 * credential, feedback, busy state를 갱신할 수 없습니다.
 */
export function createScopedOperationGuard(): ScopedOperationGuard {
  let nextOperationId = 0;
  const currentOperations = new Map<string, number>();

  return {
    beginOperation(scopeKey, operationKey = "default") {
      const id = ++nextOperationId;
      currentOperations.set(operationKey, id);

      const isCurrent = (currentScopeKey: string) =>
        currentScopeKey === scopeKey &&
        currentOperations.get(operationKey) === id;

      return {
        id,
        operationKey,
        scopeKey,
        isCurrent,
        finish(currentScopeKey) {
          if (!isCurrent(currentScopeKey)) return false;
          currentOperations.delete(operationKey);
          return true;
        },
      };
    },
    invalidateOperations(operationKey) {
      if (operationKey) {
        currentOperations.delete(operationKey);
        return;
      }
      currentOperations.clear();
    },
  };
}
