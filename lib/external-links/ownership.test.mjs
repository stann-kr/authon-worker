import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseContributorRoster,
  createExternalOwnerKey,
  externalOwnerStorageKey,
  isValidExternalOwnerKey,
} from "./ownership.ts";

test("self RSVP owner keys are opaque and bounded", () => {
  const key = createExternalOwnerKey(
    () => "019ff8e5-ae97-7e72-afc1-ffd9e6228b34",
  );
  assert.equal(isValidExternalOwnerKey(key), true);
  assert.equal(isValidExternalOwnerKey("short"), false);
  assert.equal(isValidExternalOwnerKey("a".repeat(129)), false);
  assert.equal(isValidExternalOwnerKey("a".repeat(31) + ":"), false);
});

test("owner storage is scoped to one link credential", () => {
  assert.equal(
    externalOwnerStorageKey("019ff8e5-ae97-7e72-afc1-ffd9e6228b34"),
    "authon:self-rsvp-owner:019ff8e5-ae97-7e72-afc1-ffd9e6228b34",
  );
  assert.throws(() => externalOwnerStorageKey("bad token"));
});

test("only contributor links expose a shared roster", () => {
  assert.equal(canUseContributorRoster("contributor"), true);
  assert.equal(canUseContributorRoster("self_rsvp"), false);
});
