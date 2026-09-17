export interface RouteLoadingTracker {
  beginTask: (route?: string | null) => () => void;
  commitRoute: (route?: string | null) => boolean;
  hasPendingWork: () => boolean;
  isCurrentRoute: (route: string | null) => boolean;
  pendingTaskCount: () => number;
  startRoute: (route?: string | null) => void;
}

/**
 * 로딩 표시의 최소 노출 시간만 보장합니다.
 * 완료 후 새 작업이 실제 등록되면 tracker가 종료를 취소하므로 별도 고정 유예는 두지 않습니다.
 */
export function getRouteLoadingCompletionDelay(
  elapsedMs: number,
  minimumVisibleMs: number,
): number {
  return Math.max(0, minimumVisibleMs - elapsedMs);
}

/**
 * route 이동과 목적지 준비 작업을 하나의 로딩 수명주기로 묶습니다.
 * 떠난 화면의 작업은 새 목적지를 기다리게 하지 않으며, 돌아오면 아직 유효한 준비를 이어갑니다.
 * 각 작업의 release 함수는 여러 번 호출돼도 한 번만 반영됩니다.
 */
export function createRouteLoadingTracker(initialRoute: string | null = null): RouteLoadingTracker {
  let currentRoute = initialRoute;
  let isWaitingForRoute = false;
  let nextTaskId = 0;
  const pendingTasks = new Map<number, string | null>();
  const supersededRoutes = new Set<string | null>();
  const pendingTaskCount = () => [...pendingTasks.values()].filter((route) => route === currentRoute).length;

  return {
    beginTask(route = currentRoute) {
      const taskId = ++nextTaskId;
      pendingTasks.set(taskId, route);

      return () => {
        pendingTasks.delete(taskId);
      };
    },
    commitRoute(route = currentRoute) {
      if (isWaitingForRoute && supersededRoutes.has(route)) return false;
      currentRoute = route;
      isWaitingForRoute = false;
      supersededRoutes.clear();
      return true;
    },
    hasPendingWork() {
      return isWaitingForRoute || pendingTaskCount() > 0;
    },
    isCurrentRoute(route) {
      return route === currentRoute;
    },
    pendingTaskCount,
    startRoute(route = currentRoute) {
      if (isWaitingForRoute && currentRoute !== route) supersededRoutes.add(currentRoute);
      supersededRoutes.delete(route);
      currentRoute = route;
      isWaitingForRoute = true;
    },
  };
}
