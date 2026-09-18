import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { externalDjLinks, guests } from "@/lib/db/schema";
import { buildLinkGuestQuery, buildLinkListQuery } from "@/lib/external-links/list-query";
import { LINK_PAGE_SIZE, type LinkListOptions } from "@/lib/external-links/list-types";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE external_dj_links (
    id TEXT PRIMARY KEY, venue_id TEXT, event_id TEXT, date TEXT, deleted_at TEXT,
    active INTEGER DEFAULT 1, expires_at TEXT, used_guests INTEGER DEFAULT 0,
    max_guests INTEGER DEFAULT 10, created_at TEXT, dj_name TEXT
  )`);
  const add = (id: string, venue = "venue-a", created: string | null = "2026-09-18", event: string | null = null) => {
    sqlite.prepare("INSERT INTO external_dj_links (id,venue_id,created_at,event_id,date,dj_name) VALUES (?,?,?,?,?,?)")
      .run(id, venue, created, event, "2026-09-18", `DJ ${id}`);
  };
  const db = drizzle(async () => ({ rows: [] }));
  const read = (options: LinkListOptions, event: string | null = null, legacy = false) => {
    const q = buildLinkListQuery("venue-a", options, event, legacy);
    const query = db.select({ id: externalDjLinks.id, value: q.value.as("value") }).from(externalDjLinks)
      .where(q.where).orderBy(...q.order).limit(LINK_PAGE_SIZE + 1).toSQL();
    const stats = db.select({ total: q.stats.total.as("total"), active: q.stats.active.as("active"), attention: q.stats.attention.as("attention") }).from(externalDjLinks).where(q.scope).toSQL();
    return { rows: sqlite.prepare(query.sql).all(...query.params as string[]) as Array<{ id: string; value: string }>,
      stats: sqlite.prepare(stats.sql).get(...stats.params as string[]) };
  };
  return { sqlite, add, read };
}

test("link cursor keeps ten-row pages stable across ties, deletion, insertion, and null timestamps", () => {
  const { sqlite, add, read } = fixture();
  try {
    for (let i = 0; i < 23; i++) add(`link-${String(i).padStart(2, "0")}`);
    add("legacy", "venue-a", null);
    const options: LinkListOptions = { filter: "all", sort: "newest" };
    const first = read(options);
    assert.equal(first.rows.length, 11);
    assert.equal(first.stats?.total, 24);
    const visible = first.rows.slice(0, 10);
    const last = visible.at(-1)!;
    sqlite.prepare("DELETE FROM external_dj_links WHERE id = ?").run(visible[0].id);
    add("new-link", "venue-a", "2026-09-19");
    const second = read({ ...options, cursor: last });
    assert.equal(second.rows.length, 11);
    assert.equal(second.rows.some((row) => visible.some((old) => old.id === row.id)), false);
    const third = read({ ...options, cursor: second.rows[9] });
    assert.equal(third.rows.length, 4);
    assert.equal(third.rows.at(-1)?.id, "legacy");
    assert.equal(new Set([...visible, ...second.rows.slice(0, 10), ...third.rows].map((row) => row.id)).size, 24);
  } finally { sqlite.close(); }
});

test("link filters and totals include later pages and keep tenant, deletion, and event boundaries", () => {
  const { sqlite, add, read } = fixture();
  try {
    for (let i = 0; i < 15; i++) add(`link-${i}`, "venue-a", "2026-09-18", "event-a");
    add("other-tenant", "venue-b", "2026-09-19", "event-a");
    add("other-event", "venue-a", "2026-09-19", "event-b");
    add("legacy", "venue-a", null);
    add("deleted", "venue-a", null, "event-a");
    sqlite.exec("UPDATE external_dj_links SET active = 0 WHERE id IN ('link-0','other-tenant','other-event','deleted'); UPDATE external_dj_links SET deleted_at = '2026-09-18' WHERE id = 'deleted'");
    const options: LinkListOptions = { date: "2026-09-18", filter: "attention", sort: "newest" };
    const attention = read(options, "event-a");
    assert.deepEqual(attention.rows.map((r) => r.id), ["link-0"]);
    assert.deepEqual({ ...attention.stats }, { total: 15, active: 14, attention: 1 });
    assert.equal(read({ ...options, filter: "all" }, "event-a", true).stats?.total, 16);
    assert.deepEqual(read({ ...options, filter: "all" }).rows.map((row) => row.id), ["legacy"]);
    assert.equal(read({ ...options, filter: "active" }, "event-a").stats?.active, 14);
    for (const sort of ["djName", "expiresSoonest"] as const) {
      const first = read({ ...options, filter: "all", sort }, "event-a").rows.slice(0, 10);
      const next = read({ ...options, filter: "all", sort, cursor: first[9] }, "event-a").rows;
      assert.equal(first.length + next.length, 15);
      assert.equal(new Set([...first, ...next].map((row) => row.id)).size, 15);
    }
  } finally { sqlite.close(); }
});

test("page filters and totals agree on expired, expiring, full, and inactive links", () => {
  const { sqlite, add, read } = fixture();
  try {
    for (const id of ["ordinary", "expired", "expiring", "full", "inactive", "later"]) add(id);
    sqlite.exec(`
      UPDATE external_dj_links SET expires_at = datetime('now', '-1 hour') WHERE id = 'expired';
      UPDATE external_dj_links SET expires_at = datetime('now', '+12 hours') WHERE id = 'expiring';
      UPDATE external_dj_links SET expires_at = datetime('now', '+2 days') WHERE id = 'later';
      UPDATE external_dj_links SET used_guests = max_guests WHERE id = 'full';
      UPDATE external_dj_links SET active = 0 WHERE id = 'inactive';
    `);
    const active = read({ filter: "active", sort: "expiresSoonest" });
    assert.deepEqual({ ...active.stats }, { total: 6, active: 4, attention: 4 });
    assert.deepEqual(active.rows.map((r) => r.id), ["expiring", "later", "full", "ordinary"]);
    const attention = read({ filter: "attention", sort: "djName" });
    assert.deepEqual(attention.rows.map((r) => r.id), ["expired", "expiring", "full", "inactive"]);
  } finally { sqlite.close(); }
});


test("linked guest pages isolate venue and link ownership, omit deleted rows, and continue through ties", () => {
  const { sqlite, add } = fixture();
  try {
    add("target"); add("other"); add("foreign", "venue-b"); add("removed");
    sqlite.exec("UPDATE external_dj_links SET deleted_at = '2026-09-18' WHERE id = 'removed'");
    sqlite.exec("CREATE TABLE guests (id TEXT, venue_id TEXT, external_link_id TEXT, status TEXT, created_at TEXT)");
    const insert = sqlite.prepare("INSERT INTO guests VALUES (?, ?, ?, ?, ?)");
    for (let i = 0; i < 13; i++) insert.run(`g-${String(i).padStart(2, "0")}`, "venue-a", "target", i === 1 ? "checked" : "pending", "2026-09-18");
    for (const [id, venue, link, status] of [["deleted", "venue-a", "target", "deleted"], ["wrong-link", "venue-a", "other", "pending"],
      ["wrong-venue", "venue-b", "target", "pending"], ["foreign", "venue-b", "foreign", "checked"], ["removed-link", "venue-a", "removed", "pending"]]) insert.run(id, venue, link, status, "2026-09-18");
    const db = drizzle(async () => ({ rows: [] }));
    const read = (linkId: string, cursor?: LinkListOptions["cursor"]) => {
      const query = buildLinkGuestQuery("venue-a", linkId, cursor);
      const stmt = db.select({ id: guests.id, value: guests.createdAt }).from(guests)
        .innerJoin(externalDjLinks, query.join).where(query.where).orderBy(...query.order).limit(11).toSQL();
      return sqlite.prepare(stmt.sql).all(...stmt.params as string[]) as Array<{ id: string; created_at: string }>;
    };
    const first = read("target");
    assert.equal(first.length, 11);
    assert.equal(first.every((row) => row.id.startsWith("g-")), true);
    const next = read("target", { id: first[9].id, value: first[9].created_at });
    assert.equal(next.length, 3);
    assert.equal(new Set([...first.slice(0, 10), ...next].map((row) => row.id)).size, 13);
    assert.deepEqual(read("foreign"), []);
    assert.deepEqual(read("removed"), []);
  } finally { sqlite.close(); }
});
