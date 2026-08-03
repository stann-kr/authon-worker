import assert from "node:assert/strict";
import test from "node:test";

import {
  canDiscoverTargetRole,
  canManageTargetAccount,
  canManageTargetRole,
  canRequestGuestLimit,
  hasAccess,
  isAccountKind,
  isRole,
} from "./policy.ts";

test("only super admins can discover super admin accounts", () => {
  assert.equal(canDiscoverTargetRole("super_admin", "super_admin"), true);
  assert.equal(canDiscoverTargetRole("venue_admin", "super_admin"), false);
  assert.equal(canDiscoverTargetRole("door_staff", "super_admin"), false);
  assert.equal(canDiscoverTargetRole("venue_admin", "staff"), true);
});

test("role allowlist rejects arbitrary values", () => {
  assert.equal(isRole("venue_admin"), true);
  assert.equal(isRole("owner"), false);
  assert.equal(isRole(null), false);
});

test("account kind allowlist rejects arbitrary values", () => {
  assert.equal(isAccountKind("personal"), true);
  assert.equal(isAccountKind("shared"), true);
  assert.equal(isAccountKind("team"), false);
});

test("shared accounts receive optional door access without an admin role", () => {
  const shared = { role: "staff", accountKind: "shared", doorAccessEnabled: false };
  assert.equal(hasAccess(shared, ["guest"]), true);
  assert.equal(hasAccess(shared, ["door"]), false);
  assert.equal(hasAccess({ ...shared, doorAccessEnabled: true }, ["door"]), true);
  assert.equal(hasAccess({ ...shared, doorAccessEnabled: true }, ["admin"]), false);
});

test("only personal staff and DJ accounts can request additional quota", () => {
  assert.equal(
    canRequestGuestLimit({ role: "staff", accountKind: "personal", doorAccessEnabled: false }),
    true,
  );
  assert.equal(
    canRequestGuestLimit({ role: "dj", accountKind: "personal", doorAccessEnabled: false }),
    true,
  );
  assert.equal(
    canRequestGuestLimit({ role: "staff", accountKind: "shared", doorAccessEnabled: true }),
    false,
  );
  assert.equal(
    canRequestGuestLimit({ role: "door_staff", accountKind: "personal", doorAccessEnabled: false }),
    false,
  );
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
