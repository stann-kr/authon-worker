#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const snapshotPath = process.argv[2] || "migration/supabase-snapshot.json";
const backfillPath = process.argv[3] || "migration/external-link-created-at-backfill.sql";
const brandingPath = process.argv[4] || "migration/venue-branding-bootstrap.sql";
const primaryDomain = String(process.env.MIGRATION_PRIMARY_DOMAIN || "").trim().toLowerCase();
const requestedVenueId = String(process.env.MIGRATION_VENUE_ID || "").trim();

if (!primaryDomain || primaryDomain.includes("://") || /[\s/@]/.test(primaryDomain)) {
  throw new Error("MIGRATION_PRIMARY_DOMAIN must be a hostname without protocol or path");
}

const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const tables = snapshot.tables || {};
const venues = tables.venues || [];
const links = tables.external_dj_links || [];
const guests = tables.guests || [];
const venue = requestedVenueId
  ? venues.find((candidate) => candidate.id === requestedVenueId)
  : venues.filter((candidate) => candidate.active !== false).length === 1
    ? venues.filter((candidate) => candidate.active !== false)[0]
    : null;

if (!venue) {
  throw new Error("Set MIGRATION_VENUE_ID unless the snapshot has exactly one active venue");
}

function sql(value) {
  if (value === undefined || value === null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const invalidLinks = links.filter(
  (link) => !link.id || typeof link.created_at !== "string" || Number.isNaN(new Date(link.created_at).getTime()),
);
if (invalidLinks.length > 0) {
  throw new Error(`${invalidLinks.length} external links have no valid created_at timestamp`);
}

const backfill = [
  "-- Private cutover overlay generated from the verified source snapshot.",
  ...links.map(
    (link) => {
      const usedGuests = guests.filter(
        (guest) => guest.external_link_id === link.id && guest.status !== "deleted",
      ).length;
      return `UPDATE external_dj_links SET created_at = ${sql(link.created_at)}, used_guests = ${usedGuests} WHERE id = ${sql(link.id)};`;
    },
  ),
  "",
].join("\n");

const brandName = String(process.env.MIGRATION_BRAND_NAME || venue.name || "").trim();
if (!brandName) throw new Error("The selected venue has no name; set MIGRATION_BRAND_NAME");

const branding = [
  "-- Private cutover overlay for the venue's canonical domain and brand.",
  `UPDATE venues SET brand_name = ${sql(brandName)}, brand_tagline = ${sql(process.env.MIGRATION_BRAND_TAGLINE || null)}, brand_description = ${sql(process.env.MIGRATION_BRAND_DESCRIPTION || null)}, brand_footer = ${sql(process.env.MIGRATION_BRAND_FOOTER || null)} WHERE id = ${sql(venue.id)};`,
  `UPDATE venue_domains SET is_primary = 0 WHERE venue_id = ${sql(venue.id)};`,
  `INSERT INTO venue_domains (id, hostname, venue_id, scope, is_primary, active, created_at) VALUES (${sql(crypto.randomUUID())}, ${sql(primaryDomain)}, ${sql(venue.id)}, 'venue', 1, 1, ${sql(new Date().toISOString())}) ON CONFLICT(hostname) DO UPDATE SET venue_id = excluded.venue_id, scope = 'venue', is_primary = 1, active = 1;`,
  "",
].join("\n");

await Promise.all([
  mkdir(path.dirname(backfillPath), { recursive: true }),
  mkdir(path.dirname(brandingPath), { recursive: true }),
]);
await Promise.all([
  writeFile(backfillPath, backfill),
  writeFile(brandingPath, branding),
]);

console.log(`Wrote exact created_at and used_guests reconciliation for ${links.length} external links.`);
console.log("Wrote venue branding bootstrap for one venue and one primary domain.");
