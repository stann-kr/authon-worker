import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("development builds upload an undeployed version to the main Worker", async () => {
  const [packageJson, wranglerConfig] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../wrangler.toml", import.meta.url), "utf8"),
  ]);

  assert.equal(
    packageJson.scripts["deploy:dev"],
    "node scripts/ops/require-development-intent.mjs && npm run build:worker && opennextjs-cloudflare upload --tag dev",
  );

  const developmentCommand = packageJson.scripts["deploy:dev"];
  assert.match(developmentCommand, /opennextjs-cloudflare upload --tag dev/);
  assert.doesNotMatch(developmentCommand, /wrangler deploy/);
  assert.doesNotMatch(developmentCommand, /opennextjs-cloudflare deploy/);
  assert.doesNotMatch(developmentCommand, /versions deploy/);
  assert.doesNotMatch(developmentCommand, /--preview-alias/);
  assert.doesNotMatch(developmentCommand, /--env dev/);

  assert.match(wranglerConfig, /^name = "authon-worker"$/m);
  assert.match(wranglerConfig, /^preview_urls = false$/m);
  assert.match(wranglerConfig, /database_name = "authon-db"/);
  assert.match(wranglerConfig, /NEXT_PUBLIC_APP_URL = "https:\/\/guest\.faustseoul\.kr"/);
  assert.doesNotMatch(wranglerConfig, /\[env\.dev\]/);
  assert.doesNotMatch(wranglerConfig, /authon-worker-dev/);
  assert.doesNotMatch(wranglerConfig, /authon-db-dev/);
});
