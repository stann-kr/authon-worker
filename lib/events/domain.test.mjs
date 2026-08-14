import assert from "node:assert/strict";
import test from "node:test";

import {
  canCheckInToEvent,
  canRegisterForEvent,
  canTransitionEventState,
  getCompatibilityEventKey,
  prepareEventDraft,
} from "./domain.ts";

test("event draft validates business time, capacity, and normalized name", () => {
  assert.deepEqual(
    prepareEventDraft({
      businessDate: "2026-08-13",
      name: "  LATE   NIGHT  ",
      doorOpensAt: "2026-08-13T13:00:00.000Z",
      guestCutoffAt: "2026-08-13T18:00:00.000Z",
      capacity: 300,
      targetGuests: 180,
    }),
    {
      draft: {
        businessDate: "2026-08-13",
        name: "LATE NIGHT",
        doorOpensAt: "2026-08-13T13:00:00.000Z",
        guestCutoffAt: "2026-08-13T18:00:00.000Z",
        capacity: 300,
        targetGuests: 180,
        templateSourceEventId: null,
      },
      error: null,
    },
  );
  assert.equal(
    prepareEventDraft({
      businessDate: "2026-08-13",
      name: "Night",
      capacity: 100,
      targetGuests: 101,
    }).error,
    "TARGET_EXCEEDS_CAPACITY",
  );
  assert.equal(
    prepareEventDraft({
      businessDate: "2026-08-13",
      name: "Night",
      doorOpensAt: "2026-08-13T18:00:00.000Z",
      guestCutoffAt: "2026-08-13T13:00:00.000Z",
    }).error,
    "INVALID_EVENT_WINDOW",
  );
});

test("event lifecycle is forward-only and separates registration from check-in", () => {
  assert.equal(canTransitionEventState("draft", "open"), true);
  assert.equal(canTransitionEventState("open", "closed"), true);
  assert.equal(canTransitionEventState("closed", "open"), false);
  assert.equal(canTransitionEventState("archived", "draft"), false);
  assert.equal(canRegisterForEvent("draft"), true);
  assert.equal(canRegisterForEvent("closed"), false);
  assert.equal(canCheckInToEvent("open"), true);
  assert.equal(canCheckInToEvent("draft"), false);
});

test("legacy date scope maps to one deterministic compatibility key", () => {
  assert.equal(
    getCompatibilityEventKey("venue-a", "2026-08-13"),
    "legacy:venue-a:2026-08-13",
  );
  assert.throws(() => getCompatibilityEventKey("venue-a", "2026-02-30"));
});
