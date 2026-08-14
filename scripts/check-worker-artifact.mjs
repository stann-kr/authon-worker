import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REQUIRED_ROUTES = [
  "/api/auth/login",
  "/api/auth/password-reset-requests",
  "/api/auth/password-reset-requests/status",
  "/api/auth/reset-password",
  "/api/internal/sync-guest",
];
const RETIRED_ROUTES = ["/api/admin/migrate"];
const FORBIDDEN_ASSETS = ["local-users.json"];

export function inspectWorkerArtifact(root = process.cwd()) {
  const workerPath = path.join(root, ".open-next", "worker.js");
  const manifestPath = path.join(
    root,
    ".open-next",
    "server-functions",
    "default",
    ".next",
    "app-path-routes-manifest.json",
  );
  const failures = [];

  if (!existsSync(workerPath) || statSync(workerPath).size === 0) {
    failures.push("OpenNext Worker entrypoint is missing or empty.");
  }
  if (!existsSync(manifestPath)) {
    failures.push("OpenNext app route manifest is missing.");
    return failures;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const builtRoutes = new Set(Object.values(manifest));
  for (const route of REQUIRED_ROUTES) {
    if (!builtRoutes.has(route)) failures.push(`Required Worker route is missing: ${route}.`);
  }
  for (const route of RETIRED_ROUTES) {
    if (builtRoutes.has(route)) failures.push(`Retired Worker route is still built: ${route}.`);
  }
  for (const asset of FORBIDDEN_ASSETS) {
    if (existsSync(path.join(root, ".open-next", "assets", asset))) {
      failures.push(`Forbidden Worker asset is present: ${asset}.`);
    }
  }
  return failures;
}

function main() {
  try {
    const failures = inspectWorkerArtifact();
    if (failures.length > 0) {
      for (const failure of failures) console.error(failure);
      process.exitCode = 1;
      return;
    }
    console.log("Worker route and asset smoke check passed.");
  } catch {
    console.error("Worker artifact smoke check failed.");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
