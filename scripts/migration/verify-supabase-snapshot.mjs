#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const snapshotPath = process.argv[2] || 'migration/supabase-snapshot.json';
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const tables = snapshot.tables || {};
const allowReconciledGuestCounts = process.env.ALLOW_RECONCILED_GUEST_COUNTS === '1';

function ids(rows) {
  return new Set((rows || []).map((row) => row.id).filter(Boolean));
}

function countMissing(rows, field, allowedIds, allowNull = true) {
  const missing = [];
  for (const row of rows || []) {
    const value = row[field];
    if ((value === null || value === undefined || value === '') && allowNull) continue;
    if (!allowedIds.has(value)) missing.push({ id: row.id, [field]: value });
  }
  return missing;
}

const venueIds = ids(tables.venues);
const userIds = ids(tables.users);
const externalLinkIds = ids(tables.external_dj_links);

function invalidTimestampRows(rows, field) {
  return (rows || []).flatMap((row) => {
    const value = row[field];
    if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
      return [{ id: row.id, [field]: value ?? null }];
    }
    return [];
  });
}

const findings = {
  counts: {
    venues: (tables.venues || []).length,
    users: (tables.users || []).length,
    guests: (tables.guests || []).length,
    external_dj_links: (tables.external_dj_links || []).length,
  },
  missingVenueRefs: {
    users: countMissing(tables.users, 'venue_id', venueIds, true),
    guests: countMissing(tables.guests, 'venue_id', venueIds, false),
    external_dj_links: countMissing(tables.external_dj_links, 'venue_id', venueIds, false),
  },
  missingUserRefs: {
    guests_created_by_user_id: countMissing(tables.guests, 'created_by_user_id', userIds, true),
    external_dj_links_created_by: countMissing(tables.external_dj_links, 'created_by', userIds, true),
  },
  missingExternalLinkRefs: {
    guests_external_link_id: countMissing(tables.guests, 'external_link_id', externalLinkIds, true),
  },
  invalidTimestamps: {
    external_dj_links_created_at: invalidTimestampRows(
      tables.external_dj_links,
      'created_at',
    ),
  },
  usedGuestsDrift: [],
};

for (const link of tables.external_dj_links || []) {
  const actual = (tables.guests || []).filter((guest) => guest.external_link_id === link.id && guest.status !== 'deleted').length;
  const stored = Number(link.used_guests || 0);
  if (actual !== stored) {
    findings.usedGuestsDrift.push({ id: link.id, stored, actual, delta: actual - stored });
  }
}

console.log(JSON.stringify(findings, null, 2));

const hasFailures = Object.values(findings.missingVenueRefs).some((arr) => arr.length > 0)
  || Object.values(findings.missingUserRefs).some((arr) => arr.length > 0)
  || Object.values(findings.missingExternalLinkRefs).some((arr) => arr.length > 0)
  || Object.values(findings.invalidTimestamps).some((arr) => arr.length > 0)
  || (!allowReconciledGuestCounts && findings.usedGuestsDrift.length > 0);

if (allowReconciledGuestCounts && findings.usedGuestsDrift.length > 0) {
  console.log(`Cutover generator will reconcile ${findings.usedGuestsDrift.length} used_guests counters from active guest rows.`);
}

if (hasFailures) process.exit(1);
