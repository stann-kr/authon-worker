import assert from "node:assert/strict";
import test from "node:test";

import {
  GUEST_CREATE_ERROR_KEYS,
  VENUE_MUTATION_ERROR_KEYS,
  selectDomainMessageKey,
} from "./domain-error.ts";

test("known domain error codes resolve to localized message keys", () => {
  assert.equal(
    selectDomainMessageKey(
      "INVALID_TIMEZONE",
      VENUE_MUTATION_ERROR_KEYS,
      "updateFailed",
    ),
    "invalidTimezone",
  );
  assert.equal(
    selectDomainMessageKey(
      "GUEST_LIMIT_REACHED",
      GUEST_CREATE_ERROR_KEYS,
      "registerResultUnknown",
    ),
    "limitReachedServer",
  );
});

test("unknown or non-string errors use a localized fallback key", () => {
  assert.equal(
    selectDomainMessageKey("RAW_SERVER_MESSAGE", VENUE_MUTATION_ERROR_KEYS, "updateFailed"),
    "updateFailed",
  );
  assert.equal(
    selectDomainMessageKey(new Error("private detail"), VENUE_MUTATION_ERROR_KEYS, "createFailed"),
    "createFailed",
  );
});
