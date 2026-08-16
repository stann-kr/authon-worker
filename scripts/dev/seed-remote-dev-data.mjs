#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectDevelopmentIntent } from "../ops/require-development-intent.mjs";

const databaseBinding = "DB";
const wranglerEnvironment = "dev";
const keychainService = "authon-worker-dev-login";
const venueId = "d0000000-0000-4000-8000-000000000001";
const account = {
  id: "d0000000-0000-4000-8000-000000000101",
  email: "venue-admin@dev.authon.invalid",
  name: "Dev Venue Admin",
};

function createCredential() {
  return `Dev${crypto.randomBytes(24).toString("base64url")}9`;
}

function pbkdf2Hash(plain) {
  const iterations = 100_000;
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(plain, salt, iterations, 32, "sha256");
  return `pbkdf2$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

if (!inspectDevelopmentIntent().ok) {
  throw new Error("Remote development seed requires AUTHON_DEVELOPMENT_INTENT=1.");
}

if (process.platform !== "darwin") {
  throw new Error("Remote development credentials must be stored in macOS Keychain.");
}

const credential = createCredential();
const passwordHash = pbkdf2Hash(credential);
const now = new Date().toISOString();

execFileSync(
  "security",
  [
    "add-generic-password",
    "-U",
    "-s",
    keychainService,
    "-a",
    account.email,
    "-w",
    credential,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const statements = [
  `INSERT INTO venues (id, name, type, address, description, brand_name, brand_tagline, brand_description, brand_footer, timezone, opening_time, closing_time, active) VALUES (${sql(venueId)}, 'Authon Dev', 'private', 'Synthetic remote development venue', 'Synthetic data only', 'Authon Dev', 'Development Environment', 'Synthetic data only', 'Authon Dev', 'Asia/Seoul', '22:00', '06:00', 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, brand_name = excluded.brand_name, brand_tagline = excluded.brand_tagline, brand_description = excluded.brand_description, brand_footer = excluded.brand_footer, timezone = excluded.timezone, opening_time = excluded.opening_time, closing_time = excluded.closing_time, active = 1;`,
  `UPDATE venue_domains SET is_primary = 0 WHERE venue_id = ${sql(venueId)};`,
  `INSERT INTO venue_domains (id, hostname, venue_id, scope, is_primary, active, created_at, default_locale) VALUES ('d0000000-0000-4000-8000-000000000011', 'authon-worker-dev.ilsny7.workers.dev', ${sql(venueId)}, 'venue', 1, 1, ${sql(now)}, 'ko') ON CONFLICT(hostname) DO UPDATE SET venue_id = excluded.venue_id, scope = 'venue', is_primary = 1, active = 1, default_locale = 'ko';`,
  `INSERT INTO users (id, email, password_hash, name, role, account_kind, door_access_enabled, venue_id, guest_limit, active, session_version, migration_status, password_set_at, deleted_at, deleted_by, created_at) VALUES (${sql(account.id)}, ${sql(account.email)}, ${sql(passwordHash)}, ${sql(account.name)}, 'venue_admin', 'personal', 1, ${sql(venueId)}, 20, 1, 0, 'native', ${sql(now)}, NULL, NULL, ${sql(now)}) ON CONFLICT(id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash, name = excluded.name, role = 'venue_admin', account_kind = 'personal', door_access_enabled = 1, venue_id = excluded.venue_id, guest_limit = 20, active = 1, session_version = users.session_version + 1, migration_status = 'native', password_set_at = excluded.password_set_at, deleted_at = NULL, deleted_by = NULL;`,
];

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "authon-remote-dev-seed-"));
const seedFile = path.join(temporaryDirectory, "seed.sql");

try {
  await writeFile(seedFile, `${statements.join("\n")}\n`, { mode: 0o600 });
  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      databaseBinding,
      "--env",
      wranglerEnvironment,
      "--remote",
      "--file",
      seedFile,
      "--yes",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Seeded synthetic development account: ${account.email}`);
console.log(`Credential stored in macOS Keychain service: ${keychainService}`);
