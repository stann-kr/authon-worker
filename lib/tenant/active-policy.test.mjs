import assert from "node:assert/strict";
import test from "node:test";

import {
  hasActiveVenueAccess,
  isInactiveVenueRecoveryUpdate,
} from "./active-policy.ts";

test("tenant users require an assigned active venue", () => {
  assert.equal(
    hasActiveVenueAccess({
      role: "venue_admin",
      venueId: "venue-1",
      venueActive: true,
    }),
    true,
  );
  assert.equal(
    hasActiveVenueAccess({
      role: "venue_admin",
      venueId: "venue-1",
      venueActive: false,
    }),
    false,
  );
  assert.equal(
    hasActiveVenueAccess({
      role: "staff",
      venueId: null,
      venueActive: true,
    }),
    false,
  );
});

test("platform super admins retain the recovery path", () => {
  assert.equal(
    hasActiveVenueAccess({
      role: "super_admin",
      venueId: null,
      venueActive: null,
    }),
    true,
  );
});

test("an inactive venue permits only an exact reactivation update", () => {
  assert.equal(isInactiveVenueRecoveryUpdate(false, { active: true }), true);
  assert.equal(isInactiveVenueRecoveryUpdate(false, { active: false }), false);
  assert.equal(
    isInactiveVenueRecoveryUpdate(false, { active: true, name: "Changed" }),
    false,
  );
  assert.equal(isInactiveVenueRecoveryUpdate(false, { name: "Changed" }), false);
  assert.equal(isInactiveVenueRecoveryUpdate(true, { name: "Changed" }), true);
});
