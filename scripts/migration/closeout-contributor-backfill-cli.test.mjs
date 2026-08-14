import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildNightCloseout,
  closeoutHashPayload,
} from "../../lib/closeout/domain.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

function applyMigrations(database) {
  const migrationDirectory = path.join(root, "migrations");
  for (const fileName of readdirSync(migrationDirectory).sort()) {
    if (!fileName.endsWith(".sql")) continue;
    database.exec(
      readFileSync(path.join(migrationDirectory, fileName), "utf8").replaceAll(
        "--> statement-breakpoint",
        "\n",
      ),
    );
  }
}

function seedEligibleCloseout(database) {
  const createdAt = "2026-08-13T00:00:00.000Z";
  const openedAt = "2026-08-13T12:00:00.000Z";
  const closedAt = "2026-08-14T00:00:00.000Z";
  const confirmedAt = "2026-08-14T00:05:00.000Z";
  database.exec(`
    INSERT INTO venues (id, name, type) VALUES ('venue-a', 'Venue', 'club');
    INSERT INTO users (
      id, email, password_hash, name, role, venue_id, created_at
    ) VALUES
      ('admin-a', 'admin@example.invalid', 'hash', 'Admin', 'venue_admin',
        'venue-a', '${createdAt}'),
      ('dj-a', 'dj@example.invalid', 'hash', 'DJ A', 'dj',
        'venue-a', '${createdAt}');
    INSERT INTO events (
      id, venue_id, business_date, name, state, created_at, updated_at,
      opened_at, closed_at
    ) VALUES (
      'event-a', 'venue-a', '2026-08-13', 'Night', 'closed',
      '${createdAt}', '${closedAt}', '${openedAt}', '${closedAt}'
    );
    INSERT INTO guests (
      id, venue_id, name, created_by_user_id, event_id, status,
      date, created_at, updated_at
    ) VALUES (
      'guest-a', 'venue-a', 'Private Guest', 'dj-a', 'event-a', 'checked',
      '2026-08-13', '${createdAt}', '${closedAt}'
    );
    INSERT INTO guest_activity_ledger (
      id, venue_id, event_id, guest_id, action, actor_type, channel,
      request_id, outcome, next_status, occurred_at
    ) VALUES
      ('activity-a', 'venue-a', 'event-a', 'guest-a', 'add', 'user', 'guest',
        'request-a', 'applied', 'pending', '${createdAt}'),
      ('activity-b', 'venue-a', 'event-a', 'guest-a', 'check_in', 'user', 'door',
        'request-b', 'applied', 'checked', '${openedAt}');
  `);

  const report = buildNightCloseout({
    event: {
      id: "event-a",
      state: "closed",
      doorOpensAt: null,
      createdAt,
      openedAt,
      closedAt,
    },
    guests: [
      {
        id: "guest-a",
        status: "checked",
        createdByUserId: "dj-a",
        externalLinkId: null,
        createdAt,
      },
    ],
    activities: [
      {
        guestId: "guest-a",
        action: "add",
        outcome: "applied",
        nextStatus: "pending",
        channel: "guest",
        occurredAt: createdAt,
        sequence: 1,
      },
      {
        guestId: "guest-a",
        action: "check_in",
        outcome: "applied",
        nextStatus: "checked",
        channel: "door",
        occurredAt: openedAt,
        sequence: 2,
      },
    ],
    contributors: [
      {
        kind: "user",
        id: "dj-a",
        contributorId: null,
        label: "DJ A",
        baseLimit: null,
        approvedExtra: 0,
      },
    ],
    confirmedAt,
  });
  const reportHash = createHash("sha256")
    .update(closeoutHashPayload(report))
    .digest("hex");
  database.prepare(`
    INSERT INTO event_closeouts (
      event_id, venue_id, confirmed_by_user_id, confirmed_at,
      report_hash, registered_count, checked_in_count, source_activity_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "event-a",
    "venue-a",
    "admin-a",
    confirmedAt,
    reportHash,
    report.registered,
    report.checkedIn,
    report.ledger.sourceActivityCount,
  );
}

test("backfill CLI reads a disposable database without writing snapshot rows", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "authon-closeout-backfill-"));
  const databasePath = path.join(directory, "fixture.sqlite");
  let database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database);
    seedEligibleCloseout(database);
    database.close();

    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        path.join(root, "scripts/migration/dry-run-closeout-contributor-backfill.mjs"),
        "--database",
        databasePath,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "read_only");
    assert.equal(report.writesPerformed, 0);
    assert.equal(report.totals.eligible, 1);
    assert.equal(result.stdout.includes("Private Guest"), false);
    assert.equal(result.stdout.includes("DJ A"), false);

    database = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(
      database
        .prepare("SELECT count(*) AS count FROM event_closeout_contributor_metrics")
        .get().count,
      0,
    );
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
