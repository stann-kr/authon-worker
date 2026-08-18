import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./offline-store.ts", import.meta.url), "utf8");

test("attendance offline storage preserves queued records across scopes", () => {
  assert.match(source, /authon-attendance-offline-v1/);
  assert.match(source, /MAX_OFFLINE_ATTENDANCE_MUTATIONS/);
  assert.match(source, /MUTATION_STATE_INDEX/);
  assert.match(source, /request\.onblocked/);
  assert.match(source, /onversionchange/);
  assert.match(source, /\[MUTATION_STORE, META_STORE\]/);
  assert.match(source, /count\("queued"\)/);
  assert.match(source, /isAttendanceScopeEqual\(mutation\.scope, scope\)/);
  assert.equal(source.includes("expiresAt"), false);
  assert.equal(source.includes(".clear()"), false);
});

test("attendance offline storage sequences, resolves, and groups mutations by device", () => {
  assert.match(source, /sequence:\$\{deviceId\}/);
  assert.match(source, /transitionOfflineAttendanceMutation/);
  assert.match(source, /groupAttendanceMutationsByDevice/);
  assert.match(source, /mutation\.state !== "queued"/);
});
