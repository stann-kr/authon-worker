import assert from "node:assert/strict";
import test from "node:test";

import {
  canManageTargetAccount,
  canManageTargetRole,
  isRole,
} from "./policy.ts";

test("role allowlist rejects arbitrary values", () => {
  assert.equal(isRole("venue_admin"), true);
  assert.equal(isRole("owner"), false);
  assert.equal(isRole(null), false);
});

test("venue admins can only manage lower roles in their venue", () => {
  const actor = { id: "admin", role: "venue_admin", venueId: "venue-a" };

  assert.equal(
    canManageTargetAccount(actor, {
      id: "staff-a",
      role: "staff",
      venueId: "venue-a",
    }),
    true,
  );
  assert.equal(
    canManageTargetAccount(actor, {
      id: "staff-b",
      role: "staff",
      venueId: "venue-b",
    }),
    false,
  );
  assert.equal(
    canManageTargetAccount(actor, {
      id: "peer-admin",
      role: "venue_admin",
      venueId: "venue-a",
    }),
    false,
  );
});

test("role changes cannot grant or modify super admin scope", () => {
  assert.equal(canManageTargetRole("super_admin", "staff", "venue_admin"), true);
  assert.equal(canManageTargetRole("super_admin", "staff", "super_admin"), false);
  assert.equal(canManageTargetRole("super_admin", "super_admin", "staff"), false);
  assert.equal(canManageTargetRole("venue_admin", "staff", "dj"), true);
  assert.equal(canManageTargetRole("venue_admin", "staff", "venue_admin"), false);
});

test("no administrator can run account actions on themselves", () => {
  assert.equal(
    canManageTargetAccount(
      { id: "same", role: "super_admin", venueId: null },
      { id: "same", role: "super_admin", venueId: null },
    ),
    false,
  );
});
