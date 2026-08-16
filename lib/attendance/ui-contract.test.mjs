import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../app/door/components/AttendanceCounter.tsx", import.meta.url),
  "utf8",
);
const doorPage = await readFile(
  new URL("../../app/door/page.tsx", import.meta.url),
  "utf8",
);
const workspaceShell = await readFile(
  new URL("../../components/WorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const footer = await readFile(
  new URL("../../components/Footer.tsx", import.meta.url),
  "utf8",
);

test("Door counter keeps its rapid action visible across device layouts", () => {
  assert.match(source, /className="fixed [^"]*bottom-0/);
  assert.match(source, /md:sticky/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /min-h-14/);
  assert.match(source, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(
    doorPage,
    /bottomInsetClassName="pb-\[calc\(13rem\+env\(safe-area-inset-bottom\)\)\] md:pb-0"/,
  );
  assert.match(workspaceShell, /className=\{`page-scroll \$\{bottomInsetClassName\}`\}/);
  assert.match(footer, /: "relative mt-auto flex-shrink-0 bg-canvas"/);
});

test("Door counter uses native labeled controls and announces count changes", () => {
  assert.match(source, /<button\s+[\s\S]*?type="button"/);
  assert.match(source, /<form onSubmit=/);
  assert.match(source, /<label htmlFor="attendance-reconciliation-target"/);
  assert.match(source, /id="attendance-reconciliation-target"/);
  assert.match(source, /<label htmlFor="attendance-adjustment-reason"/);
  assert.match(source, /id="attendance-adjustment-reason"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
});

test("Door correction accepts one absolute manual close count", () => {
  assert.match(source, /targetTotalAttendance/);
  assert.match(source, /expectedCheckedInGuests: scopedSummary\.checkedInGuests/);
  assert.match(source, /expectedWalkIns: scopedSummary\.walkIns/);
  assert.match(source, /hasPendingGuestMutations/);
  assert.match(source, /reconciliationDelta === 0/);
  assert.equal(source.includes('t("totalAttendance")'), false);
});

test("Door correction rejects stale summaries and binds retries to one payload", () => {
  assert.match(source, /beginAttendanceSummaryRead/);
  assert.match(source, /beginAttendanceSummaryMutation/);
  assert.match(source, /claimAttendanceSummaryMutation/);
  assert.match(source, /isAttendanceSummaryMutationClaimCurrent/);
  assert.match(source, /const attemptFingerprint = JSON\.stringify/);
  assert.match(
    source,
    /existingAttempt\?\.fingerprint === attemptFingerprint[\s\S]*?existingAttempt\.idempotencyKey/,
  );
});

test("Door counter preserves durable-first entry and disables unsafe recording", () => {
  const enqueueIndex = source.indexOf("await enqueueAttendanceMutation");
  const refreshIndex = source.indexOf("await refreshLocalMutations", enqueueIndex);
  assert.ok(enqueueIndex > 0);
  assert.ok(refreshIndex > enqueueIndex);
  assert.match(source, /isStorageAvailable !== false/);
  assert.match(source, /disabled=\{!canRecord\}/);
  assert.match(source, /undoingRef\.current/);
});
