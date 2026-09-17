import assert from "node:assert/strict";
import test from "node:test";

import {
  createRouteLoadingTracker,
  getRouteLoadingCompletionDelay,
} from "./route-loading.ts";

test("route와 인증·베뉴 준비가 모두 끝나야 준비 상태가 된다", () => {
  const tracker = createRouteLoadingTracker();

  tracker.startRoute();
  const finishAuth = tracker.beginTask();
  const finishVenue = tracker.beginTask();

  tracker.commitRoute();
  finishAuth();

  assert.equal(tracker.hasPendingWork(), true);
  assert.equal(tracker.pendingTaskCount(), 1);

  finishVenue();

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

test("초기 화면 준비 작업은 route 이동 없이도 추적하고 중복 해제는 무시한다", () => {
  const tracker = createRouteLoadingTracker();
  const finishTask = tracker.beginTask();

  assert.equal(tracker.hasPendingWork(), true);

  finishTask();
  finishTask();

  assert.equal(tracker.hasPendingWork(), false);
  assert.equal(tracker.pendingTaskCount(), 0);
});

test("연속 이동은 마지막 목적지만 기다리고 이전 화면의 작업과 완료를 무시한다", () => {
  const tracker = createRouteLoadingTracker("/admin");
  const finishAdmin = tracker.beginTask("/admin");
  tracker.startRoute("/door");
  const finishDoor = tracker.beginTask("/door");
  tracker.startRoute("/profile");
  const finishProfile = tracker.beginTask("/profile");

  assert.equal(tracker.commitRoute("/door"), false);
  finishAdmin();
  assert.equal(tracker.hasPendingWork(), true);
  assert.equal(tracker.commitRoute("/profile"), true);
  assert.equal(tracker.pendingTaskCount(), 1);
  finishProfile();
  assert.equal(tracker.hasPendingWork(), false);
  finishDoor();
  assert.equal(tracker.hasPendingWork(), false);
});

test("현재 화면으로 돌아오면 그 화면의 준비를 유지하며 권한 redirect도 완료할 수 있다", () => {
  const tracker = createRouteLoadingTracker("/admin");
  const finishAdmin = tracker.beginTask("/admin");
  tracker.startRoute("/door");
  tracker.startRoute("/admin");
  tracker.commitRoute("/admin");
  assert.equal(tracker.hasPendingWork(), true);
  finishAdmin();
  assert.equal(tracker.hasPendingWork(), false);

  tracker.startRoute("/door");
  assert.equal(tracker.commitRoute("/auth/login"), true);
  assert.equal(tracker.isCurrentRoute("/auth/login"), true);
  assert.equal(tracker.hasPendingWork(), false);
});

test("최소 노출 시간이 지나면 완료에 고정 유예를 추가하지 않는다", () => {
  assert.equal(getRouteLoadingCompletionDelay(200, 160), 0);
});

test("최소 노출 시간이 남았을 때만 남은 시간만큼 기다린다", () => {
  assert.equal(getRouteLoadingCompletionDelay(80, 160), 80);
});
