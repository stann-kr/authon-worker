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
const routeLoadingShell = await readFile(
  new URL("../../components/RouteLoadingShell.tsx", import.meta.url),
  "utf8",
);
const koMessages = JSON.parse(
  await readFile(new URL("../../messages/ko.json", import.meta.url), "utf8"),
);
const enMessages = JSON.parse(
  await readFile(new URL("../../messages/en.json", import.meta.url), "utf8"),
);

test("Door counter keeps its rapid action visible across device layouts", () => {
  assert.match(source, /className="fixed [^"]*bottom-0/);
  assert.match(source, /md:sticky/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /max-w-\[1440px\] px-3 py-1/);
  assert.match(
    source,
    /mt-1 grid grid-cols-\[minmax\(0,1fr\)_auto\] gap-1\.5/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => void queueWalkIn\(\)\}[\s\S]*?className="[^\"]*min-h-11[^\"]*md:min-h-14/,
  );
  assert.match(source, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(
    doorPage,
    /bottomInsetClassName="pb-\[var\(--door-mobile-dock-height,calc\(6rem\+env\(safe-area-inset-bottom\)\)\)\] md:pb-0"/,
  );
  assert.match(workspaceShell, /className=\{`page-scroll \$\{bottomInsetClassName\}`\}/);
  assert.match(source, /useMobileDockInset\(mobileDockRef\)/);
  assert.match(source, /ref=\{mobileDockRef\}/);
  assert.match(doorPage, /footerLayer="below-mobile-dock"/);
});

test("common Footer remains chrome during route transitions while Door narrows its exception", () => {
  assert.match(footer, /layer = "chrome"/);
  assert.match(footer, /z-\[var\(--app-z-chrome\)\]/);
  assert.match(footer, /layer === "chrome"/);
  assert.match(footer, /!compact && "mt-auto"/);
  assert.match(footer, /layer === "chrome" \? "z-\[var\(--app-z-chrome\)\]" : "z-0"/);
  assert.match(workspaceShell, /footerLayer\?: "chrome" \| "below-mobile-dock"/);
  assert.match(workspaceShell, /<Footer layer=\{footerLayer\} \/>/);
  assert.match(routeLoadingShell, /<Footer \/>/);
});

test("Door counter uses native labeled controls and announces count changes", () => {
  assert.match(source, /<button\s+[\s\S]*?type="button"/);
  assert.match(source, /<form onSubmit=/);
  assert.match(source, /<label htmlFor="attendance-reconciliation-target"/);
  assert.match(source, /id="attendance-reconciliation-target"/);
  assert.match(source, /<label htmlFor="attendance-adjustment-reason"/);
  assert.match(source, /id="attendance-adjustment-reason"/);
  assert.match(source, /name="manualTotalAttendance"/);
  assert.match(source, /name="manualAdjustmentReason"/);
  assert.match(source, /aria-describedby="attendance-adjustment-reason-help"/);
  assert.match(source, /isReconciliationTargetInvalid/);
  assert.match(source, /t\("adjustment\.reasonHelp"\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
  assert.match(
    source,
    /aria-describedby=\{unavailableText\s*\?\s*"attendance-counter-unavailable"\s*:\s*undefined\}/,
  );
  assert.match(source, /id="attendance-counter-unavailable"/);
  assert.match(source, /\{unavailableText && \(/);
});

test("Door counter keeps status copy concise and state-specific", () => {
  assert.doesNotMatch(source, /t\("confirmed"\)/);
  assert.match(source, /\{statusText && \(/);
  assert.match(source, /setAnnouncement\(t\("scopeClosed"\)\)/);
  assert.doesNotMatch(source, /finalizedAnnouncement/);
  assert.doesNotMatch(doorPage, /t\("offlineReady"\)/);
  assert.equal(Object.hasOwn(koMessages.Door, "offlineReady"), false);
  assert.equal(
    Object.hasOwn(koMessages.Door.attendance, "confirmed"),
    false,
  );
  assert.equal(Object.hasOwn(koMessages.Door.attendance, "helper"), false);
  assert.equal(Object.hasOwn(enMessages.Door.attendance, "helper"), false);
  assert.doesNotMatch(source, /t\("helper"\)/);
  assert.equal(
    koMessages.AdminAnalytics.attendance.definition,
    "총 입장객은 입장 완료 게스트와 순 워크인의 합계이며 고유 방문자 수가 아닙니다. 마감된 범위는 이후의 명단이나 원장 변경 대신 변경 불가 마감 스냅샷을 사용합니다.",
  );
  assert.equal(
    enMessages.AdminAnalytics.attendance.definition,
    "Total attendance is checked-in guests plus net walk-ins, not a unique-visitor count. A finalized scope uses its immutable close snapshot instead of later live roster or ledger changes.",
  );

  assert.equal(koMessages.Door.attendance.finalized, "마감됨");
  assert.notEqual(
    koMessages.Door.attendance.finalized,
    koMessages.Door.attendance.scopeClosed,
  );
  assert.equal(
    enMessages.Door.attendance.recordedAnnouncement,
    "Walk-in entry saved on this device.",
  );
  assert.equal(
    koMessages.Door.attendance.adjustment.help,
    "모든 Door 기기를 동기화한 뒤, 현재 재실 인원이 아닌 마감 시 최종 누적 입장객을 입력하세요.",
  );
  assert.match(
    koMessages.Door.attendance.notice.scopeClosed,
    /입력을 반영하지 않았습니다/,
  );
});

test("Door correction accepts one absolute manual close count", () => {
  assert.match(source, /targetTotalAttendance/);
  assert.match(source, /expectedCheckedInGuests: scopedSummary\.checkedInGuests/);
  assert.match(source, /expectedWalkIns: scopedSummary\.walkIns/);
  assert.match(source, /expectedSourceActivityCount: scopedSummary\.sourceActivityCount/);
  assert.match(source, /hasPendingGuestMutations/);
  assert.match(source, /reconciliationDelta === 0[\s\S]*?adjustment\.zeroDelta/);
  assert.match(source, /scopedSummary\?\.isFinalized/);
  assert.match(source, /!scopedSummary\.canFinalize/);
  assert.match(source, /adjustment\.eventMustBeClosed/);
  assert.match(source, /window\.confirm\(t\("adjustment\.confirm"\)\)/);
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
