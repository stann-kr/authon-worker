import assert from "node:assert/strict";
import test from "node:test";

import { buildNightCloseout, closeoutHashPayload } from "../../lib/closeout/domain.ts";
import {
  planCloseoutContributorBackfill,
  toSafeCloseoutContributorBackfillReport,
} from "./closeout-contributor-backfill-plan.mjs";
import { createHash } from "node:crypto";

const confirmedAt = "2026-08-14T00:05:00.000Z";

function fixture(overrides = {}) {
  const report = buildNightCloseout({
    event: {
      id: "event-sensitive-a",
      state: "closed",
      doorOpensAt: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      openedAt: "2026-08-13T12:00:00.000Z",
      closedAt: "2026-08-14T00:00:00.000Z",
    },
    guests: [
      {
        id: "guest-sensitive-a",
        status: "checked",
        createdByUserId: "user-sensitive-a",
        createdAt: "2026-08-13T00:00:00.000Z",
      },
    ],
    activities: [],
    contributors: [
      {
        kind: "user",
        id: "user-sensitive-a",
        contributorId: "contributor-sensitive-a",
        label: "Private DJ Name",
        baseLimit: null,
      },
    ],
    confirmedAt,
  });
  const reportHash = createHash("sha256")
    .update(closeoutHashPayload(report))
    .digest("hex");
  return {
    header: {
      eventId: "event-sensitive-a",
      venueId: "venue-sensitive-a",
      confirmedAt,
      reportHash,
      registeredCount: report.registered,
      checkedInCount: report.checkedIn,
      sourceActivityCount: report.ledger.sourceActivityCount,
    },
    report,
    reportHash,
    existingMetrics: [],
    ...overrides,
  };
}

test("only exact closeout reports become backfill candidates", () => {
  const [eligible] = planCloseoutContributorBackfill([fixture()]);
  assert.equal(eligible.status, "eligible");
  assert.equal(eligible.metrics.length, 1);
  assert.equal(eligible.metrics[0].sourceId, "user-sensitive-a");

  for (const mismatch of [
    { registeredCount: 2 },
    { checkedInCount: 0 },
    { sourceActivityCount: 1 },
    { reportHash: "f".repeat(64) },
  ]) {
    const input = fixture();
    const [blocked] = planCloseoutContributorBackfill([
      { ...input, header: { ...input.header, ...mismatch } },
    ]);
    assert.equal(blocked.status, "blocked_drifted");
    assert.equal(blocked.metrics.length, 0);
  }
});

test("verified snapshots are skipped and partial snapshots are blocked", () => {
  const input = fixture();
  const [eligible] = planCloseoutContributorBackfill([input]);
  const [already] = planCloseoutContributorBackfill([
    { ...input, existingMetrics: eligible.metrics },
  ]);
  assert.equal(already.status, "already_snapshotted");

  const [partial] = planCloseoutContributorBackfill([
    {
      ...input,
      existingMetrics: [{ ...eligible.metrics[0], registeredCount: 2 }],
    },
  ]);
  assert.equal(partial.status, "blocked_partial_snapshot");
});

test("safe dry-run output exposes no event, venue, source, contributor, or guest identity", () => {
  const report = toSafeCloseoutContributorBackfillReport(
    planCloseoutContributorBackfill([fixture()]),
  );
  const serialized = JSON.stringify(report);
  for (const sensitive of [
    "event-sensitive-a",
    "venue-sensitive-a",
    "user-sensitive-a",
    "contributor-sensitive-a",
    "guest-sensitive-a",
    "Private DJ Name",
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
  assert.equal(report.writesPerformed, 0);
  assert.equal(report.totals.eligible, 1);
});
