import assert from "node:assert/strict";
import test from "node:test";

import {
  isContributorKind,
  prepareContributorInput,
} from "./domain.ts";

test("contributor names normalize without becoming identity keys", () => {
  assert.deepEqual(
    prepareContributorInput({ displayName: "  DJ   A  " }),
    {
      contributor: { displayName: "DJ A", kind: "dj" },
      error: null,
    },
  );
  assert.equal(isContributorKind("dj"), true);
  assert.equal(isContributorKind("promoter"), false);
});

test("contributor input rejects empty, control-character, oversized, and unknown kinds", () => {
  assert.equal(prepareContributorInput({ displayName: " " }).error, "INVALID_DISPLAY_NAME");
  assert.equal(
    prepareContributorInput({ displayName: "DJ\nA" }).error,
    "INVALID_DISPLAY_NAME",
  );
  assert.equal(
    prepareContributorInput({ displayName: "A".repeat(101) }).error,
    "INVALID_DISPLAY_NAME",
  );
  assert.equal(
    prepareContributorInput({ displayName: "DJ A", kind: "promoter" }).error,
    "INVALID_KIND",
  );
});
