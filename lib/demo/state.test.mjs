import assert from "node:assert/strict";
import test from "node:test";

import {
  addDemoGuest,
  createDemoLink,
  createDemoState,
  decideDemoRequest,
  getDemoProgress,
  isDemoState,
  setDemoGuestCheckIn,
} from "./state.ts";

const actionTime = "2026-08-03T14:00:00.000Z";

test("a demo guest is normalized and added without mutating the seed", () => {
  const initial = createDemoState();
  const next = addDemoGuest(
    initial,
    { name: "  New Guest  ", host: "  Touring DJ  ", partySize: 99 },
    actionTime,
  );

  assert.equal(initial.guests.length, 4);
  assert.equal(next.guests.length, 5);
  assert.deepEqual(next.guests[0], {
    id: "guest-20",
    name: "New Guest",
    host: "Touring DJ",
    partySize: 10,
    status: "waiting",
    createdAt: actionTime,
    checkedInAt: null,
  });
  assert.equal(next.completedSteps.guestAdded, true);
});

test("check-in and undo preserve the completed walkthrough step", () => {
  const initial = createDemoState();
  const checked = setDemoGuestCheckIn(initial, "guest-1", true, actionTime);
  const undone = setDemoGuestCheckIn(checked, "guest-1", false, actionTime);

  assert.equal(checked.guests[0].status, "checked_in");
  assert.equal(undone.guests[0].status, "waiting");
  assert.equal(undone.completedSteps.guestCheckedIn, true);
});

test("a pending quota request can only be decided once", () => {
  const initial = createDemoState();
  const approved = decideDemoRequest(initial, "request-1", "approved", actionTime);
  const declinedAgain = decideDemoRequest(approved, "request-1", "declined", actionTime);

  assert.equal(approved.requests[0].status, "approved");
  assert.equal(approved.requests[0].approvedCount, 6);
  assert.strictEqual(declinedAgain, approved);
});

test("creating a link clamps capacity and advances walkthrough progress", () => {
  const initial = createDemoState();
  const next = createDemoLink(initial, { label: "  Afterparty  ", capacity: 0 }, actionTime);

  assert.equal(next.links[0].label, "Afterparty");
  assert.equal(next.links[0].capacity, 1);
  assert.equal(next.completedSteps.linkCreated, true);
  assert.equal(getDemoProgress(next), 1);
});

test("only versioned demo state objects are accepted for restoration", () => {
  assert.equal(isDemoState(createDemoState()), true);
  assert.equal(isDemoState({ version: 2, guests: [] }), false);
  assert.equal(
    isDemoState({ ...createDemoState(), guests: [{ id: "tampered" }] }),
    false,
  );
  assert.equal(isDemoState(null), false);
});
