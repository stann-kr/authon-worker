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
  assert.match(source, /\{unavailableText && \(/);
});

test("Door counter keeps status copy concise and state-specific", () => {
  assert.doesNotMatch(source, /t\("confirmed"\)/);
  assert.match(source, /\{statusText && \(/);
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
  assert.match(source, /useMobileDockInset\(mobileDockRef\)/);
  assert.doesNotMatch(controllerSource, /@\/lib\/api\/attendance/);
  assert.match(source, /disabled=\{!canRecord\}/);
});
