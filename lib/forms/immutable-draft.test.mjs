import assert from "node:assert/strict";
import test from "node:test";

import { captureImmutableDraft } from "./immutable-draft.ts";

test("비동기 제출용 draft는 이후 form state 변경과 분리된다", () => {
  const form = { name: "FIRST", venueId: "venue-a", limit: "10" };
  const draft = captureImmutableDraft(form);

  form.name = "SECOND";
  form.venueId = "venue-b";

  assert.deepEqual(draft, {
    name: "FIRST",
    venueId: "venue-a",
    limit: "10",
  });
  assert.equal(Object.isFrozen(draft), true);
  assert.throws(() => {
    draft.name = "MUTATED";
  }, TypeError);
});
