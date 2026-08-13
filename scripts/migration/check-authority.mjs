import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const MANUAL_MIGRATION_DIRECTORY = "migrations";
export const GENERATED_MIGRATION_DIRECTORY = ".docs/generated-migrations";

const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9][a-z0-9_-]*\.sql$/;

export function inspectMigrationSequence(fileNames) {
  const migrations = fileNames
    .map((fileName) => {
      const match = MIGRATION_FILE_PATTERN.exec(fileName);
      return match ? { fileName, sequence: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence);
  const failures = [];

  if (migrations.length === 0) {
    failures.push("No manual migrations were found.");
    return { migrations, failures };
  }

  const seen = new Set();
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const expected = index + 1;
    if (seen.has(migration.sequence)) {
      failures.push(`Duplicate migration sequence: ${String(migration.sequence).padStart(4, "0")}.`);
    }
    seen.add(migration.sequence);
    if (migration.sequence !== expected) {
      failures.push(
        `Migration sequence must be contiguous: expected ${String(expected).padStart(4, "0")}, found ${String(migration.sequence).padStart(4, "0")}.`,
      );
    }
  }

  return { migrations, failures };
}

export function inspectGeneratorBoundary(configSource) {
  const outputMatch = configSource.match(/\bout\s*:\s*["']([^"']+)["']/);
  const configuredOutput = outputMatch?.[1]?.replace(/^\.\//, "") ?? null;
  const expectedOutput = GENERATED_MIGRATION_DIRECTORY.replace(/^\.\//, "");
  const failures = [];

  if (!configuredOutput) {
    failures.push("drizzle.config.ts must declare an explicit generator output directory.");
  } else if (configuredOutput !== expectedOutput) {
    failures.push(
      `Drizzle generator output must be ${GENERATED_MIGRATION_DIRECTORY}, not ${configuredOutput}.`,
    );
  }

  if (configuredOutput === MANUAL_MIGRATION_DIRECTORY) {
    failures.push("Drizzle generator must never write into the applied manual migration history.");
  }

  return { configuredOutput, failures };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(/^\((.*)\)$/s, "$1").trim();
  if (normalized.toLowerCase() === "true") return "1";
  if (normalized.toLowerCase() === "false") return "0";
  return normalized;
}

function readCatalog(database) {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name));
  const catalog = new Map();

  for (const table of tables) {
    const columns = database
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all()
      .map((row) => ({
        name: String(row.name),
        type: String(row.type).toUpperCase(),
        // SQLite reports `TEXT PRIMARY KEY` as nullable unless NOT NULL is explicit,
        // while Drizzle emits the explicit form. Both carry the same PK contract here.
        notNull: Number(row.pk) > 0 ? 1 : Number(row.notnull),
        primaryKey: Number(row.pk),
        defaultValue: normalizeDefault(row.dflt_value),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const foreignKeys = database
      .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
      .all()
      .map((row) => ({
        from: String(row.from),
        table: String(row.table),
        to: String(row.to),
        onUpdate: String(row.on_update),
        onDelete: String(row.on_delete),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const indexes = database
      .prepare(`PRAGMA index_list(${quoteIdentifier(table)})`)
      .all()
      .map((row) => {
        const indexName = String(row.name);
        const columnsForIndex = database
          .prepare(`PRAGMA index_xinfo(${quoteIdentifier(indexName)})`)
          .all()
          .filter((entry) => Number(entry.key) === 1 && Number(entry.cid) >= 0)
          .map((entry) => `${String(entry.name)}:${Number(entry.desc)}`);
        return {
          unique: Number(row.unique),
          partial: Number(row.partial),
          columns: columnsForIndex,
        };
      });

    catalog.set(table, { columns, foreignKeys, indexes });
  }

  return catalog;
}

function indexSignature(index) {
  return JSON.stringify(index);
}

export function compareMigrationCatalogs(manualCatalog, generatedCatalog) {
  const failures = [];
  const manualTables = [...manualCatalog.keys()].sort();
  const generatedTables = [...generatedCatalog.keys()].sort();

  if (JSON.stringify(manualTables) !== JSON.stringify(generatedTables)) {
    failures.push(
      `Manual and generated table sets differ (manual=${manualTables.join(",")}; generated=${generatedTables.join(",")}).`,
    );
    return failures;
  }

  for (const table of generatedTables) {
    const manual = manualCatalog.get(table);
    const generated = generatedCatalog.get(table);
    if (JSON.stringify(manual.columns) !== JSON.stringify(generated.columns)) {
      failures.push(`Column contract differs for table ${table}.`);
    }
    if (JSON.stringify(manual.foreignKeys) !== JSON.stringify(generated.foreignKeys)) {
      failures.push(`Foreign-key contract differs for table ${table}.`);
    }

    const manualIndexSignatures = new Set(manual.indexes.map(indexSignature));
    for (const generatedIndex of generated.indexes) {
      if (!manualIndexSignatures.has(indexSignature(generatedIndex))) {
        failures.push(`Generated schema index is missing from manual history for table ${table}.`);
      }
    }
  }

  return failures;
}

async function findSqlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findSqlFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".sql")) files.push(entryPath);
  }
  return files.sort();
}

function applySql(database, sql) {
  database.exec(sql.replaceAll("--> statement-breakpoint", "\n"));
}

async function generateExpectedCatalog(root, tempDirectory) {
  const executable = path.join(root, "node_modules", ".bin", "drizzle-kit");
  if (!existsSync(executable)) {
    throw new Error("drizzle-kit is not installed; run npm ci before checking migration authority.");
  }

  const generatedDirectory = path.join(tempDirectory, "generated");
  const result = spawnSync(
    executable,
    [
      "generate",
      "--dialect", "sqlite",
      "--schema", path.join(root, "lib", "db", "schema.ts"),
      "--out", generatedDirectory,
      "--name", "authority_snapshot",
    ],
    { cwd: root, encoding: "utf8", env: process.env },
  );
  if (result.status !== 0) {
    throw new Error("Drizzle schema generation failed in the disposable directory.");
  }

  const generatedSqlFiles = await findSqlFiles(generatedDirectory);
  if (generatedSqlFiles.length !== 1) {
    const diagnostic = result.stdout.trim().split(/\r?\n/).slice(-2).join(" ");
    throw new Error(
      `Expected one disposable baseline migration, found ${generatedSqlFiles.length}.${diagnostic ? ` Generator: ${diagnostic}` : ""}`,
    );
  }

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  applySql(database, await readFile(generatedSqlFiles[0], "utf8"));
  const catalog = readCatalog(database);
  database.close();
  return catalog;
}

async function buildManualCatalog(root, migrations) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) {
    const source = await readFile(
      path.join(root, MANUAL_MIGRATION_DIRECTORY, migration.fileName),
      "utf8",
    );
    applySql(database, source);
  }
  const catalog = readCatalog(database);
  database.close();
  return catalog;
}

export async function checkMigrationAuthority(root = process.cwd()) {
  const migrationDirectory = path.join(root, MANUAL_MIGRATION_DIRECTORY);
  const fileNames = await readdir(migrationDirectory);
  const sequence = inspectMigrationSequence(fileNames);
  const configSource = readFileSync(path.join(root, "drizzle.config.ts"), "utf8");
  const boundary = inspectGeneratorBoundary(configSource);
  const failures = [...sequence.failures, ...boundary.failures];
  if (failures.length > 0) return failures;

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "authon-migration-authority-"));
  try {
    const [manualCatalog, generatedCatalog] = await Promise.all([
      buildManualCatalog(root, sequence.migrations),
      generateExpectedCatalog(root, tempDirectory),
    ]);
    failures.push(...compareMigrationCatalogs(manualCatalog, generatedCatalog));
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
  return failures;
}

async function main() {
  try {
    const failures = await checkMigrationAuthority();
    if (failures.length > 0) {
      for (const failure of failures) console.error(failure);
      process.exitCode = 1;
      return;
    }
    console.log("Manual D1 migration authority check passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration authority check failed.");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
