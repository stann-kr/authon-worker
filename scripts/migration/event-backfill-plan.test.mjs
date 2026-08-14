import assert from "node:assert/strict";
import test from "node:test";

import {
  planEventBackfill,
  toSafeEventBackfillReport,
} from "./event-backfill-plan.mjs";

test("dry-run groups only unlinked legacy rows into deterministic compatibility scopes", () => {
  const plan = planEventBackfill({
    sources: {
      guests: [
        { id: "guest-a", venueId: "venue-a", businessDate: "2026-08-13", eventId: null },
        { id: "guest-linked", venueId: "venue-a", businessDate: "2026-08-13", eventId: "event-a" },
      ],
      external_dj_links: [
        { id: "link-a", venueId: "venue-a", businessDate: "2026-08-13", eventId: null },
      ],
      guest_limit_requests: [
        { id: "limit-a", venueId: "venue-a", businessDate: "2026-08-13", eventId: null },
      ],
    },
    events: [
      { id: "event-a", venueId: "venue-a", businessDate: "2026-08-13", compatibilityKey: null },
      { id: "event-b", venueId: "venue-a", businessDate: "2026-08-13", compatibilityKey: null },
    ],
  });

  assert.deepEqual(plan.totals, {
    scopes: 1,
    compatibilityEventsToCreate: 1,
    rowsToLink: 3,
    invalidRows: 0,
    invalidCompatibilityEvents: 0,
  });
  assert.equal(plan.targets[0].explicitEventsOnDate, 2);
  assert.deepEqual(plan.targets[0].counts, {
    guests: 1,
    external_dj_links: 1,
    guest_limit_requests: 1,
  });
});

test("an existing compatibility event is reused and invalid dates stop promotion", () => {
  const plan = planEventBackfill({
    sources: {
      guests: [
        { id: "guest-a", venueId: "venue-a", businessDate: "2026-08-13", eventId: null },
        { id: "guest-bad", venueId: "venue-a", businessDate: "2026-02-30", eventId: null },
      ],
      external_dj_links: [],
      guest_limit_requests: [],
    },
    events: [{
      id: "compat-a",
      venueId: "venue-a",
      businessDate: "2026-08-13",
      compatibilityKey: "legacy:venue-a:2026-08-13",
    }],
  });

  assert.equal(plan.targets[0].existingEventId, "compat-a");
  assert.equal(plan.targets[0].needsCompatibilityEvent, false);
  assert.equal(plan.totals.invalidRows, 1);
});

test("safe reports do not expose venue or row identifiers", () => {
  const report = toSafeEventBackfillReport(planEventBackfill({
    sources: {
      guests: [{ id: "sensitive-row", venueId: "private-venue", businessDate: "bad", eventId: null }],
      external_dj_links: [],
      guest_limit_requests: [],
    },
    events: [],
  }));
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("private-venue"), false);
  assert.equal(serialized.includes("sensitive-row"), false);
  assert.equal(report.writesPerformed, 0);
});
