import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";

await import("tsx");
const { loadSnapshotGuests } = await import("./persistence.ts");

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO venues (id, name, type) VALUES ('venue-a', 'Venue A', 'club'), ('venue-b', 'Venue B', 'club');
    INSERT INTO users (id, email, name, role, venue_id, password_hash, created_at) VALUES
      ('creator-a', 'a@example.test', 'A', 'staff', 'venue-a', 'unused-fixture', '2026-09-12'),
      ('creator-b', 'b@example.test', 'B', 'staff', 'venue-a', 'unused-fixture', '2026-09-12');
    INSERT INTO events (id, venue_id, business_date, name, state, created_at, updated_at) VALUES
      ('compat-event', 'venue-a', '2026-09-12', 'Compatibility', 'open', '2026-09-12', '2026-09-12'),
      ('named-event', 'venue-a', '2026-09-12', 'Named', 'open', '2026-09-12', '2026-09-12');
  `);
  const rows = [
    ['compat', 'venue-a', 'compat-event', '2026-09-12', 'creator-a', 'pending'],
    ['legacy', 'venue-a', null, '2026-09-12', 'creator-a', 'checked'],
    ['historic-event-date', 'venue-a', 'compat-event', '2026-09-11', 'creator-a', 'pending'],
    ['different-day', 'venue-a', null, '2026-09-11', 'creator-a', 'pending'],
    ['named', 'venue-a', 'named-event', '2026-09-12', 'creator-a', 'pending'],
    ['other-creator', 'venue-a', 'compat-event', '2026-09-12', 'creator-b', 'pending'],
    ['other-venue', 'venue-b', 'compat-event', '2026-09-12', 'creator-a', 'pending'],
    ['deleted', 'venue-a', 'compat-event', '2026-09-12', 'creator-a', 'deleted'],
    ['deleted-legacy', 'venue-a', null, '2026-09-12', 'creator-a', 'deleted'],
  ];
  const insert = sqlite.prepare(`INSERT INTO guests
    (id, venue_id, event_id, date, created_by_user_id, status, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, row] of rows.entries()) {
    const created = `2026-09-12T10:00:0${index}.000Z`;
    insert.run(...row, row[0], created, created);
  }
  const queries = [];
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: sqlite.prepare(sql).all(...params).map(Object.values) };
  });
  return { sqlite, db, queries };
}

test("snapshot reads preserve tenant, creator, legacy membership and descending creation order", async () => {
  const { sqlite, db, queries } = fixture();
  try {
    for (const [overrides, expected] of [
      [{}, ['other-creator', 'historic-event-date', 'legacy', 'compat']],
      [{ createdByUserId: 'creator-a' }, ['historic-event-date', 'legacy', 'compat']],
      [{ eventId: 'named-event', includeLegacyDateRows: false }, ['named']],
      [{ eventId: null }, ['legacy']],
      [{ createdByUserId: 'unknown' }, []],
    ]) {
      const before = queries.length;
      const result = await loadSnapshotGuests(db, {
        venueId: 'venue-a', date: '2026-09-12', eventId: 'compat-event',
        includeLegacyDateRows: true, ...overrides,
      });
      assert.deepEqual(result.map((guest) => guest.id), expected);
      assert.equal(queries.length - before, 1, "one database call for the complete snapshot");
      assert.equal(new Set(result.map((guest) => guest.id)).size, result.length);
      assert.ok(result.every((guest) => guest.venueId === 'venue-a' && guest.status !== 'deleted'));
    }
  } finally {
    sqlite.close();
  }
});
