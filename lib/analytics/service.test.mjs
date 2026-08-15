import assert from "node:assert/strict";
import test from "node:test";

import { resolveAnalyticsPeriod } from "./period.ts";
import { buildAdminAnalyticsView } from "./service.ts";

const selection = resolveAnalyticsPeriod({
  granularity: "month",
  anchorDate: "2026-08-14",
  timezone: "Asia/Seoul",
  now: new Date("2026-09-15T03:00:00.000Z"),
});

const eventRows = [
  {
    eventId: "comparison",
    businessDate: "2026-07-09",
    name: "July",
    state: "closed",
    compatibilityKey: null,
    confirmedAt: "2026-07-10T00:00:00.000Z",
    registeredCount: 20,
    checkedInCount: 10,
    contributorRegisteredCount: 20,
    contributorCheckedInCount: 10,
  },
  {
    eventId: "current-a",
    businessDate: "2026-08-07",
    name: "August A",
    state: "closed",
    compatibilityKey: null,
    confirmedAt: "2026-08-08T00:00:00.000Z",
    registeredCount: 30,
    checkedInCount: 24,
    contributorRegisteredCount: 30,
    contributorCheckedInCount: 24,
  },
  {
    eventId: "current-b",
    businessDate: "2026-08-07",
    name: "August B",
    state: "archived",
    compatibilityKey: null,
    confirmedAt: "2026-08-08T01:00:00.000Z",
    registeredCount: 10,
    checkedInCount: 5,
    contributorRegisteredCount: 9,
    contributorCheckedInCount: 5,
  },
  {
    eventId: "unconfirmed",
    businessDate: "2026-08-08",
    name: "Unconfirmed",
    state: "closed",
    compatibilityKey: null,
    confirmedAt: null,
    registeredCount: null,
    checkedInCount: null,
    contributorRegisteredCount: 0,
    contributorCheckedInCount: 0,
  },
  {
    eventId: "legacy",
    businessDate: "2026-08-09",
    name: "Legacy",
    state: "archived",
    compatibilityKey: "legacy:venue:2026-08-09",
    confirmedAt: null,
    registeredCount: null,
    checkedInCount: null,
    contributorRegisteredCount: 0,
    contributorCheckedInCount: 0,
  },
];

const contributorRows = [
  {
    contributorId: "contributor-a",
    displayName: "DJ A",
    sourceKind: "user",
    sourceId: "source-hidden-by-mapping",
    events: 2,
    registered: 35,
    checkedIn: 26,
    snapshotRows: 3,
  },
  {
    contributorId: null,
    displayName: null,
    sourceKind: "external_link",
    sourceId: "unmapped-link",
    events: 1,
    registered: 5,
    checkedIn: 3,
    snapshotRows: 1,
  },
];

test("analytics service matches manual snapshot totals in one current/comparison view", () => {
  const view = buildAdminAnalyticsView({
    selection,
    eventRows,
    contributorRows,
  });
  assert.equal(view.summary.registered.value, 40);
  assert.equal(view.summary.registered.comparisonValue, 20);
  assert.equal(view.summary.registered.relativeChangePercent, 100);
  assert.equal(view.summary.checkedIn.value, 29);
  assert.equal(view.summary.entryRatePercent.value, 72.5);
  assert.equal(view.summary.registeredPerEvent.value, 20);
  assert.deepEqual(view.trend, [
    {
      bucketStartDate: "2026-08-07",
      registered: 40,
      checkedIn: 29,
      eventCount: 2,
    },
  ]);
  assert.equal(view.coverage.confirmedEvents, 2);
  assert.equal(view.coverage.operatingDays, 1);
  assert.equal(view.coverage.unconfirmedClosedEvents, 1);
  assert.equal(view.coverage.driftedEvents, 1);
  assert.equal(view.coverage.legacyEvents, 1);
  assert.equal(view.coverage.mappedContributorPercent, 75);
  assert.equal(view.events.length, 2);
  assert.equal(view.events[0].status, "drifted");
});

test("mapped, unmapped, and deleted contributor identities remain explicit", () => {
  const view = buildAdminAnalyticsView({
    selection,
    eventRows,
    contributorRows: [
      ...contributorRows,
      {
        contributorId: "deleted",
        displayName: null,
        sourceKind: "user",
        sourceId: "deleted",
        events: 1,
        registered: 1,
        checkedIn: 1,
        snapshotRows: 1,
      },
    ],
  });
  assert.deepEqual(
    view.contributors.map(({ sourceStatus, displayName }) => ({
      sourceStatus,
      displayName,
    })),
    [
      { sourceStatus: "mapped", displayName: "DJ A" },
      { sourceStatus: "unmapped", displayName: "" },
      { sourceStatus: "deleted", displayName: "" },
    ],
  );
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("guestName"), false);
  assert.equal(serialized.includes("email"), false);
  assert.equal(serialized.includes("instagram"), false);
  assert.equal(serialized.includes("linkToken"), false);
});

test("invalid rows fail closed instead of returning partial analytics", () => {
  assert.throws(() =>
    buildAdminAnalyticsView({
      selection,
      eventRows: [...eventRows, eventRows[0]],
      contributorRows,
    }),
  );
  assert.throws(() =>
    buildAdminAnalyticsView({
      selection,
      eventRows,
      contributorRows: [
        { ...contributorRows[0], checkedIn: 36 },
      ],
    }),
  );
});
