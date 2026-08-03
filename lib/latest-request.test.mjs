import assert from "node:assert/strict";
import test from "node:test";

import { createLatestRequestGuard } from "./latest-request.ts";

test("가장 최근에 시작한 요청만 current 상태를 유지한다", () => {
  const guard = createLatestRequestGuard();
  const isFirstRequestLatest = guard.beginRequest();
  const isSecondRequestLatest = guard.beginRequest();

  assert.equal(isFirstRequestLatest(), false);
  assert.equal(isSecondRequestLatest(), true);
});

test("invalidateRequests는 진행 중인 최신 요청도 무효화한다", () => {
  const guard = createLatestRequestGuard();
  const isLatestRequest = guard.beginRequest();

  guard.invalidateRequests();

  assert.equal(isLatestRequest(), false);
});
