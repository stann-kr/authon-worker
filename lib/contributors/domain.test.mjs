import assert from "node:assert/strict";
import test from "node:test";

import {
  getContributorNameKey,
  isContributorKind,
  normalizeContributorDisplayName,
  prepareContributorInput,
} from "./domain.ts";

test("contributor names expose a normalized exact-match key", () => {
  assert.deepEqual(
    prepareContributorInput({ displayName: "  DJ   A  " }),
    {
      contributor: { displayName: "DJ A", nameKey: "DJ A", kind: "dj" },
      error: null,
    },
  );
  assert.equal(normalizeContributorDisplayName("  ＤＪ\tStann  "), "DJ Stann");
  assert.equal(getContributorNameKey("  Dj Stann "), "DJ STANN");
  assert.equal(isContributorKind("dj"), true);
  assert.equal(isContributorKind("promoter"), false);
});

test("contributor input rejects empty, control-character, oversized, and unknown kinds", () => {
  assert.equal(prepareContributorInput({ displayName: " " }).error, "INVALID_DISPLAY_NAME");
  assert.equal(
    prepareContributorInput({ displayName: "DJ\u0001A" }).error,
    "INVALID_DISPLAY_NAME",
  );
  assert.equal(
    prepareContributorInput({ displayName: "DJ\u202eA" }).error,
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
