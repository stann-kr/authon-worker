import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseExternalDjBackfillWranglerJson } from "./external-dj-contributor-backfill.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(
  root,
  "scripts/migration/external-dj-contributor-backfill.mjs",
);

test("Wrangler JSON parser tolerates non-data progress output", () => {
  assert.deepEqual(
    parseExternalDjBackfillWranglerJson(
      `Warning before JSON\n[{"results":[],"success":true}]\nDone`,
    ),
    [{ results: [], success: true }],
  );
});

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

function runCli(args, env = process.env) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", cliPath, ...args],
    { cwd: root, encoding: "utf8", env },
  );
}

function seedExternalLinks(database) {
  database.exec(`
    INSERT INTO venues (id, name, type)
    VALUES ('venue-a', 'Venue', 'club');

    INSERT INTO venue_contributors (
      id, venue_id, display_name, name_key, kind, active,
      created_at, updated_at
    ) VALUES (
      'internal-contributor', 'venue-a', 'DJ STANN', NULL, 'dj', 1,
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    );

    INSERT INTO external_dj_links (
      id, venue_id, token, dj_name, event, date, max_guests,
      used_guests, active, expires_at, created_at, locale_mode, kind,
      deleted_at
    ) VALUES
      (
        'link-live', 'venue-a', 'token-live', 'DJ STANN', 'Night',
        '2026-08-16', 10, 0, 1, NULL, '2026-08-16T00:00:00.000Z',
        'auto', 'contributor', NULL
      ),
      (
        'link-archived', 'venue-a', 'token-archived', '  dj   stann ',
        'Night', '2026-08-01', 10, 0, 0, NULL,
        '2026-08-01T00:00:00.000Z', 'auto', 'contributor',
        '2026-08-10T00:00:00.000Z'
      ),
      (
        'link-self', 'venue-a', 'token-self', 'DJ STANN', 'Night',
        '2026-08-16', 1, 0, 1, NULL, '2026-08-16T00:00:00.000Z',
        'auto', 'self_rsvp', NULL
      );
  `);
}

test("external DJ backfill dry-run is private and apply groups live and archived links", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "authon-external-dj-"));
  const databasePath = path.join(directory, "fixture.sqlite");
  let database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database);
    seedExternalLinks(database);
    database.close();

    const dryRun = runCli(["--database", databasePath]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryReport = JSON.parse(dryRun.stdout);
    assert.equal(dryReport.mode, "read_only");
    assert.equal(dryReport.writesPerformed, 0);
    assert.equal(dryReport.totals.groups, 1);
    assert.equal(dryReport.totals.contributorsToCreate, 1);
    assert.equal(dryReport.totals.sources, 2);
    assert.equal(dryReport.totals.sourcesToMap, 2);
    assert.equal(dryReport.totals.archivedSourcesToMap, 1);
    assert.equal(dryReport.totals.conflicts, 0);
    assert.match(dryReport.planHash, /^[a-f0-9]{64}$/);
    assert.equal(dryRun.stdout.includes("DJ STANN"), false);
    assert.equal(dryRun.stdout.includes("link-live"), false);

    database = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(
      database.prepare("SELECT count(*) AS count FROM venue_contributors").get()
        .count,
      1,
    );
    database.close();

    const apply = runCli([
      "--database",
      databasePath,
      "--apply",
      "--expected-plan-hash",
      dryReport.planHash,
    ]);
    assert.equal(apply.status, 0, apply.stderr);
    const applyReport = JSON.parse(apply.stdout);
    assert.equal(applyReport.mode, "applied");
    assert.equal(applyReport.verification.complete, true);
    assert.equal(applyReport.verification.totals.sourcesToMap, 0);
    assert.equal(applyReport.verification.totals.contributorsToCreate, 0);
    assert.equal(apply.stdout.includes("DJ STANN"), false);

    database = new DatabaseSync(databasePath, { readOnly: true });
    const mapped = database
      .prepare(`
        SELECT count(DISTINCT contributor_id) AS contributors,
          sum(CASE WHEN contributor_id IS NULL THEN 1 ELSE 0 END) AS unmapped
        FROM external_dj_links
        WHERE kind = 'contributor'
      `)
      .get();
    assert.deepEqual(
      { contributors: mapped.contributors, unmapped: mapped.unmapped },
      { contributors: 1, unmapped: 0 },
    );
    assert.equal(
      database
        .prepare(`
          SELECT contributor_id AS contributorId
          FROM external_dj_links WHERE id = 'link-self'
        `)
        .get().contributorId,
      null,
    );
    assert.equal(
      database
        .prepare("SELECT count(*) AS count FROM contributor_audit_events")
        .get().count,
      3,
    );
    assert.equal(
      database
        .prepare(`
          SELECT name_key AS nameKey
          FROM venue_contributors WHERE id = 'internal-contributor'
        `)
        .get().nameKey,
      null,
    );
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("remote external DJ apply requires explicit production controls", () => {
  const env = { ...process.env };
  delete env.AUTHON_PRODUCTION_INTENT;
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  const result = runCli(
    [
      "--remote",
      "--apply",
      "--expected-plan-hash",
      "0".repeat(64),
    ],
    env,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production operation blocked/);
});
