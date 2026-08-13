import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTypeScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(entryPath);
  }
  return files;
}

test("Worker routes and Server Actions do not emit raw console logs", async () => {
  const root = process.cwd();
  const files = [
    ...await collectTypeScriptFiles(path.join(root, "app", "api")),
    ...await collectTypeScriptFiles(path.join(root, "lib", "api")),
    path.join(root, "lib", "auth", "rate-limit.ts"),
    path.join(root, "middleware.ts"),
  ];
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/console\.(?:error|warn|log)\s*\(/.test(source)) {
      violations.push(path.relative(root, file));
    }
  }

  assert.deepEqual(violations, []);
});
