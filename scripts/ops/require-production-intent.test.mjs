import assert from "node:assert/strict";
import test from "node:test";

import { inspectProductionIntent } from "./require-production-intent.mjs";

test("production operation requires intent plus both Cloudflare credentials", () => {
  assert.deepEqual(inspectProductionIntent({}), {
    ok: false,
    missing: [
      "AUTHON_PRODUCTION_INTENT",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
    ],
  });
});

test("production operation checks presence without returning credential values", () => {
  const result = inspectProductionIntent({
    AUTHON_PRODUCTION_INTENT: "1",
    CLOUDFLARE_API_TOKEN: "private-token-fixture",
    CLOUDFLARE_ACCOUNT_ID: "private-account-fixture",
  });

  assert.deepEqual(result, { ok: true, missing: [] });
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});
