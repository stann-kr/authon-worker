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
    sourceDisplayName: "Internal DJ A",
    sourceKind: "user",
    sourceId: "source-hidden-by-mapping",
    operatingDays: 2,
    registered: 35,
    checkedIn: 26,
    guestRows: 35,
  },
  {
    contributorId: null,
    displayName: null,
    sourceDisplayName: "DJ Link",
    sourceKind: "external_link",
    sourceId: "unmapped-link",
    operatingDays: 1,
    registered: 5,
    checkedIn: 3,
    guestRows: 5,
  },
  {
    contributorId: null,
    displayName: null,
    sourceDisplayName: null,
    sourceKind: "unattributed",
    sourceId: "unattributed",
    operatingDays: 1,
    registered: 3,
    checkedIn: 2,
    guestRows: 3,
  },
];

const guestDayRows = [
  {
    businessDate: "2026-07-09",
    registeredCount: 20,
    checkedInCount: 10,
  },
  {
    businessDate: "2026-08-07",
    registeredCount: 40,
    checkedInCount: 29,
  },
  {
    businessDate: "2026-08-10",
    registeredCount: 3,
    checkedInCount: 2,
  },
];

const walkInDayRows = [
  { businessDate: "2026-07-09", walkInCount: 4 },
  { businessDate: "2026-08-07", walkInCount: 6 },
  { businessDate: "2026-08-11", walkInCount: 3 },
];

test("guest-bearing dates are included even when no Event exists", () => {
  const view = buildAdminAnalyticsView({
    selection,
    eventRows,
    guestDayRows,
    walkInDayRows,
    contributorRows,
  });
  assert.equal(view.summary.registered.value, 43);
  assert.equal(view.summary.registered.comparisonValue, 20);
  assert.equal(view.summary.registered.relativeChangePercent, 115);
  assert.equal(view.summary.checkedIn.value, 31);
  assert.equal(view.summary.entryRatePercent.value, 72.1);
  assert.equal(view.summary.registeredPerOperatingDay.value, 21.5);
  assert.equal(view.attendance.summary.totalAttendance.value, 40);
  assert.equal(view.attendance.summary.totalAttendance.comparisonValue, 14);
  assert.equal(view.attendance.summary.checkedInGuests.value, 31);
  assert.equal(view.attendance.summary.walkIns.value, 9);
  assert.equal(view.attendance.summary.attendancePerOperatingDay.value, 13.3);
  assert.deepEqual(view.attendance.trend, [
    {
      bucketStartDate: "2026-08-07",
      checkedInGuests: 29,
      walkIns: 6,
      totalAttendance: 35,
      operatingDays: 1,
    },
    {
      bucketStartDate: "2026-08-10",
      checkedInGuests: 2,
      walkIns: 0,
      totalAttendance: 2,
      operatingDays: 1,
    },
    {
      bucketStartDate: "2026-08-11",
      checkedInGuests: 0,
      walkIns: 3,
      totalAttendance: 3,
      operatingDays: 1,
    },
  ]);
  assert.deepEqual(view.trend, [
    {
      bucketStartDate: "2026-08-07",
      registered: 40,
      checkedIn: 29,
      operatingDays: 1,
    },
    {
      bucketStartDate: "2026-08-10",
      registered: 3,
      checkedIn: 2,
      operatingDays: 1,
    },
  ]);
  assert.equal(view.coverage.confirmedEvents, 2);
  assert.equal(view.coverage.operatingDays, 2);
  assert.equal(view.coverage.unconfirmedClosedEvents, 1);
  assert.equal(view.coverage.driftedEvents, 1);
  assert.equal(view.coverage.legacyEvents, 1);
  assert.equal(view.coverage.mappedContributorPercent, 81.4);
  assert.equal(view.events.length, 2);
  assert.equal(view.events[0].status, "drifted");
});

test("mapped, unmapped, and deleted contributor identities remain explicit", () => {
  const view = buildAdminAnalyticsView({
    selection,
    eventRows,
    guestDayRows,
    walkInDayRows,
    contributorRows: [
      { ...contributorRows[0], registered: 34, checkedIn: 25, guestRows: 34 },
      contributorRows[1],
      {
        contributorId: "deleted",
        displayName: null,
        sourceKind: "user",
        sourceId: "deleted",
        operatingDays: 1,
        registered: 4,
        checkedIn: 3,
        guestRows: 4,
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
      { sourceStatus: "unmapped", displayName: "DJ Link" },
      { sourceStatus: "deleted", displayName: "" },
    ],
  );
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("guestName"), false);
  assert.equal(serialized.includes("email"), false);
  assert.equal(serialized.includes("instagram"), false);
  assert.equal(serialized.includes("linkToken"), false);
});

test("same-name unmapped sources stay visible and remain separate", () => {
  const view = buildAdminAnalyticsView({
    selection,
    eventRows,
    guestDayRows,
    walkInDayRows,
    contributorRows: [
      {
        contributorId: null,
        displayName: null,
        sourceDisplayName: "DJ Same",
        sourceKind: "user",
        sourceId: "user-same",
        operatingDays: 2,
        registered: 20,
        checkedIn: 15,
        guestRows: 20,
      },
      {
        contributorId: null,
        displayName: null,
        sourceDisplayName: "DJ Same",
        sourceKind: "external_link",
        sourceId: "link-same",
        operatingDays: 2,
        registered: 23,
        checkedIn: 16,
        guestRows: 23,
      },
    ],
  });

  assert.deepEqual(
    view.contributors.map(({ displayName, sourceStatus, source }) => ({
      displayName,
      sourceStatus,
      source,
    })),
    [
      {
        displayName: "DJ Same",
        sourceStatus: "unmapped",
        source: { kind: "external_link", id: "link-same" },
      },
      {
        displayName: "DJ Same",
        sourceStatus: "unmapped",
        source: { kind: "user", id: "user-same" },
      },
    ],
  );
});

test("invalid rows fail closed instead of returning partial analytics", () => {
  assert.throws(() =>
    buildAdminAnalyticsView({
      selection,
      eventRows: [...eventRows, eventRows[0]],
      guestDayRows,
      walkInDayRows,
      contributorRows,
    }),
  );
  assert.throws(() =>
    buildAdminAnalyticsView({
      selection,
      eventRows,
      guestDayRows,
      walkInDayRows,
      contributorRows: [
        { ...contributorRows[0], checkedIn: 36 },
      ],
    }),
  );
  assert.throws(() =>
    buildAdminAnalyticsView({
      selection,
      eventRows,
      guestDayRows,
      walkInDayRows: [
        { businessDate: "2026-08-11", walkInCount: -1 },
      ],
      contributorRows,
    }),
  );
});
