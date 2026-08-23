import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requestRoute = await readFile(
  new URL("../../app/api/auth/password-reset-requests/route.ts", import.meta.url),
  "utf8",
);
const statusRoute = await readFile(
  new URL("../../app/api/auth/password-reset-requests/status/route.ts", import.meta.url),
  "utf8",
);
const persistence = await readFile(
  new URL("./password-reset-public-persistence.ts", import.meta.url),
  "utf8",
);

test("public reset routes retain HTTP, tenant, cookie, rate-limit, and telemetry mapping without persistence access", () => {
  for (const route of [requestRoute, statusRoute]) {
    assert.match(route, /createPasswordResetPublicPersistence/);
    assert.match(route, /getTenantContextForRequest/);
    assert.match(route, /consumeRateLimitOrDeny/);
    assert.match(route, /reportServerError/);
    assert.doesNotMatch(
      route,
      /drizzle|db\/schema|\.prepare\(|\.batch\(|\.select\(|\.insert\(|\.update\(|\.delete\(/,
    );
  }
  assert.match(requestRoute, /submitPublicPasswordResetRequest/);
  assert.match(requestRoute, /cancelPublicPasswordResetRequest/);
  assert.match(requestRoute, /PASSWORD_RESET_RECEIPT_COOKIE_NAME/);
  assert.match(statusRoute, /getPublicPasswordResetStatus/);
  assert.match(statusRoute, /"Cache-Control": "private, no-store"/);
  assert.match(statusRoute, /Vary: "Cookie"/);
  assert.match(statusRoute, /PASSWORD_RESET_CLAIM_COOKIE_NAME/);
});

test("public reset persistence owns the Drizzle lookup, ordered batch, and tenant-scoped cancellation SQL", () => {
  assert.match(persistence, /drizzle\(database\)/);
  assert.match(persistence, /leftJoin\(venues, eq\(users\.venueId, venues\.id\)\)/);
  assert.match(persistence, /database\.batch/);
  assert.match(persistence, /CANCEL_EXPIRED_OPEN_PASSWORD_RESET_REQUESTS_SQL/);
  assert.match(persistence, /INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_WITH_EXPIRY_SQL/);
  assert.match(persistence, /SELECT_EXISTING_BROWSER_PASSWORD_RESET_REQUEST_SQL/);
  assert.match(persistence, /CANCEL_BROWSER_PASSWORD_RESET_REQUEST_SQL/);
  assert.match(persistence, /CANCEL_EXPIRED_APPROVED_BROWSER_REQUEST_SQL/);
});
