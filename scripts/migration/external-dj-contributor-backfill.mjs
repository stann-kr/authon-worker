#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  getExternalDjCreatedAuditId,
  getExternalDjMappedAuditId,
  planExternalDjContributorBackfill,
  toSafeExternalDjBackfillReport,
} from "../../lib/contributors/external-dj.ts";
import { inspectProductionIntent } from "../ops/require-production-intent.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const wranglerExecutable = path.join(root, "node_modules", ".bin", "wrangler");
const databaseName = "authon-db";

const CONTRIBUTOR_QUERY = `
  SELECT id, venue_id AS venueId, display_name AS displayName,
    name_key AS nameKey, active
  FROM venue_contributors
  ORDER BY venue_id, id
`;

const PRE_DIRECTORY_CONTRIBUTOR_QUERY = `
  SELECT id, venue_id AS venueId, display_name AS displayName,
    NULL AS nameKey, active
  FROM venue_contributors
  ORDER BY venue_id, id
`;

const EXTERNAL_LINK_QUERY = `
  SELECT id, venue_id AS venueId, dj_name AS djName,
    contributor_id AS contributorId, kind,
    deleted_at AS deletedAt, created_at AS createdAt
  FROM external_dj_links
  WHERE kind = 'contributor'
  ORDER BY venue_id, id
`;

function usage() {
  return [
    "Usage:",
    "  node --experimental-strip-types scripts/migration/external-dj-contributor-backfill.mjs --database <local-sqlite-path>",
    "  node --experimental-strip-types scripts/migration/external-dj-contributor-backfill.mjs --database <local-sqlite-path> --apply --expected-plan-hash <sha256>",
    "  node --experimental-strip-types scripts/migration/external-dj-contributor-backfill.mjs --remote",
    "  node --experimental-strip-types scripts/migration/external-dj-contributor-backfill.mjs --remote --apply --expected-plan-hash <sha256>",
  ].join("\n");
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith("--") ? value : null;
}

export function parseExternalDjBackfillOptions(argv) {
  const isRemote = argv.includes("--remote");
  const databasePathValue = optionValue(argv, "--database");
  const isApply = argv.includes("--apply");
  const expectedPlanHash = optionValue(argv, "--expected-plan-hash");
  if (isRemote === Boolean(databasePathValue)) throw new Error(usage());
  if (
    isApply &&
    (!expectedPlanHash || !/^[a-f0-9]{64}$/.test(expectedPlanHash))
  ) {
    throw new Error(usage());
  }
  return {
    isRemote,
    databasePath: databasePathValue
      ? path.resolve(databasePathValue)
      : null,
    isApply,
    expectedPlanHash,
  };
}

function rows(database, sql) {
  return database
    .prepare(sql)
    .all()
    .map((row) => ({ ...row }));
}

function normalizeInputRows(contributors, links) {
  return {
    contributors: contributors.map((row) => ({
      id: String(row.id),
      venueId: String(row.venueId),
      displayName: String(row.displayName),
      nameKey: row.nameKey === null ? null : String(row.nameKey),
      active: Boolean(row.active),
    })),
    links: links.map((row) => ({
      id: String(row.id),
      venueId: String(row.venueId),
      djName: String(row.djName),
      contributorId:
        row.contributorId === null ? null : String(row.contributorId),
      kind: String(row.kind),
      deletedAt: row.deletedAt === null ? null : String(row.deletedAt),
      createdAt: row.createdAt === null ? null : String(row.createdAt),
    })),
  };
}

function readLocalInput(database) {
  return normalizeInputRows(
    rows(database, CONTRIBUTOR_QUERY),
    rows(database, EXTERNAL_LINK_QUERY),
  );
}

export function parseExternalDjBackfillWranglerJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const normalized = stdout.replace(
      /\u001B\[[0-?]*[ -/]*[@-~]/gu,
      "",
    );
    const end = normalized.lastIndexOf("]");
    parsed = null;
    for (
      let start = normalized.indexOf("[");
      start >= 0 && end >= start;
      start = normalized.indexOf("[", start + 1)
    ) {
      try {
        const candidate = JSON.parse(normalized.slice(start, end + 1));
        if (Array.isArray(candidate)) {
          parsed = candidate;
          break;
        }
      } catch {
        // Progress output can contain non-JSON brackets before the final array.
      }
    }
    if (!parsed) throw new Error("Unexpected Wrangler response.");
  }
  if (!Array.isArray(parsed)) throw new Error("Unexpected Wrangler response.");
  return parsed;
}

function runRemoteWrangler(args, failureMessage) {
  const result = spawnSync(wranglerExecutable, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(failureMessage);
  try {
    return parseExternalDjBackfillWranglerJson(result.stdout);
  } catch {
    throw new Error(failureMessage);
  }
}

function readRemoteRows(query) {
  const response = runRemoteWrangler(
    [
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--json",
      "--command",
      query,
    ],
    "Remote D1 backfill read failed.",
  );
  return response.flatMap((entry) =>
    Array.isArray(entry?.results) ? entry.results : [],
  );
}

function readRemoteInput() {
  let contributors;
  try {
    contributors = readRemoteRows(CONTRIBUTOR_QUERY);
  } catch {
    contributors = readRemoteRows(PRE_DIRECTORY_CONTRIBUTOR_QUERY);
  }
  return normalizeInputRows(
    contributors,
    readRemoteRows(EXTERNAL_LINK_QUERY),
  );
}

export function getExternalDjBackfillPlanHash(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function buildApplyStatements(plan, appliedAt) {
  const statements = [];

  for (const update of plan.contributorNameKeyUpdates) {
    statements.push(`
      UPDATE venue_contributors
      SET name_key = ${sqlString(update.nameKey)},
        updated_at = ${sqlString(appliedAt)}
      WHERE id = ${sqlString(update.contributorId)}
        AND venue_id = ${sqlString(update.venueId)}
        AND name_key IS NULL
    `);
  }

  for (const group of plan.groups) {
    if (group.shouldCreateContributor) {
      statements.push(`
        INSERT INTO venue_contributors (
          id, venue_id, display_name, name_key, kind, active,
          created_at, updated_at
        ) VALUES (
          ${sqlString(group.contributorId)},
          ${sqlString(group.venueId)},
          ${sqlString(group.displayName)},
          ${sqlString(group.nameKey)},
          'dj', 1, ${sqlString(appliedAt)}, ${sqlString(appliedAt)}
        )
      `);
      statements.push(`
        INSERT INTO contributor_audit_events (
          id, venue_id, contributor_id, actor_user_id, source_kind,
          source_id, action, details, created_at
        ) VALUES (
          ${sqlString(getExternalDjCreatedAuditId(group.contributorId))},
          ${sqlString(group.venueId)},
          ${sqlString(group.contributorId)},
          NULL, 'contributor', ${sqlString(group.contributorId)}, 'created',
          '{"kind":"dj","source":"external_dj_exact_name_backfill"}',
          ${sqlString(appliedAt)}
        )
      `);
    }

    for (const sourceId of group.sourceIdsToMap) {
      statements.push(`
        UPDATE external_dj_links
        SET contributor_id = ${sqlString(group.contributorId)}
        WHERE id = ${sqlString(sourceId)}
          AND venue_id = ${sqlString(group.venueId)}
          AND kind = 'contributor'
          AND contributor_id IS NULL
      `);
      statements.push(`
        INSERT INTO contributor_audit_events (
          id, venue_id, contributor_id, actor_user_id, source_kind,
          source_id, action, details, created_at
        ) VALUES (
          ${sqlString(
            await getExternalDjMappedAuditId(group.contributorId, sourceId),
          )},
          ${sqlString(group.venueId)},
          ${sqlString(group.contributorId)},
          NULL, 'external_link', ${sqlString(sourceId)}, 'mapped',
          '{"reason":"external_dj_exact_name_backfill"}',
          ${sqlString(appliedAt)}
        )
      `);
    }
  }

  return statements.map((statement) => `${statement.trim()};`);
}

function applyLocally(database, statements) {
  if (statements.length === 0) return 0;
  const changesBefore = database.totalChanges;
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) database.exec(statement);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return database.totalChanges - changesBefore;
}

function applyRemotely(statements) {
  if (statements.length === 0) return 0;
  const directory = mkdtempSync(
    path.join(tmpdir(), "authon-external-dj-backfill-"),
  );
  const sqlPath = path.join(directory, "backfill.sql");
  try {
    writeFileSync(sqlPath, `${statements.join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const response = runRemoteWrangler(
      [
        "d1",
        "execute",
        databaseName,
        "--remote",
        "--json",
        "--yes",
        "--file",
        sqlPath,
      ],
      "Remote D1 backfill command did not report success.",
    );
    const result = response[0];
    const summary = Array.isArray(result?.results) ? result.results[0] : null;
    return Number(summary?.["Rows written"] ?? result?.meta?.rows_written ?? 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function isVerificationComplete(report) {
  return (
    report.totals.contributorsToCreate === 0 &&
    report.totals.sourcesToMap === 0 &&
    report.totals.contributorNameKeysToSet === 0 &&
    report.totals.conflicts === 0
  );
}

async function main() {
  let database;
  try {
    const options = parseExternalDjBackfillOptions(process.argv.slice(2));
    if (options.isRemote && options.isApply) {
      const productionIntent = inspectProductionIntent();
      if (!productionIntent.ok) {
        throw new Error(
          `Production operation blocked. Set these explicit controls: ${productionIntent.missing.join(", ")}`,
        );
      }
    }

    if (options.databasePath) {
      database = new DatabaseSync(options.databasePath, {
        readOnly: !options.isApply,
      });
      database.exec("PRAGMA foreign_keys = ON");
      if (!options.isApply) database.exec("PRAGMA query_only = ON");
    }

    const input = options.isRemote
      ? readRemoteInput()
      : readLocalInput(database);
    const plan = await planExternalDjContributorBackfill(input);
    const planHash = getExternalDjBackfillPlanHash(plan);
    const safeReport = {
      ...toSafeExternalDjBackfillReport(plan),
      planHash,
    };

    if (!options.isApply) {
      process.stdout.write(`${JSON.stringify(safeReport, null, 2)}\n`);
      if (plan.conflicts.length > 0) process.exitCode = 2;
      return;
    }
    if (plan.conflicts.length > 0) {
      process.stdout.write(`${JSON.stringify(safeReport, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    if (options.expectedPlanHash !== planHash) {
      throw new Error(
        "Backfill plan changed after dry-run; review the new plan hash before applying.",
      );
    }

    const statements = await buildApplyStatements(plan, new Date().toISOString());
    const writesPerformed = options.isRemote
      ? applyRemotely(statements)
      : applyLocally(database, statements);
    const verificationInput = options.isRemote
      ? readRemoteInput()
      : readLocalInput(database);
    const verificationPlan = await planExternalDjContributorBackfill(
      verificationInput,
    );
    const verificationReport = toSafeExternalDjBackfillReport(verificationPlan);
    const verificationComplete = isVerificationComplete(verificationReport);
    process.stdout.write(
      `${JSON.stringify(
        {
          ...safeReport,
          mode: "applied",
          writesPerformed,
          verification: {
            complete: verificationComplete,
            totals: verificationReport.totals,
          },
        },
        null,
        2,
      )}\n`,
    );
    if (!verificationComplete) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "External DJ contributor backfill failed."}\n`,
    );
    process.exitCode = 1;
  } finally {
    database?.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
