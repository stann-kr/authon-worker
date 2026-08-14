import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PRODUCTION_DATABASE_ID = "b849dd4e-533e-477d-9ef8-cc2e4a00df1f";
const PRODUCTION_KV_ID = "c29d9d86856b41458a8112fb620ae874";

test("development deploy is isolated from production resources", async () => {
  const [packageJson, wranglerConfig] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../wrangler.toml", import.meta.url), "utf8"),
  ]);

  assert.equal(
    packageJson.scripts["deploy:dev"],
    "node scripts/ops/require-development-intent.mjs && wrangler deploy --env dev",
  );

  const devConfig = wranglerConfig.split("[env.dev]", 2)[1];
  assert.ok(devConfig, "wrangler.toml must define env.dev");
  assert.match(devConfig, /workers_dev = true/);
  assert.match(devConfig, /preview_urls = false/);
  assert.match(devConfig, /routes = \[\]/);
  assert.match(devConfig, /binding = "DB"/);
  assert.match(devConfig, /database_name = "authon-db-dev"/);
  assert.match(devConfig, /migrations_dir = "migrations"/);
  assert.match(devConfig, /binding = "SESSIONS"/);
  assert.match(
    devConfig,
    /NEXT_PUBLIC_APP_URL = "https:\/\/authon-worker-dev\.ilsny7\.workers\.dev"/,
  );
  assert.doesNotMatch(devConfig, new RegExp(PRODUCTION_DATABASE_ID));
  assert.doesNotMatch(devConfig, new RegExp(PRODUCTION_KV_ID));
  assert.doesNotMatch(devConfig, /guest\.faustseoul\.kr/);
});
