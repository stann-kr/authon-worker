import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatArtifactBoundaryFailures,
  inspectArtifactBoundary,
} from "./check-sensitive-assets.mjs";

const DOCKERIGNORE_RULES = [
  ".docs/",
  "migration/",
  "public/local-users.json",
  ".dev.vars*",
  ".env*.local",
].join("\n");

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "authon-sensitive-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, ".dockerignore"), DOCKERIGNORE_RULES);
  await mkdir(path.join(root, ".open-next", "assets"), { recursive: true });
  return root;
}

test("artifact boundary accepts an allowlisted Docker context and clean Worker assets", async (t) => {
  const root = await createFixture(t);

  const result = inspectArtifactBoundary({ root });

  assert.deepEqual(result, {
    missingDockerignoreRules: [],
    forbiddenProjectPaths: [],
    forbiddenAssets: [],
  });
  assert.deepEqual(formatArtifactBoundaryFailures(result), []);
});

test("artifact boundary rejects the retired public legacy-user source", async (t) => {
  const root = await createFixture(t);
  await mkdir(path.join(root, "public"), { recursive: true });
  await writeFile(
    path.join(root, "public", "local-users.json"),
    "test-value-that-must-never-be-reported",
  );

  const result = inspectArtifactBoundary({ root });
  const failures = formatArtifactBoundaryFailures(result);

  assert.deepEqual(result.forbiddenProjectPaths, ["public/local-users.json"]);
  assert.match(failures.join("\n"), /public\/local-users\.json/);
  assert.doesNotMatch(failures.join("\n"), /test-value-that-must-never-be-reported/);
});

test("artifact boundary rejects a legacy public user asset without reading its contents", async (t) => {
  const root = await createFixture(t);
  await writeFile(
    path.join(root, ".open-next", "assets", "local-users.json"),
    "test-value-that-must-never-be-reported",
  );

  const result = inspectArtifactBoundary({ root });
  const failures = formatArtifactBoundaryFailures(result);

  assert.deepEqual(result.forbiddenAssets, [".open-next/assets/local-users.json"]);
  assert.match(failures.join("\n"), /local-users\.json/);
  assert.doesNotMatch(failures.join("\n"), /test-value-that-must-never-be-reported/);
});

test("source-only prebuild inspection ignores stale generated assets", async (t) => {
  const root = await createFixture(t);
  await writeFile(
    path.join(root, ".open-next", "assets", "local-users.json"),
    "stale-generated-value",
  );

  const result = inspectArtifactBoundary({ root, checkAssets: false });

  assert.deepEqual(result.forbiddenAssets, []);
});

test("artifact boundary requires every Docker context exclusion", async (t) => {
  const root = await createFixture(t);
  await writeFile(path.join(root, ".dockerignore"), "migration/\n");

  const result = inspectArtifactBoundary({ root });

  assert.deepEqual(result.missingDockerignoreRules, [
    ".docs/",
    "public/local-users.json",
    ".dev.vars*",
    ".env*.local",
  ]);
});
