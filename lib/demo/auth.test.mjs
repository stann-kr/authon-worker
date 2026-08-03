import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_ACCOUNTS,
  authenticateDemoAccount,
  getDemoAccess,
  isDemoSession,
} from "./auth.ts";

test("a fictional demo account creates a password-free session", () => {
  const account = DEMO_ACCOUNTS[0];
  const session = authenticateDemoAccount(`  ${account.email.toUpperCase()} `, account.password);

  assert.deepEqual(session, {
    version: 1,
    accountId: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
  });
  assert.equal("password" in session, false);
});

test("invalid credentials do not create a demo session", () => {
  assert.equal(authenticateDemoAccount("venue.admin@demo.authon.app", "wrong"), null);
  assert.equal(authenticateDemoAccount("unknown@demo.authon.app", "Demo2026!"), null);
});

test("role access exposes only the matching demo workspaces", () => {
  assert.deepEqual(getDemoAccess("venue_admin"), ["guests", "door", "requests", "links"]);
  assert.deepEqual(getDemoAccess("door_staff"), ["guests", "door"]);
  assert.deepEqual(getDemoAccess("dj"), ["guests"]);
});

test("restored sessions must match a known fictional account", () => {
  const account = DEMO_ACCOUNTS[1];
  const valid = authenticateDemoAccount(account.email, account.password);

  assert.equal(isDemoSession(valid), true);
  assert.equal(isDemoSession({ ...valid, role: "venue_admin" }), false);
  assert.equal(isDemoSession({ ...valid, accountId: "production-user" }), false);
});
