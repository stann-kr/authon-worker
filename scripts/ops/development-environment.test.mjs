import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PRODUCTION_DATABASE_ID = "b849dd4e-533e-477d-9ef8-cc2e4a00df1f";
const PRODUCTION_KV_ID = "c29d9d86856b41458a8112fb620ae874";

test("development deploy is isolated from production resources", async () => {
  const [packageJson, wranglerConfig, seedScript] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../wrangler.toml", import.meta.url), "utf8"),
    readFile(new URL("../dev/seed-remote-dev-data.mjs", import.meta.url), "utf8"),
  ]);

  assert.equal(
    packageJson.scripts["deploy:dev"],
    "node scripts/ops/require-development-intent.mjs && wrangler deploy --env dev",
  );

  const developmentCommand = packageJson.scripts["deploy:dev"];
  assert.match(developmentCommand, /wrangler deploy --env dev/);
  assert.doesNotMatch(developmentCommand, /opennextjs-cloudflare deploy/);
  assert.doesNotMatch(developmentCommand, /versions deploy/);
  assert.doesNotMatch(developmentCommand, /--preview-alias/);

  assert.match(wranglerConfig, /^name = "authon-worker"$/m);
  assert.match(wranglerConfig, /^workers_dev = true$/m);
  assert.match(wranglerConfig, /^preview_urls = false$/m);
  assert.match(wranglerConfig, /database_name = "authon-db"/);
  assert.match(wranglerConfig, /NEXT_PUBLIC_APP_URL = "https:\/\/guest\.faustseoul\.kr"/);

  const devConfig = wranglerConfig.split("[env.dev]", 2)[1];
  assert.ok(devConfig, "wrangler.toml must define env.dev");
  assert.match(devConfig, /name = "authon-worker-dev"/);
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

  assert.equal(
    packageJson.scripts["db:seed:dev"],
    "node scripts/dev/seed-remote-dev-data.mjs",
  );
  assert.match(seedScript, /inspectDevelopmentIntent\(\)/);
  assert.match(seedScript, /const databaseBinding = "DB"/);
  assert.match(seedScript, /const wranglerEnvironment = "dev"/);
  assert.match(seedScript, /"--remote"/);
  assert.match(seedScript, /authon-worker-dev-login/);
  assert.doesNotMatch(seedScript, new RegExp(PRODUCTION_DATABASE_ID));
  assert.doesNotMatch(seedScript, new RegExp(PRODUCTION_KV_ID));
  assert.doesNotMatch(seedScript, /guest\.faustseoul\.kr/);
});
