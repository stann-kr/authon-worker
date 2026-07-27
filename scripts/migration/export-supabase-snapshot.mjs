#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT = process.argv[2] || 'migration/supabase-snapshot.json';
const TABLES = ['venues', 'users', 'guests', 'external_dj_links'];
const PAGE_SIZE = 1000;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

async function fetchTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'created_at.asc.nullslast');

    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        Prefer: 'count=exact',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to export ${table}: ${res.status} ${text}`);
    }

    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

const snapshot = {
  exportedAt: new Date().toISOString(),
  source: SUPABASE_URL,
  tables: {},
};

for (const table of TABLES) {
  console.error(`Exporting ${table}...`);
  snapshot.tables[table] = await fetchTable(table);
  console.error(`  ${snapshot.tables[table].length} rows`);
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Wrote ${OUT}`);
