export type IsLatestRequest = () => boolean;

export interface LatestRequestGuard {
  beginRequest: () => IsLatestRequest;
  invalidateRequests: () => void;
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
