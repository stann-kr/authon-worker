import assert from "node:assert/strict";
import test from "node:test";

import { createLatestRequestGuard } from "./latest-request.ts";
import { createPollingCoordinator } from "./polling-coordinator.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("30초 지연 poll에도 동시에 하나만 실행한다", async () => {
  const coordinator = createPollingCoordinator();
  const pending = deferred();
  let running = 0;
  let maxRunning = 0;

  coordinator.setEnabled(true);
  const firstRun = coordinator.run(async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await pending.promise;
    running -= 1;
  });

  assert.equal(await coordinator.run(async () => {}), false);
  assert.equal(await coordinator.run(async () => {}), false);
  pending.resolve();
  assert.equal(await firstRun, true);
  assert.equal(maxRunning, 1);
});

test("poll reject 뒤에도 in-flight 상태를 해제하고 다음 실행을 허용한다", async () => {
  const coordinator = createPollingCoordinator();
  coordinator.setEnabled(true);

  await assert.rejects(
    coordinator.run(async () => {
      throw new Error("network failed");
    }),
  );

  assert.equal(coordinator.isInFlight(), false);
  assert.equal(await coordinator.run(async () => {}), true);
});

test("mutation suspend는 진행 중 poll 응답을 stale 처리하고 release까지 새 poll을 막는다", async () => {
  const coordinator = createPollingCoordinator();
  const pending = deferred();
  let canCommit = true;

  coordinator.setEnabled(true);
  const poll = coordinator.run(async (isCurrent) => {
    await pending.promise;
    canCommit = isCurrent();
  });
  const release = coordinator.suspend();
  pending.resolve();
  await poll;

  assert.equal(canCommit, false);
  assert.equal(await coordinator.run(async () => {}), false);
  release();
  assert.equal(await coordinator.run(async () => {}), true);
});

test("scope 전환 시 suspension을 초기화해 이전 작업이 새 scope poll을 막지 않는다", async () => {
  const coordinator = createPollingCoordinator();
  coordinator.setEnabled(true);
  const releaseOldScope = coordinator.suspend();

  coordinator.clearSuspensions();
  assert.equal(await coordinator.run(async () => {}), true);

  releaseOldScope();
  assert.equal(await coordinator.run(async () => {}), true);
});

test("hidden/offline을 나타내는 disabled 상태에서는 poll을 실행하지 않는다", async () => {
  const coordinator = createPollingCoordinator();
  coordinator.setEnabled(false);
  assert.equal(await coordinator.run(async () => {}), false);

  coordinator.setEnabled(true);
  assert.equal(await coordinator.run(async () => {}), true);
});

test("effect cleanup 뒤 다시 활성화되는 개발 Strict Mode 수명주기를 지원한다", async () => {
  const coordinator = createPollingCoordinator();
  coordinator.setEnabled(true);
  coordinator.dispose();

  assert.equal(await coordinator.run(async () => {}), false);

  coordinator.setEnabled(true);
  assert.equal(await coordinator.run(async () => {}), true);
});

test("mutation 성공 뒤 늦게 끝난 이전 roster poll이 상태를 덮지 않는다", async () => {
  const coordinator = createPollingCoordinator();
  const requestGuard = createLatestRequestGuard();
  const pendingRoster = deferred();
  let rosterStatus = "pending";

  coordinator.setEnabled(true);
  const poll = coordinator.run(async () => {
    const isLatestRequest = requestGuard.beginRequest();
    const staleStatus = await pendingRoster.promise;
    if (isLatestRequest()) rosterStatus = staleStatus;
  });

  const releasePolling = coordinator.suspend();
  requestGuard.invalidateRequests();
  rosterStatus = "checked";
  pendingRoster.resolve("pending");
  await poll;
  releasePolling();

  assert.equal(rosterStatus, "checked");
});
