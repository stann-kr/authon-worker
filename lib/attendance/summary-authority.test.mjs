import assert from "node:assert/strict";
import test from "node:test";

import {
  beginAttendanceSummaryMutation,
  beginAttendanceSummaryRead,
  claimAttendanceSummaryMutation,
  createAttendanceSummaryAuthority,
  invalidateAttendanceSummaries,
  isAttendanceSummaryMutationClaimCurrent,
  isAttendanceSummaryReadCurrent,
} from "./summary-authority.ts";

test("a newer read invalidates a mutation summary delayed by local cleanup", async () => {
  const authority = createAttendanceSummaryAuthority();
  const mutation = beginAttendanceSummaryMutation(authority);
  const claim = claimAttendanceSummaryMutation(authority, mutation);
  assert.ok(claim);

  let finishCleanup = () => {};
  const cleanup = new Promise((resolve) => {
    finishCleanup = resolve;
  });
  const delayedCommit = (async () => {
    await cleanup;
    return isAttendanceSummaryMutationClaimCurrent(authority, claim);
  })();

  const newerRead = beginAttendanceSummaryRead(authority);
  finishCleanup();

  assert.equal(await delayedCommit, false);
  assert.equal(isAttendanceSummaryReadCurrent(authority, newerRead), true);
});

test("scope invalidation rejects outstanding reads and mutation claims", () => {
  const authority = createAttendanceSummaryAuthority();
  const read = beginAttendanceSummaryRead(authority);
  const mutation = beginAttendanceSummaryMutation(authority);
  const claim = claimAttendanceSummaryMutation(authority, mutation);
  assert.ok(claim);

  invalidateAttendanceSummaries(authority);

  assert.equal(isAttendanceSummaryReadCurrent(authority, read), false);
  assert.equal(isAttendanceSummaryMutationClaimCurrent(authority, claim), false);
});
