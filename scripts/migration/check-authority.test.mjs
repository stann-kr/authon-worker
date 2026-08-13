import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_MIGRATION_DIRECTORY,
  inspectGeneratorBoundary,
  inspectMigrationSequence,
} from "./check-authority.mjs";

test("manual migration history must start at 0001 and remain contiguous", () => {
  const valid = inspectMigrationSequence([
    "0003_add_index.sql",
    "README.md",
    "0001_init.sql",
    "0002_add_user.sql",
  ]);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.migrations.map((migration) => migration.sequence), [1, 2, 3]);

  const gap = inspectMigrationSequence(["0001_init.sql", "0003_add_index.sql"]);
  assert.match(gap.failures.join("\n"), /expected 0002, found 0003/);
});

test("duplicate migration sequence is rejected", () => {
  const result = inspectMigrationSequence([
    "0001_init.sql",
    "0001_other.sql",
  ]);
  assert.match(result.failures.join("\n"), /Duplicate migration sequence: 0001/);
});

test("Drizzle generator is isolated from applied migrations", () => {
  const valid = inspectGeneratorBoundary(
    `export default { out: './${GENERATED_MIGRATION_DIRECTORY}' }`,
  );
  assert.deepEqual(valid.failures, []);

  const unsafe = inspectGeneratorBoundary("export default { out: './migrations' }");
  assert.match(unsafe.failures.join("\n"), /must never write/);
});
