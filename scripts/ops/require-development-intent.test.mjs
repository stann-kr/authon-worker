import assert from "node:assert/strict";
import test from "node:test";

import { inspectDevelopmentIntent } from "./require-development-intent.mjs";

test("development version upload requires an exact explicit intent", () => {
  assert.deepEqual(inspectDevelopmentIntent({}), {
    ok: false,
    missing: ["AUTHON_DEVELOPMENT_INTENT"],
  });
  assert.deepEqual(
    inspectDevelopmentIntent({ AUTHON_DEVELOPMENT_INTENT: "true" }),
    {
      ok: false,
      missing: ["AUTHON_DEVELOPMENT_INTENT"],
    },
  );
  assert.deepEqual(inspectDevelopmentIntent({ AUTHON_DEVELOPMENT_INTENT: "1" }), {
    ok: true,
    missing: [],
  });
});
