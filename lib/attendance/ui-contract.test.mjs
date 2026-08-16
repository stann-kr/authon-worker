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

test("Door counter keeps its rapid action visible across device layouts", () => {
  assert.match(source, /className="fixed [^"]*bottom-0/);
  assert.match(source, /md:sticky/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /min-h-\[4\.5rem\]/);
  assert.match(source, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(
    doorPage,
    /pb-\[calc\(16rem\+env\(safe-area-inset-bottom\)\)\]/,
  );
});

test("Door counter uses native labeled controls and announces count changes", () => {
  assert.match(source, /<button\s+[\s\S]*?type="button"/);
  assert.match(source, /<form onSubmit=/);
  assert.match(source, /<label htmlFor="attendance-adjustment-delta"/);
  assert.match(source, /id="attendance-adjustment-delta"/);
  assert.match(source, /<label htmlFor="attendance-adjustment-reason"/);
  assert.match(source, /id="attendance-adjustment-reason"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
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
