import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectWorkerArtifact } from "./check-worker-artifact.mjs";

const ROUTES = {
  "/api/auth/login/route": "/api/auth/login",
  "/api/auth/password-reset-requests/route": "/api/auth/password-reset-requests",
  "/api/auth/password-reset-requests/status/route": "/api/auth/password-reset-requests/status",
  "/api/auth/reset-password/route": "/api/auth/reset-password",
  "/api/internal/sync-guest/route": "/api/internal/sync-guest",
};

async function createArtifact(t, routes = ROUTES) {
  const root = await mkdtemp(path.join(os.tmpdir(), "authon-worker-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestDirectory = path.join(
    root,
    ".open-next",
    "server-functions",
    "default",
    ".next",
  );
  await mkdir(manifestDirectory, { recursive: true });
  await mkdir(path.join(root, ".open-next", "assets"), { recursive: true });
  await writeFile(path.join(root, ".open-next", "worker.js"), "export default {};");
  await writeFile(
    path.join(manifestDirectory, "app-path-routes-manifest.json"),
    JSON.stringify(routes),
  );
  return root;
}

test("built Worker contains priority routes and no retired migration surface", async (t) => {
  const root = await createArtifact(t);
  assert.deepEqual(inspectWorkerArtifact(root), []);
});

test("built Worker rejects missing priority routes and retired public artifacts", async (t) => {
  const root = await createArtifact(t, {
    ...ROUTES,
    "/api/admin/migrate/route": "/api/admin/migrate",
  });
  await writeFile(path.join(root, ".open-next", "assets", "local-users.json"), "private");
  const failures = inspectWorkerArtifact(root);
  assert.match(failures.join("\n"), /Retired Worker route/);
  assert.match(failures.join("\n"), /Forbidden Worker asset/);
});
