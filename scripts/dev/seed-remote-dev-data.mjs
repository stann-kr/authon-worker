#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const databaseBinding = "DB";
const wranglerEnvironment = "dev";
const keychainService = "authon-worker-dev-bootstrap";
const venueId = "d0000000-0000-4000-8000-000000000001";
const now = new Date().toISOString();

const bootstrapAccounts = [
  {
    id: "d0000000-0000-4000-8000-000000000101",
    email: "super-admin@dev.authon.invalid",
    name: "Dev Super Admin",
    role: "super_admin",
    venueId: null,
  },
  {
    id: "d0000000-0000-4000-8000-000000000102",
    email: "venue-admin@dev.authon.invalid",
    name: "Dev Venue Admin",
    role: "venue_admin",
    venueId,
  },
];

const resetTarget = {
  id: "d0000000-0000-4000-8000-000000000201",
  email: "reset-target@dev.authon.invalid",
  name: "Dev Reset Target",
  role: "staff",
  venueId,
};

function createCredential() {
  return crypto.randomBytes(24).toString("base64url");
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

function storeBootstrapCredential(account, credential) {
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-U",
      "-s",
      keychainService,
      "-a",
      account,
      "-w",
      credential,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

if (process.platform !== "darwin") {
  throw new Error("원격 dev bootstrap credential은 macOS Keychain에서만 생성할 수 있습니다.");
}

execFileSync("security", ["list-keychains"], {
  stdio: ["ignore", "ignore", "inherit"],
});

const preparedBootstrapAccounts = bootstrapAccounts.map((account) => {
  const credential = createCredential();
  storeBootstrapCredential(account.email, credential);
  return { ...account, passwordHash: pbkdf2Hash(credential) };
});

const resetTargetPasswordHash = pbkdf2Hash(createCredential());
const allUserIds = [...bootstrapAccounts.map(({ id }) => id), resetTarget.id];
const userIdList = allUserIds.map(sql).join(", ");

const statements = [
  `INSERT INTO venues (id, name, type, address, description, brand_name, brand_tagline, brand_description, brand_footer, timezone, opening_time, closing_time, active) VALUES (${sql(venueId)}, 'Authon Dev', 'private', 'Synthetic remote dev fixture', 'Remote D1 password reset test venue', 'Authon Dev', 'Remote Test Environment', 'Synthetic data only', 'Authon Dev', 'Asia/Seoul', '22:00', '06:00', 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, brand_name = excluded.brand_name, brand_tagline = excluded.brand_tagline, brand_description = excluded.brand_description, brand_footer = excluded.brand_footer, active = 1;`,
  `DELETE FROM password_reset_requests WHERE user_id IN (${userIdList});`,
  `DELETE FROM password_reset_tokens WHERE user_id IN (${userIdList});`,
  ...preparedBootstrapAccounts.map((account) =>
    `INSERT INTO users (id, email, password_hash, name, role, account_kind, door_access_enabled, venue_id, guest_limit, active, session_version, migration_status, password_set_at, deleted_at, deleted_by, created_at) VALUES (${sql(account.id)}, ${sql(account.email)}, ${sql(account.passwordHash)}, ${sql(account.name)}, ${sql(account.role)}, 'personal', 0, ${sql(account.venueId)}, ${account.role === "super_admin" ? "NULL" : "20"}, 1, 0, 'pending_reset', NULL, NULL, NULL, ${sql(now)}) ON CONFLICT(id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash, name = excluded.name, role = excluded.role, account_kind = 'personal', door_access_enabled = 0, venue_id = excluded.venue_id, guest_limit = excluded.guest_limit, active = 1, session_version = users.session_version + 1, migration_status = 'pending_reset', password_set_at = NULL, deleted_at = NULL, deleted_by = NULL;`,
  ),
  `INSERT INTO users (id, email, password_hash, name, role, account_kind, door_access_enabled, venue_id, guest_limit, active, session_version, migration_status, password_set_at, deleted_at, deleted_by, created_at) VALUES (${sql(resetTarget.id)}, ${sql(resetTarget.email)}, ${sql(resetTargetPasswordHash)}, ${sql(resetTarget.name)}, ${sql(resetTarget.role)}, 'personal', 0, ${sql(resetTarget.venueId)}, 20, 1, 0, 'native', ${sql(now)}, NULL, NULL, ${sql(now)}) ON CONFLICT(id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash, name = excluded.name, role = excluded.role, account_kind = 'personal', door_access_enabled = 0, venue_id = excluded.venue_id, guest_limit = 20, active = 1, session_version = users.session_version + 1, migration_status = 'native', password_set_at = excluded.password_set_at, deleted_at = NULL, deleted_by = NULL;`,
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
    { stdio: ["ignore", "inherit", "inherit"] },
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Seeded ${allUserIds.length} synthetic accounts into the remote dev D1 database.`);
console.log(`Bootstrap credentials are stored in macOS Keychain service: ${keychainService}`);
