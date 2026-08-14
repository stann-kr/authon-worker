import assert from "node:assert/strict";
import test from "node:test";

import {
  createLatestRequestGuard,
  createScopedOperationGuard,
} from "./latest-request.ts";

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

test("scoped operation은 시작 scope가 바뀌면 응답 소유권을 잃는다", () => {
  const guard = createScopedOperationGuard();
  const operation = guard.beginOperation("venue-a:2026-08-13", "reset");

  assert.equal(operation.isCurrent("venue-a:2026-08-13"), true);
  assert.equal(operation.isCurrent("venue-b:2026-08-13"), false);
  assert.equal(operation.finish("venue-b:2026-08-13"), false);
});

test("같은 key의 최신 scoped operation만 credential 상태를 commit한다", () => {
  const guard = createScopedOperationGuard();
  const first = guard.beginOperation("venue-a", "reset");
  const second = guard.beginOperation("venue-a", "reset");

  assert.equal(first.isCurrent("venue-a"), false);
  assert.equal(second.isCurrent("venue-a"), true);
  assert.equal(first.finish("venue-a"), false);
  assert.equal(second.finish("venue-a"), true);
  assert.equal(second.isCurrent("venue-a"), false);
});

test("서로 다른 operation key는 busy 소유권을 독립적으로 해제한다", () => {
  const guard = createScopedOperationGuard();
  const checkIn = guard.beginOperation("venue-a:date-a", "guest-a");
  const cancel = guard.beginOperation("venue-a:date-a", "guest-b");

  assert.equal(checkIn.finish("venue-a:date-a"), true);
  assert.equal(cancel.isCurrent("venue-a:date-a"), true);
  assert.equal(cancel.finish("venue-a:date-a"), true);
});

test("invalidateOperations는 지연 중인 모든 scoped operation을 폐기한다", () => {
  const guard = createScopedOperationGuard();
  const reset = guard.beginOperation("venue-a", "reset");
  const link = guard.beginOperation("venue-a", "link");

  guard.invalidateOperations();

  assert.equal(reset.isCurrent("venue-a"), false);
  assert.equal(link.isCurrent("venue-a"), false);
});

test("지연된 reset 응답은 venue 전환 뒤 setup credential을 commit하지 않는다", async () => {
  const guard = createScopedOperationGuard();
  let currentScopeKey = "venue-a";
  let setupCredential = null;
  let resolveReset;
  const resetResponse = new Promise((resolve) => {
    resolveReset = resolve;
  });
  const operation = guard.beginOperation(currentScopeKey, "reset");

  const commitResponse = (async () => {
    const credential = await resetResponse;
    if (operation.isCurrent(currentScopeKey)) {
      setupCredential = credential;
    }
  })();

  currentScopeKey = "venue-b";
  guard.invalidateOperations();
  resolveReset("one-time-credential");
  await commitResponse;

  assert.equal(setupCredential, null);
});

test("reject 경로에서도 현재 operation의 busy 소유권을 해제한다", async () => {
  const guard = createScopedOperationGuard();
  const currentScopeKey = "venue-a";
  const operation = guard.beginOperation(currentScopeKey, "reset");
  let busy = true;

  try {
    await Promise.reject(new Error("network failed"));
  } catch {
    // UI error presentation is independent from ownership cleanup.
  } finally {
    if (operation.finish(currentScopeKey)) busy = false;
  }

  assert.equal(busy, false);
});
