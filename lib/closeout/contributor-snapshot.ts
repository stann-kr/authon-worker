import type {
  CloseoutContributorMetric,
  NightCloseoutReport,
} from "./domain.ts";

export const UNATTRIBUTED_CONTRIBUTOR_SOURCE_ID = "unattributed";

export interface CloseoutContributorSnapshotMetric {
  eventId: string;
  venueId: string;
  contributorId: string | null;
  sourceKind: CloseoutContributorMetric["kind"];
  sourceId: string;
  registeredCount: number;
  checkedInCount: number;
  createdAt: string;
}

export type ContributorSnapshotIntegrity =
  | "unconfirmed"
  | "verified"
  | "missing"
  | "drifted";

function sourceId(contributor: CloseoutContributorMetric): string {
  if (contributor.kind === "unattributed") {
    return UNATTRIBUTED_CONTRIBUTOR_SOURCE_ID;
  }
  if (!contributor.id) {
    throw new Error("Attributed closeout contributor requires a source ID");
  }
  return contributor.id;
}

function sourceKey(metric: {
  sourceKind: CloseoutContributorMetric["kind"];
  sourceId: string;
}): string {
  return `${metric.sourceKind}:${metric.sourceId}`;
}

export function buildCloseoutContributorSnapshot(params: {
  eventId: string;
  venueId: string;
  createdAt: string;
  report: NightCloseoutReport;
}): CloseoutContributorSnapshotMetric[] {
  const seen = new Set<string>();
  const metrics = params.report.contributors.map((contributor) => {
    const metric: CloseoutContributorSnapshotMetric = {
      eventId: params.eventId,
      venueId: params.venueId,
      contributorId: contributor.contributorId,
      sourceKind: contributor.kind,
      sourceId: sourceId(contributor),
      registeredCount: contributor.registered,
      checkedInCount: contributor.checkedIn,
      createdAt: params.createdAt,
    };
    const key = sourceKey(metric);
    if (seen.has(key)) {
      throw new Error("Closeout contributor sources must be unique");
    }
    seen.add(key);
    return metric;
  });

  const registered = metrics.reduce((total, metric) => total + metric.registeredCount, 0);
  const checkedIn = metrics.reduce((total, metric) => total + metric.checkedInCount, 0);
  if (registered !== params.report.registered || checkedIn !== params.report.checkedIn) {
    throw new Error("Closeout contributor snapshot does not match event totals");
  }
  return metrics;
}

export function getContributorSnapshotIntegrity(params: {
  isConfirmed: boolean;
  expected: readonly CloseoutContributorSnapshotMetric[];
  persisted: readonly CloseoutContributorSnapshotMetric[];
}): ContributorSnapshotIntegrity {
  if (!params.isConfirmed) return "unconfirmed";
  if (params.persisted.length === 0) {
    return params.expected.length === 0 ? "verified" : "missing";
  }
  if (params.persisted.length !== params.expected.length) return "drifted";

  const expectedBySource = new Map(
    params.expected.map((metric) => [sourceKey(metric), metric]),
  );
  for (const persisted of params.persisted) {
    const expected = expectedBySource.get(sourceKey(persisted));
    if (
      !expected ||
      persisted.eventId !== expected.eventId ||
      persisted.venueId !== expected.venueId ||
      persisted.registeredCount !== expected.registeredCount ||
      persisted.checkedInCount !== expected.checkedInCount
    ) {
      return "drifted";
    }
  }
  return "verified";
}
