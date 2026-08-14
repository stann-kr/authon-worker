#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { planEventBackfill, toSafeEventBackfillReport } from "./event-backfill-plan.mjs";

function parseDatabasePath(argv) {
  const index = argv.indexOf("--database");
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value || value.startsWith("--")) {
    throw new Error("Usage: npm run db:backfill:events:dry-run -- --database <local-sqlite-path>");
  }
  return path.resolve(value);
}

function readRows(database, table) {
  return database.prepare(`
    SELECT id, venue_id AS venueId, date AS businessDate, event_id AS eventId
    FROM ${table}
  `).all().map((row) => ({ ...row }));
}

function readEvents(database) {
  return database.prepare(`
    SELECT id, venue_id AS venueId, business_date AS businessDate,
      compatibility_key AS compatibilityKey
    FROM events
  `).all().map((row) => ({ ...row }));
}

let database;
try {
  const databasePath = parseDatabasePath(process.argv.slice(2));
  database = new DatabaseSync(databasePath, { readOnly: true });
  database.exec("PRAGMA query_only = ON");
  const plan = planEventBackfill({
    sources: {
      guests: readRows(database, "guests"),
      external_dj_links: readRows(database, "external_dj_links"),
      guest_limit_requests: readRows(database, "guest_limit_requests"),
    },
    events: readEvents(database),
  });
  process.stdout.write(`${JSON.stringify(toSafeEventBackfillReport(plan), null, 2)}\n`);
  if (
    plan.totals.invalidRows > 0 ||
    plan.totals.invalidCompatibilityEvents > 0
  ) {
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Event backfill dry-run failed"}\n`,
  );
  process.exitCode = 1;
} finally {
  database?.close();
}
