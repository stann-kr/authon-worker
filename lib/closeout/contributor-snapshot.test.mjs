import assert from "node:assert/strict";
import test from "node:test";

import { buildNightCloseout } from "./domain.ts";
import {
  buildCloseoutContributorSnapshot,
  getContributorSnapshotIntegrity,
} from "./contributor-snapshot.ts";

const event = {
  id: "event-a",
  state: "closed",
  doorOpensAt: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  openedAt: "2026-08-13T12:00:00.000Z",
  closedAt: "2026-08-14T00:00:00.000Z",
};

test("snapshot keeps same-name canonical contributors separate by stable ID", () => {
  const report = buildNightCloseout({
    event,
    guests: [
      {
        id: "guest-a",
        status: "checked",
        createdByUserId: "user-a",
        createdAt: event.createdAt,
      },
      {
        id: "guest-b",
        status: "pending",
        externalLinkId: "link-b",
        createdAt: event.createdAt,
      },
    ],
    activities: [],
    contributors: [
      {
        kind: "user",
        id: "user-a",
        contributorId: "contributor-a",
        label: "Same Name",
        baseLimit: null,
      },
      {
        kind: "external_link",
        id: "link-b",
        contributorId: "contributor-b",
        label: "Same Name",
        baseLimit: null,
      },
    ],
  });
  const metrics = buildCloseoutContributorSnapshot({
    eventId: event.id,
    venueId: "venue-a",
    createdAt: "2026-08-14T00:05:00.000Z",
    report,
  });

  assert.deepEqual(
    metrics.map(({ contributorId, sourceKind, sourceId }) => ({
      contributorId,
      sourceKind,
      sourceId,
    })),
    [
      { contributorId: "contributor-a", sourceKind: "user", sourceId: "user-a" },
      {
        contributorId: "contributor-b",
        sourceKind: "external_link",
        sourceId: "link-b",
      },
    ],
  );
});

test("snapshot integrity detects missing and changed source aggregates", () => {
  const report = buildNightCloseout({
    event,
    guests: [
      {
        id: "guest-a",
        status: "checked",
        createdAt: event.createdAt,
      },
    ],
    activities: [],
  });
  const expected = buildCloseoutContributorSnapshot({
    eventId: event.id,
    venueId: "venue-a",
    createdAt: "2026-08-14T00:05:00.000Z",
    report,
  });
  assert.equal(
    getContributorSnapshotIntegrity({ isConfirmed: false, expected, persisted: [] }),
    "unconfirmed",
  );
  assert.equal(
    getContributorSnapshotIntegrity({ isConfirmed: true, expected, persisted: [] }),
    "missing",
  );
  assert.equal(
    getContributorSnapshotIntegrity({ isConfirmed: true, expected, persisted: expected }),
    "verified",
  );
  assert.equal(
    getContributorSnapshotIntegrity({
      isConfirmed: true,
      expected,
      persisted: [{ ...expected[0], checkedInCount: 0 }],
    }),
    "drifted",
  );
});

test("snapshot totals fail closed when contributor groups do not cover the event", () => {
  const report = buildNightCloseout({
    event,
    guests: [
      {
        id: "guest-a",
        status: "checked",
        createdByUserId: "user-a",
        createdAt: event.createdAt,
      },
    ],
    activities: [],
    contributors: [],
  });
  assert.doesNotThrow(() =>
    buildCloseoutContributorSnapshot({
      eventId: event.id,
      venueId: "venue-a",
      createdAt: "2026-08-14T00:05:00.000Z",
      report,
    }),
  );

  report.contributors = [];
  assert.throws(() =>
    buildCloseoutContributorSnapshot({
      eventId: event.id,
      venueId: "venue-a",
      createdAt: "2026-08-14T00:05:00.000Z",
      report,
    }),
  );
});
