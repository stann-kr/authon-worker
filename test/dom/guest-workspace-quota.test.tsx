import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { before, test } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "@/lib/db/schema";

// Exercise the public snapshot with real quota SQL; only server context is stubbed.
const runtime = globalThis as typeof globalThis & {
  workspaceQuotaTest: { db: ReturnType<typeof drizzle>; baseLimit: number | null };
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = ["observability/server-performance", "observability/structured-log", "db/client", "auth/server", "tenant/active-server", "events/server", "guest-snapshots/persistence"]
      .find(path => specifier.endsWith(path));
    return target ? { url: `mock:workspace-quota:${target}`, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("mock:workspace-quota:")) return nextLoad(url, context);
    const sources: Record<string, string> = {
      "observability/server-performance": "export const measureServerOperation = (_name, run) => run();",
      "observability/structured-log": "export const reportServerError = async () => {};",
      "db/client": "export const getDb = () => globalThis.workspaceQuotaTest.db;",
      "auth/server": `export const requireAccess = async () => ({id:'staff',role:'staff',accountKind:'personal',venueId:'venue-a',guestLimit:globalThis.workspaceQuotaTest.baseLimit});
        export const requireAuth = requireAccess;
        export const requireRole = async () => ({id:'admin',role:'venue_admin',venueId:'venue-a'});`,
      "tenant/active-server": "export const requireActiveVenueId = async venue => venue;",
      "events/server": `const event = {id:'event-a',venueId:'venue-a',businessDate:'2026-09-18',compatibilityKey:'legacy',state:'open'};
        export const findCompatibilityEvent = async () => event;
        export const loadEventById = async () => event;
        export const eventIncludesLegacyDateRows = () => true;
        export const resolveEventForRosterWrite = async () => event;`,
      "guest-snapshots/persistence": "export const loadSnapshotGuests = async () => [];",
    };
    return { format: "module", shortCircuit: true, source: sources[url.replace("mock:workspace-quota:", "")] };
  },
});
let fetchSnapshot: typeof import("@/lib/api/guest-snapshots").fetchGuestWorkspaceSnapshot;
let fetchRequests: typeof import("@/lib/api/guest-limits").fetchGuestLimitRequests;
before(async () => {
  ({ fetchGuestWorkspaceSnapshot: fetchSnapshot } = await import("@/lib/api/guest-snapshots"));
  ({ fetchGuestLimitRequests: fetchRequests } = await import("@/lib/api/guest-limits"));
});

function fixture(configured: number | null, baseLimit: number | null) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE venues (id TEXT PRIMARY KEY, active INTEGER);
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, venue_id TEXT, name TEXT, compatibility_key TEXT);
    CREATE TABLE guests (id TEXT, venue_id TEXT, created_by_user_id TEXT, event_id TEXT, status TEXT, date TEXT);
    CREATE TABLE event_contributor_limits (event_id TEXT, venue_id TEXT, user_id TEXT, guest_limit INTEGER);
    CREATE TABLE guest_limit_requests (
      id TEXT, venue_id TEXT, user_id TEXT, date TEXT, event_id TEXT,
      requested_extra INTEGER, approved_extra INTEGER, reason TEXT, status TEXT,
      decided_by_user_id TEXT, decided_at TEXT, decision_note TEXT, created_at TEXT, updated_at TEXT
    );
    INSERT INTO venues VALUES ('venue-a',1),('venue-b',1);
    INSERT INTO users VALUES ('staff','Test staff','staff');
    INSERT INTO events VALUES ('event-a','venue-a','Test night',NULL),('another-event','venue-a','Other night',NULL);
    INSERT INTO guests VALUES ('a','venue-a','staff','event-a','pending','2026-09-18'),
      ('legacy','venue-a','staff',NULL,'checked','2026-09-18'),
      ('other','venue-b','staff',NULL,'pending','2026-09-18');
    INSERT INTO guest_limit_requests (id,venue_id,user_id,date,event_id,requested_extra,approved_extra,status)
      VALUES ('a','venue-a','staff','2026-09-18','event-a',2,2,'approved'),
        ('other','venue-b','staff','2026-09-18',NULL,9,9,'approved'),
        ('other-pending','venue-b','staff','2026-09-18',NULL,1,0,'pending');
  `);
  database.prepare("INSERT INTO event_contributor_limits VALUES ('event-a','venue-a','staff',?)").run(configured);
  const adapter = { prepare(sql: string) {
    let values: (string | number | null)[] = [];
    return {
      bind(...next: typeof values) { values = next; return this; },
      async raw() {
        const statement = database.prepare(sql);
        statement.setReturnArrays(true);
        return statement.all(...values);
      },
      async all() { return { results: database.prepare(sql).all(...values) }; },
    };
  } };
  runtime.workspaceQuotaTest = { db: drizzle(adapter as unknown as D1Database, { schema }), baseLimit };
  return database;
}

test("workspace quota uses the event limit and excludes another venue's historical usage and requests", async () => {
  for (const [baseLimit, configured, effectiveLimit, remaining, canRequestExtra] of [
    [20, 3, 5, 3, true], [20, null, null, null, false], [null, 4, 6, 4, true],
  ] as const) {
    const database = fixture(configured, baseLimit);
    try {
      const result = await fetchSnapshot("2026-09-18", "venue-a", "event-a");
      assert.equal(result.error, null);
      assert.deepEqual(result.data?.quota, {
        date: "2026-09-18", baseLimit: configured, approvedExtra: 2, effectiveLimit,
        remaining, used: 2, canRequestExtra, pendingRequest: null,
      });
    } finally { database.close(); }
  }
});

test("the venue inbox includes pending requests from other dates and events without mixing scoped history or another venue", async () => {
  const database = fixture(3, 20);
  try {
    const insert = database.prepare(`INSERT INTO guest_limit_requests
      (id,venue_id,user_id,date,event_id,requested_extra,approved_extra,status,created_at,updated_at)
      VALUES (?,'venue-a','staff',?,?,3,0,?,?,?)`);
    insert.run('old-pending','2026-08-01','another-event','pending','2026-08-01','2026-08-01');
    insert.run('future-pending','2026-10-01',null,'pending','2026-10-01','2026-10-01');
    insert.run('other-history','2026-08-01','another-event','approved','2026-08-01','2026-08-01');
    // A large recent history must not push an older outstanding request off the list.
    for (let i=0; i<105; i++) insert.run(`history-${i}`,'2026-09-18','event-a','rejected','2026-09-18','2026-09-18');
    for (const eventId of [null, 'event-a']) {
      const result = await fetchRequests('venue-a',eventId,'2026-09-18');
      assert.equal(result.error,null);
      assert.deepEqual(result.data?.filter(row=>row.status==='pending').map(row=>row.id).sort(),['future-pending','old-pending']);
      assert.equal(result.data?.some(row=>['other-history','other','other-pending'].includes(row.id)),false);
      assert.equal(result.data?.find(row=>row.id==='old-pending')?.eventName,'Other night');
      assert.equal(result.data?.filter(row=>row.status!=='pending').length,20);
    }
  } finally { database.close(); }
});

test("a mismatched venue or event cannot produce a verified workspace quota", async () => {
  const database = fixture(3, 20);
  try {
    assert.equal((await fetchSnapshot("2026-09-18", "venue-b", "event-a")).data, null);
    database.prepare("UPDATE venues SET active=0 WHERE id='venue-a'").run();
    const result = await fetchSnapshot("2026-09-18", "venue-a", "event-a");
    assert.ok(result.data?.failedSections.includes("quota"));
    assert.equal(result.data?.quota, null);
  } finally { database.close(); }
});
