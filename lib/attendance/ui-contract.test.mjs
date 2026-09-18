import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../app/door/components/AttendanceCounter.tsx", import.meta.url),
  "utf8",
);
const reconciliationSource = await readFile(
  new URL(
    "../../app/door/components/AttendanceReconciliationForm.tsx",
    import.meta.url,
  ),
  "utf8",
);
const controllerSource = await readFile(
  new URL(
    "../../app/door/components/useAttendanceCounterController.ts",
    import.meta.url,
  ),
  "utf8",
);
const doorPage = await readFile(
  new URL("../../app/door/page.tsx", import.meta.url),
  "utf8",
);
const koMessages = JSON.parse(
  await readFile(new URL("../../messages/ko.json", import.meta.url), "utf8"),
);
const enMessages = JSON.parse(
  await readFile(new URL("../../messages/en.json", import.meta.url), "utf8"),
);

test("Door counter uses native labeled controls and announces count changes", () => {
  assert.match(source, /<button\s+[\s\S]*?type="button"/);
  assert.match(reconciliationSource, /<form\s+onSubmit=/);
  assert.match(reconciliationSource, /<label htmlFor="attendance-reconciliation-target"/);
  assert.match(reconciliationSource, /id="attendance-reconciliation-target"/);
  assert.match(reconciliationSource, /<label htmlFor="attendance-adjustment-reason"/);
  assert.match(reconciliationSource, /id="attendance-adjustment-reason"/);
  assert.match(reconciliationSource, /name="manualTotalAttendance"/);
  assert.match(reconciliationSource, /name="manualAdjustmentReason"/);
  assert.match(reconciliationSource, /aria-describedby="attendance-adjustment-reason-help"/);
  assert.match(reconciliationSource, /isReconciliationTargetInvalid/);
  assert.match(reconciliationSource, /t\("adjustment\.reasonHelp"\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
  assert.match(
    source,
    /aria-describedby=\{unavailableText\s*\?\s*"attendance-counter-unavailable"\s*:\s*undefined\}/,
  );
  assert.match(source, /id="attendance-counter-unavailable"/);
  assert.match(source, /\{unavailableText &&/);
});

test("Door counter keeps status copy concise and state-specific", () => {
  assert.doesNotMatch(source, /t\("confirmed"\)/);
  assert.match(source, /\{statusText &&/);
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
    "모든 도어 기기를 동기화한 뒤, 현재 재실 인원이 아닌 마감 시 최종 누적 입장객을 입력하세요.",
  );
  assert.match(
    koMessages.Door.attendance.notice.scopeClosed,
    /입력을 반영하지 않았습니다/,
  );
});

test("Door correction accepts one absolute manual close count", () => {
  assert.match(source, /hasPendingGuestMutations/);
  assert.match(reconciliationSource, /reconciliationDelta === 0[\s\S]*?adjustment\.zeroDelta/);
  assert.match(reconciliationSource, /scopedSummary\?\.isFinalized/);
  assert.match(reconciliationSource, /!scopedSummary\.canFinalize/);
  assert.match(reconciliationSource, /adjustment\.eventMustBeClosed/);
  assert.equal(reconciliationSource.includes('t("totalAttendance")'), false);
});

test("Door counter delegates admin reconciliation to a stateless view", () => {
  assert.match(source, /<AttendanceReconciliationForm/);
  assert.doesNotMatch(source, /<details/);
  assert.match(reconciliationSource, /<details/);
  assert.doesNotMatch(reconciliationSource, /\buse(?:State|Effect|Reducer|Ref)\b/);
  assert.doesNotMatch(reconciliationSource, /@\/lib\/api\//);
});

test("Door counter keeps a frozen client adapter outside its mounted controller", () => {
  assert.match(source, /Object\.freeze\(\{/);
  assert.match(source, /useAttendanceCounterController\(\{/);
  assert.match(source, /const canAdjust = user\?\.role/);
  assert.doesNotMatch(controllerSource, /@\/lib\/api\/attendance/);
  assert.match(source, /disabled=\{!canRecord\}/);
});
