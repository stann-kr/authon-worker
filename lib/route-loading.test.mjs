import assert from "node:assert/strict";
import test from "node:test";

import {
  createRouteLoadingTracker,
  getRouteLoadingCompletionDelay,
  shouldRegisterRouteLoadingTask,
} from "./route-loading.ts";

test("route와 목적지 작업이 모두 끝나야 준비 상태가 된다", () => {
  const tracker = createRouteLoadingTracker();

  tracker.startRoute();
  const finishAuth = tracker.beginTask();
  const finishData = tracker.beginTask();

  tracker.commitRoute();
  finishAuth();

  assert.equal(tracker.hasPendingWork(), true);
  assert.equal(tracker.pendingTaskCount(), 1);

  finishData();

  assert.equal(tracker.hasPendingWork(), false);
  assert.equal(tracker.pendingTaskCount(), 0);
});

test("route가 바뀌어도 목적지 작업 등록 전에는 준비 상태가 아니다", () => {
  const tracker = createRouteLoadingTracker();

  tracker.startRoute();

  assert.equal(tracker.hasPendingWork(), true);

  tracker.commitRoute();

  assert.equal(tracker.hasPendingWork(), false);
});

test("화면 내부 작업도 같은 로딩 수명주기에 포함된다", () => {
  const tracker = createRouteLoadingTracker();
  const finishTask = tracker.beginTask();

  assert.equal(tracker.hasPendingWork(), true);

  finishTask();
  finishTask();

  assert.equal(tracker.hasPendingWork(), false);
  assert.equal(tracker.pendingTaskCount(), 0);
});

test("section 작업은 진행 중인 route loading에만 합류한다", () => {
  assert.equal(shouldRegisterRouteLoadingTask(false, false), false);
  assert.equal(shouldRegisterRouteLoadingTask(false, true), true);
});

test("화면 준비 작업은 idle 상태에서도 loading을 시작한다", () => {
  assert.equal(shouldRegisterRouteLoadingTask(true, false), true);
});

test("최소 노출 시간이 지나면 완료에 고정 유예를 추가하지 않는다", () => {
  assert.equal(getRouteLoadingCompletionDelay(200, 160), 0);
});

test("최소 노출 시간이 남았을 때만 남은 시간만큼 기다린다", () => {
  assert.equal(getRouteLoadingCompletionDelay(80, 160), 80);
});
