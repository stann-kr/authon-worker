import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED_DOCKERIGNORE_RULES = [
  ".docs/",
  "migration/",
  "public/local-users.json",
  ".dev.vars*",
  ".env*.local",
];

const FORBIDDEN_PROJECT_PATHS = ["public/local-users.json"];
const FORBIDDEN_ASSET_PATHS = ["local-users.json"];

function parseOptions(argv) {
  const options = {
    root: process.cwd(),
    assetDirectory: ".open-next/assets",
    checkAssets: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root" && argv[index + 1]) {
      options.root = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === "--asset-directory" && argv[index + 1]) {
      options.assetDirectory = argv[index + 1];
      index += 1;
    } else if (value === "--skip-assets") {
      options.checkAssets = false;
    }
  }

  return options;
}

function getDockerignoreRules(root) {
  const dockerignorePath = path.join(root, ".dockerignore");
  if (!existsSync(dockerignorePath)) return new Set();

  return new Set(
    readFileSync(dockerignorePath, "utf8")
      .split(/\r?\n/)
      .map((rule) => rule.trim())
      .filter((rule) => rule && !rule.startsWith("#")),
  );
}

export function inspectArtifactBoundary({
  root = process.cwd(),
  assetDirectory = ".open-next/assets",
  checkAssets = true,
} = {}) {
  const dockerignoreRules = getDockerignoreRules(root);
  const missingDockerignoreRules = REQUIRED_DOCKERIGNORE_RULES.filter(
    (rule) => !dockerignoreRules.has(rule),
  );
  const assetRoot = path.join(root, assetDirectory);
  const forbiddenProjectPaths = FORBIDDEN_PROJECT_PATHS.filter(
    (relativePath) => existsSync(path.join(root, relativePath)),
  );
  const forbiddenAssets = checkAssets
    ? FORBIDDEN_ASSET_PATHS.filter((relativePath) =>
        existsSync(path.join(assetRoot, relativePath)),
      ).map((relativePath) => path.posix.join(assetDirectory, relativePath))
    : [];

  return { missingDockerignoreRules, forbiddenProjectPaths, forbiddenAssets };
}

export function formatArtifactBoundaryFailures({
  missingDockerignoreRules,
  forbiddenProjectPaths,
  forbiddenAssets,
}) {
  const failures = [];

  if (missingDockerignoreRules.length > 0) {
    failures.push(
      `Missing required .dockerignore rules: ${missingDockerignoreRules.join(", ")}`,
    );
  }

  if (forbiddenProjectPaths.length > 0) {
    failures.push(
      `Forbidden project paths found: ${forbiddenProjectPaths.join(", ")}`,
    );
  }

  if (forbiddenAssets.length > 0) {
    failures.push(
      `Forbidden deployment assets found: ${forbiddenAssets.join(", ")}`,
    );
  }

  return failures;
}

function main() {
  const { root, assetDirectory, checkAssets } = parseOptions(
    process.argv.slice(2),
  );
  const result = inspectArtifactBoundary({ root, assetDirectory, checkAssets });
  const failures = formatArtifactBoundaryFailures(result);

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }

  console.log("Sensitive artifact boundary check passed.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
