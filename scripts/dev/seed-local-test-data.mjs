#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const database = "authon-db";
const venueId = "local-test-venue";
const now = new Date().toISOString();
const suppliedPassword = process.env.LOCAL_TEST_PASSWORD?.trim();
const password = suppliedPassword || `Local!${crypto.randomBytes(9).toString("base64url")}`;
const passwordHash = pbkdf2Hash(password);

const accounts = [
  ["super-admin@local.test", "Local Super Admin", "super_admin", null, "native"],
  ["venue-admin@local.test", "Local Venue Admin", "venue_admin", venueId, "native"],
  ["door-staff@local.test", "Local Door Staff", "door_staff", venueId, "native"],
  ["staff@local.test", "Local Staff", "staff", venueId, "native"],
  ["dj@local.test", "Local DJ", "dj", venueId, "native"],
  ["first-login@local.test", "Local First Login", "staff", venueId, "pending_reset"],
];

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

const statements = [
  `INSERT INTO venues (id, name, type, address, description, brand_name, brand_tagline, active) VALUES (${sql(venueId)}, 'FAUST', 'club', 'Local test venue', 'Host-based branding fixture', 'FAUST', 'Guest Management System', 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, brand_name = excluded.brand_name, brand_tagline = excluded.brand_tagline, active = 1;`,
  `UPDATE venue_domains SET is_primary = 0 WHERE venue_id = ${sql(venueId)};`,
  `INSERT INTO venue_domains (id, hostname, venue_id, scope, is_primary, active, created_at) VALUES (${sql(crypto.randomUUID())}, 'faust.localhost', ${sql(venueId)}, 'venue', 1, 1, ${sql(now)}) ON CONFLICT(hostname) DO UPDATE SET venue_id = excluded.venue_id, scope = 'venue', is_primary = 1, active = 1;`,
  ...accounts.map(([email, name, role, accountVenueId, migrationStatus]) =>
    `INSERT INTO users (id, email, password_hash, name, role, venue_id, guest_limit, active, session_version, migration_status, password_set_at, created_at) VALUES (${sql(crypto.randomUUID())}, ${sql(email)}, ${sql(passwordHash)}, ${sql(name)}, ${sql(role)}, ${sql(accountVenueId)}, 20, 1, 0, ${sql(migrationStatus)}, ${migrationStatus === "pending_reset" ? "NULL" : sql(now)}, ${sql(now)}) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = excluded.role, venue_id = excluded.venue_id, active = 1, session_version = users.session_version + 1, migration_status = excluded.migration_status, password_set_at = excluded.password_set_at;`,
  ),
];

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "authon-local-seed-"));
const seedFile = path.join(temporaryDirectory, "seed.sql");
try {
  await writeFile(seedFile, `${statements.join("\n")}\n`, { mode: 0o600 });
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", database, "--local", "--file", seedFile],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Seeded local venue domain: http://faust.localhost:3000");
console.log(`Seeded ${accounts.length} local accounts using password: ${password}`);
console.log(`Emails: ${accounts.map(([email]) => email).join(", ")}`);
