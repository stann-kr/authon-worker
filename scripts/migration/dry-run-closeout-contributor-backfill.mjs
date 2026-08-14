#!/usr/bin/env node

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";

import {
  buildNightCloseout,
  closeoutHashPayload,
} from "../../lib/closeout/domain.ts";
import {
  planCloseoutContributorBackfill,
  toSafeCloseoutContributorBackfillReport,
} from "./closeout-contributor-backfill-plan.mjs";

function parseDatabasePath(argv) {
  const index = argv.indexOf("--database");
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value || value.startsWith("--")) {
    throw new Error(
      "Usage: npm run db:backfill:closeout-contributors:dry-run -- --database <local-sqlite-path>",
    );
  }
  return path.resolve(value);
}

function rows(database, sql, ...params) {
  return database
    .prepare(sql)
    .all(...params)
    .map((row) => ({ ...row }));
}

function scopedRows(database, table, event, columns) {
  const includeLegacy =
    event.compatibilityKey ===
    `legacy:${event.venueId}:${event.businessDate}`;
  const scope = includeLegacy
    ? "(event_id = ? OR (event_id IS NULL AND date = ?))"
    : "event_id = ?";
  const params = includeLegacy
    ? [event.venueId, event.eventId, event.businessDate]
    : [event.venueId, event.eventId];
  return rows(
    database,
    `SELECT ${columns} FROM ${table} WHERE venue_id = ? AND ${scope}`,
    ...params,
  );
}

function readBackfillInput(database, header) {
  const guestRows = scopedRows(
    database,
    "guests",
    header,
    `id, status, created_by_user_id AS createdByUserId,
      external_link_id AS externalLinkId, created_at AS createdAt`,
  );
  const activityRows = rows(
    database,
    `SELECT guest_id AS guestId, action, outcome, next_status AS nextStatus,
      channel, occurred_at AS occurredAt, rowid AS sequence
    FROM guest_activity_ledger
    WHERE venue_id = ? AND event_id = ?`,
    header.venueId,
    header.eventId,
  );
  const userRows = rows(
    database,
    `SELECT id, contributor_id AS contributorId, name, guest_limit AS guestLimit
    FROM users WHERE venue_id = ?`,
    header.venueId,
  );
  const linkRows = scopedRows(
    database,
    "external_dj_links",
    header,
    `id, contributor_id AS contributorId, dj_name AS name,
      max_guests AS maxGuests`,
  );
  const configuredLimits = new Map(
    rows(
      database,
      `SELECT user_id AS userId, guest_limit AS guestLimit
      FROM event_contributor_limits
      WHERE venue_id = ? AND event_id = ?`,
      header.venueId,
      header.eventId,
    ).map((row) => [row.userId, row.guestLimit]),
  );
  const includeLegacy =
    header.compatibilityKey ===
    `legacy:${header.venueId}:${header.businessDate}`;
  const approvedExtraRows = includeLegacy
    ? rows(
        database,
        `SELECT user_id AS userId,
          coalesce(sum(approved_extra), 0) AS approvedExtra
        FROM guest_limit_requests
        WHERE venue_id = ? AND status = 'approved'
          AND (event_id = ? OR (event_id IS NULL AND date = ?))
        GROUP BY user_id`,
        header.venueId,
        header.eventId,
        header.businessDate,
      )
    : rows(
        database,
        `SELECT user_id AS userId,
          coalesce(sum(approved_extra), 0) AS approvedExtra
        FROM guest_limit_requests
        WHERE venue_id = ? AND status = 'approved' AND event_id = ?
        GROUP BY user_id`,
        header.venueId,
        header.eventId,
      );
  const approvedExtras = new Map(
    approvedExtraRows.map((row) => [row.userId, Number(row.approvedExtra)]),
  );
  const existingMetrics = rows(
    database,
    `SELECT event_id AS eventId, venue_id AS venueId,
      contributor_id AS contributorId, source_kind AS sourceKind,
      source_id AS sourceId, registered_count AS registeredCount,
      checked_in_count AS checkedInCount, created_at AS createdAt
    FROM event_closeout_contributor_metrics
    WHERE venue_id = ? AND event_id = ?`,
    header.venueId,
    header.eventId,
  );

  const contributors = [
    ...userRows.map((user) => ({
      kind: "user",
      id: user.id,
      contributorId: user.contributorId,
      label: user.name,
      baseLimit: configuredLimits.has(user.id)
        ? configuredLimits.get(user.id)
        : user.guestLimit,
      approvedExtra: approvedExtras.get(user.id) ?? 0,
    })),
    ...linkRows.map((link) => ({
      kind: "external_link",
      id: link.id,
      contributorId: link.contributorId,
      label: link.name,
      baseLimit: link.maxGuests,
      approvedExtra: 0,
    })),
  ];
  const report = buildNightCloseout({
    event: {
      id: header.eventId,
      state: header.state,
      doorOpensAt: header.doorOpensAt,
      createdAt: header.eventCreatedAt,
      openedAt: header.openedAt,
      closedAt: header.closedAt,
    },
    guests: guestRows,
    activities: activityRows,
    contributors,
    confirmedAt: header.confirmedAt,
  });
  return {
    header,
    report,
    reportHash: createHash("sha256")
      .update(closeoutHashPayload(report))
      .digest("hex"),
    existingMetrics,
  };
}

let database;
try {
  const databasePath = parseDatabasePath(process.argv.slice(2));
  database = new DatabaseSync(databasePath, { readOnly: true });
  database.exec("PRAGMA query_only = ON");
  const headers = rows(
    database,
    `SELECT c.event_id AS eventId, c.venue_id AS venueId,
      c.confirmed_at AS confirmedAt, c.report_hash AS reportHash,
      c.registered_count AS registeredCount,
      c.checked_in_count AS checkedInCount,
      c.source_activity_count AS sourceActivityCount,
      e.business_date AS businessDate, e.state,
      e.compatibility_key AS compatibilityKey,
      e.door_opens_at AS doorOpensAt, e.created_at AS eventCreatedAt,
      e.opened_at AS openedAt, e.closed_at AS closedAt
    FROM event_closeouts c
    JOIN events e ON e.id = c.event_id AND e.venue_id = c.venue_id
    ORDER BY c.confirmed_at, c.event_id`,
  );
  const plan = planCloseoutContributorBackfill(
    headers.map((header) => readBackfillInput(database, header)),
  );
  process.stdout.write(
    `${JSON.stringify(toSafeCloseoutContributorBackfillReport(plan), null, 2)}\n`,
  );
  if (plan.some((entry) => entry.status.startsWith("blocked_"))) {
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Closeout contributor backfill dry-run failed"}\n`,
  );
  process.exitCode = 1;
} finally {
  database?.close();
}
