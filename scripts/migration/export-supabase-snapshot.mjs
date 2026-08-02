#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT = process.argv[2] || 'migration/supabase-snapshot.json';
const TABLES = ['venues', 'users', 'guests', 'external_dj_links'];
const PAGE_SIZE = 1000;

if (!SUPABASE_URL || !SUPABASE_API_KEY) {
  console.error(
    'Missing SUPABASE_URL and one of SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.',
  );
  process.exit(1);
}

const USES_SECRET_KEY = SUPABASE_API_KEY.startsWith('sb_secret_');

async function fetchTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'created_at.asc.nullslast');

    const headers = {
      apikey: SUPABASE_API_KEY,
      Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      Prefer: 'count=exact',
    };

    // New sb_secret_ keys are API keys, not JWTs. Legacy service_role keys
    // still require the Bearer authorization header.
    if (!USES_SECRET_KEY) {
      headers.Authorization = `Bearer ${SUPABASE_API_KEY}`;
    }

    const res = await fetch(url, { headers });

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
