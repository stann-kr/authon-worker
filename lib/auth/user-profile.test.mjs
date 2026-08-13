import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCachedUser,
  toClientUser,
} from "./user-profile.ts";

const sessionProfile = {
  id: "user-1",
  venueId: "venue-1",
  email: "staff@example.test",
  name: "Staff",
  role: "staff",
  accountKind: "personal",
  doorAccessEnabled: false,
  guestLimit: null,
  preferredLocale: "ko",
};

test("server session profile preserves unlimited guest quota in the client model", () => {
  assert.equal(toClientUser(sessionProfile).guest_limit, null);
  assert.equal(toClientUser({ ...sessionProfile, guestLimit: 0 }).guest_limit, 0);
});

test("cached profile hydration preserves null and rejects malformed identity", () => {
  assert.equal(
    normalizeCachedUser({
      ...toClientUser(sessionProfile),
      guest_limit: null,
    })?.guest_limit,
    null,
  );
  assert.equal(normalizeCachedUser({ email: "missing-identity@example.test" }), null);
});
