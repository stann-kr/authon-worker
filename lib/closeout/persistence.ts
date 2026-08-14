import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import type { CloseoutContributorSnapshotMetric } from "./contributor-snapshot.ts";
import {
  CONFIRM_EVENT_CLOSEOUT_SQL,
  INSERT_EVENT_CLOSEOUT_CONTRIBUTOR_METRIC_SQL,
} from "./sql.ts";

export async function persistEventCloseoutConfirmation(params: {
  database: D1Database;
  eventId: string;
  venueId: string;
  confirmedByUserId: string;
  confirmedAt: string;
  reportHash: string;
  registeredCount: number;
  checkedInCount: number;
  sourceActivityCount: number;
  contributorMetrics: readonly CloseoutContributorSnapshotMetric[];
}): Promise<void> {
  const statements: D1PreparedStatement[] = [
    params.database.prepare(CONFIRM_EVENT_CLOSEOUT_SQL).bind(
      params.eventId,
      params.venueId,
      params.confirmedByUserId,
      params.confirmedAt,
      params.reportHash,
      params.registeredCount,
      params.checkedInCount,
      params.sourceActivityCount,
      params.eventId,
      params.venueId,
    ),
    ...params.contributorMetrics.map((metric) =>
      params.database.prepare(INSERT_EVENT_CLOSEOUT_CONTRIBUTOR_METRIC_SQL).bind(
        metric.eventId,
        metric.venueId,
        metric.contributorId,
        metric.sourceKind,
        metric.sourceId,
        metric.registeredCount,
        metric.checkedInCount,
        metric.createdAt,
        params.eventId,
        params.venueId,
        params.confirmedAt,
        params.reportHash,
      ),
    ),
  ];
  await params.database.batch(statements);
}
