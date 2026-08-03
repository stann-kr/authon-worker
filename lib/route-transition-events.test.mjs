import assert from "node:assert/strict";
import test from "node:test";

import {
  announceRouteTransitionStart,
  subscribeToRouteTransitionStart,
} from "./route-transition-events.ts";
import { createLatestRequestGuard } from "./latest-request.ts";

test("route 전환 시작 구독자에게 매번 알린다", () => {
  const target = new EventTarget();
  let notificationCount = 0;
  const unsubscribe = subscribeToRouteTransitionStart(
    () => {
      notificationCount += 1;
    },
    target,
  );

  announceRouteTransitionStart(target);
  announceRouteTransitionStart(target);

  assert.equal(notificationCount, 2);

  unsubscribe();
  announceRouteTransitionStart(target);
  assert.equal(notificationCount, 2);
});

test("route 전환 시작은 이전 화면의 진행 중 요청을 무효화한다", () => {
  const target = new EventTarget();
  const guard = createLatestRequestGuard();
  const isLatestRequest = guard.beginRequest();
  const unsubscribe = subscribeToRouteTransitionStart(
    guard.invalidateRequests,
    target,
  );

  announceRouteTransitionStart(target);

  assert.equal(isLatestRequest(), false);
  unsubscribe();
});
