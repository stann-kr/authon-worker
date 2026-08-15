import assert from "node:assert/strict";
import test from "node:test";

import { resolveAnalyticsPeriod } from "./period.ts";
import {
  aggregateContributorSnapshots,
  summarizeAnalyticsSnapshotPeriod,
} from "./snapshots.ts";

const eventSnapshots = [
  { eventId: "event-jan", businessDate: "2026-01-10", registered: 10, checkedIn: 8 },
  { eventId: "event-apr", businessDate: "2026-04-10", registered: 20, checkedIn: 15 },
  { eventId: "event-aug", businessDate: "2026-08-10", registered: 30, checkedIn: 24 },
];

const contributorSnapshots = [
  {
    eventId: "event-jan",
    businessDate: "2026-01-10",
    contributorId: "contributor-a",
    sourceKind: "user",
    sourceId: "user-a",
    registeredCount: 10,
    checkedInCount: 8,
  },
  {
    eventId: "event-apr",
    businessDate: "2026-04-10",
    contributorId: "contributor-a",
    sourceKind: "external_link",
    sourceId: "link-a",
    registeredCount: 20,
    checkedInCount: 15,
  },
  {
    eventId: "event-aug",
    businessDate: "2026-08-10",
    contributorId: "contributor-b",
    sourceKind: "user",
    sourceId: "user-b",
    registeredCount: 30,
    checkedInCount: 24,
  },
];

test("month, quarter, and year totals remain available from snapshots without guest rows", () => {
  const now = new Date("2027-01-10T03:00:00.000Z");
  const expected = { month: 30, quarter: 30, year: 60 };
  for (const granularity of ["month", "quarter", "year"]) {
    const selection = resolveAnalyticsPeriod({
      granularity,
      anchorDate: "2026-08-10",
      timezone: "Asia/Seoul",
      now,
    });
    const summary = summarizeAnalyticsSnapshotPeriod(
      eventSnapshots,
      selection.period,
    );
    assert.equal(summary.registered, expected[granularity]);
  }
});

test("canonical contributor IDs merge explicit sources and never merge same-name IDs", () => {
  const rows = aggregateContributorSnapshots(contributorSnapshots, [
    { id: "contributor-a", displayName: "Same Name" },
    { id: "contributor-b", displayName: "Same Name" },
  ]);
  assert.deepEqual(
    rows.map(({ contributorId, operatingDays, registered, checkedIn }) => ({
      contributorId,
      operatingDays,
      registered,
      checkedIn,
    })),
    [
      { contributorId: "contributor-b", operatingDays: 1, registered: 30, checkedIn: 24 },
      { contributorId: "contributor-a", operatingDays: 2, registered: 30, checkedIn: 23 },
    ],
  );
});

test("unmapped and deleted contributors remain explicit without source display names", () => {
  const rows = aggregateContributorSnapshots(
    [
      {
        eventId: "event-a",
        businessDate: "2026-08-01",
        contributorId: null,
        sourceKind: "external_link",
        sourceId: "link-private",
        registeredCount: 2,
        checkedInCount: 1,
      },
      {
        eventId: "event-a",
        businessDate: "2026-08-01",
        contributorId: "deleted-contributor",
        sourceKind: "user",
        sourceId: "user-private",
        registeredCount: 1,
        checkedInCount: 1,
      },
    ],
    [],
  );
  assert.deepEqual(
    rows.map(({ sourceStatus, displayName }) => ({ sourceStatus, displayName })),
    [
      { sourceStatus: "unmapped", displayName: "" },
      { sourceStatus: "deleted", displayName: "" },
    ],
  );
});

test("duplicate or invalid snapshot rows fail closed", () => {
  const duplicate = contributorSnapshots[0];
  assert.throws(() =>
    aggregateContributorSnapshots([duplicate, duplicate], []),
  );
  assert.throws(() =>
    aggregateContributorSnapshots(
      [{ ...duplicate, registeredCount: 1, checkedInCount: 2 }],
      [],
    ),
  );
});
