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
const requestHandler = await readFile(
  new URL("./password-reset-public-route-handler.ts", import.meta.url),
  "utf8",
);
const statusHandler = await readFile(
  new URL("./password-reset-status-route-handler.ts", import.meta.url),
  "utf8",
);
const persistence = await readFile(
  new URL("./password-reset-public-persistence.ts", import.meta.url),
  "utf8",
);

test("public reset production routes retain only dependency wiring", () => {
  for (const route of [requestRoute, statusRoute]) {
    assert.match(route, /createPasswordResetPublicPersistence/);
    assert.match(route, /getTenantContextForRequest/);
    assert.match(route, /consumeRateLimitOrDeny/);
    assert.doesNotMatch(
      route,
      /drizzle|db\/schema|\.prepare\(|\.batch\(|\.select\(|\.insert\(|\.update\(|\.delete\(/,
    );
  }
  assert.match(requestRoute, /createPasswordResetPublicRouteHandlers/);
  assert.match(requestRoute, /submitPublicPasswordResetRequest/);
  assert.match(requestRoute, /cancelPublicPasswordResetRequest/);
  assert.match(requestRoute, /getPasswordResetReceiptRequestId/);
  assert.match(requestRoute, /getPasswordResetClaimGrantRecord/);
  assert.match(statusRoute, /createPasswordResetStatusGetHandler/);
  assert.match(statusRoute, /getPublicPasswordResetStatus/);
  assert.match(statusRoute, /getPasswordResetReceiptRequestId/);
  assert.match(statusRoute, /getPasswordResetClaimGrantRecord/);
});

test("public reset handlers own HTTP, origin, cookie, rate-limit, and telemetry policy", () => {
  for (const handler of [requestHandler, statusHandler]) {
    assert.match(handler, /isTrustedMutationOrigin\(request\)/);
    assert.match(handler, /dependencies\.consumeRateLimit/);
    assert.match(handler, /reportServerError/);
    assert.doesNotMatch(
      handler,
      /createPasswordResetPublicPersistence|drizzle|db\/schema|\.prepare\(|\.batch\(/,
    );
  }
  assert.match(requestHandler, /dependencies\.submit/);
  assert.match(requestHandler, /dependencies\.cancel/);
  assert.match(requestHandler, /PASSWORD_RESET_RECEIPT_COOKIE_NAME/);
  assert.match(requestHandler, /status: 202/);
  assert.match(statusHandler, /dependencies\.getStatus/);
  assert.match(statusHandler, /"Cache-Control": "private, no-store"/);
  assert.match(statusHandler, /Vary: "Cookie"/);
  assert.match(statusHandler, /PASSWORD_RESET_CLAIM_COOKIE_NAME/);
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
