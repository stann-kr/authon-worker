import { createHash } from "node:crypto";

import {
  buildCloseoutContributorSnapshot,
  getContributorSnapshotIntegrity,
} from "../../lib/closeout/contributor-snapshot.ts";

function headerMatchesReport(header, report, reportHash) {
  return (
    header.reportHash === reportHash &&
    header.registeredCount === report.registered &&
    header.checkedInCount === report.checkedIn &&
    header.sourceActivityCount === report.ledger.sourceActivityCount
  );
}

export function planCloseoutContributorBackfill(inputs) {
  return inputs.map((input) => {
    const expectedMetrics = buildCloseoutContributorSnapshot({
      eventId: input.header.eventId,
      venueId: input.header.venueId,
      createdAt: input.header.confirmedAt,
      report: input.report,
    });
    if (!headerMatchesReport(input.header, input.report, input.reportHash)) {
      return {
        eventId: input.header.eventId,
        status: "blocked_drifted",
        metrics: [],
      };
    }

    const integrity = getContributorSnapshotIntegrity({
      isConfirmed: true,
      expected: expectedMetrics,
      persisted: input.existingMetrics,
    });
    if (integrity === "verified") {
      return {
        eventId: input.header.eventId,
        status: "already_snapshotted",
        metrics: [],
      };
    }
    if (integrity === "drifted") {
      return {
        eventId: input.header.eventId,
        status: "blocked_partial_snapshot",
        metrics: [],
      };
    }
    return {
      eventId: input.header.eventId,
      status: "eligible",
      metrics: expectedMetrics,
    };
  });
}

function eventReference(eventId) {
  return createHash("sha256").update(eventId).digest("hex").slice(0, 12);
}

export function toSafeCloseoutContributorBackfillReport(plan) {
  const totals = {
    closeouts: plan.length,
    eligible: plan.filter((entry) => entry.status === "eligible").length,
    alreadySnapshotted: plan.filter(
      (entry) => entry.status === "already_snapshotted",
    ).length,
    blockedDrifted: plan.filter((entry) => entry.status === "blocked_drifted").length,
    blockedPartialSnapshot: plan.filter(
      (entry) => entry.status === "blocked_partial_snapshot",
    ).length,
    metricRowsToInsert: plan.reduce(
      (total, entry) => total + entry.metrics.length,
      0,
    ),
  };
  return {
    mode: "read_only",
    writesPerformed: 0,
    totals,
    closeouts: plan.map((entry) => ({
      eventRef: eventReference(entry.eventId),
      status: entry.status,
      metricRows: entry.metrics.length,
    })),
  };
}
