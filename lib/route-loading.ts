export interface RouteLoadingTracker {
  beginTask: () => () => void;
  commitRoute: () => void;
  hasPendingWork: () => boolean;
  pendingTaskCount: () => number;
  startRoute: () => void;
}

export function shouldRegisterRouteLoadingTask(
  startWhenIdle: boolean,
  isRouteLoadingVisible: boolean,
): boolean {
  return startWhenIdle || isRouteLoadingVisible;
}

/**
 * route 이동과 목적지 준비 작업을 하나의 로딩 수명주기로 묶습니다.
 * 각 작업의 release 함수는 여러 번 호출돼도 한 번만 반영됩니다.
 */
export function createRouteLoadingTracker(): RouteLoadingTracker {
  let isWaitingForRoute = false;
  let nextTaskId = 0;
  const pendingTasks = new Set<number>();

  return {
    beginTask() {
      const taskId = ++nextTaskId;
      pendingTasks.add(taskId);

      return () => {
        pendingTasks.delete(taskId);
      };
    },
    commitRoute() {
      isWaitingForRoute = false;
    },
    hasPendingWork() {
      return isWaitingForRoute || pendingTasks.size > 0;
    },
    pendingTaskCount() {
      return pendingTasks.size;
    },
    startRoute() {
      isWaitingForRoute = true;
    },
  };
}
