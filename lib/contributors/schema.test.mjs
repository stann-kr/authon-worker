import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = [
  "0020_contributor_analytics_snapshots.sql",
  "0021_external_dj_directory.sql",
].map((fileName) =>
  readFileSync(new URL(`../../migrations/${fileName}`, import.meta.url), "utf8"),
).join("\n");

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (id TEXT PRIMARY KEY);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      venue_id TEXT REFERENCES venues(id),
      deleted_at TEXT
    );
    CREATE TABLE external_dj_links (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id),
      deleted_at TEXT
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id)
    );
    CREATE TABLE event_closeouts (
      event_id TEXT PRIMARY KEY REFERENCES events(id),
      venue_id TEXT NOT NULL REFERENCES venues(id)
    );
    INSERT INTO venues VALUES ('venue-a'), ('venue-b');
    INSERT INTO users VALUES
      ('admin-a', 'venue-a', NULL),
      ('user-a', 'venue-a', NULL),
      ('user-b', 'venue-b', NULL);
    INSERT INTO external_dj_links VALUES
      ('link-a', 'venue-a', NULL),
      ('link-b', 'venue-b', NULL);
    INSERT INTO events VALUES ('event-a', 'venue-a'), ('event-b', 'venue-b');
    INSERT INTO event_closeouts VALUES ('event-a', 'venue-a'), ('event-b', 'venue-b');
  `);
  database.exec(migration);
  return database;
}

function insertContributor(
  database,
  id,
  venueId,
  displayName = "Same Name",
  nameKey = null,
) {
  database.prepare(`
    INSERT INTO venue_contributors (
      id, venue_id, display_name, name_key, kind, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'dj', 1, ?, ?)
  `).run(
    id,
    venueId,
    displayName,
    nameKey,
    "2026-08-14T00:00:00.000Z",
    "2026-08-14T00:00:00.000Z",
  );
}

test("legacy users and links stay unmapped while same-name contributors remain distinct", () => {
  const database = createDatabase();
  assert.equal(
    database.prepare("SELECT contributor_id FROM users WHERE id = 'user-a'").get()
      .contributor_id,
    null,
  );
  assert.equal(
    database
      .prepare("SELECT contributor_id FROM external_dj_links WHERE id = 'link-a'")
      .get().contributor_id,
    null,
  );

  insertContributor(database, "contributor-a", "venue-a");
  insertContributor(database, "contributor-b", "venue-a");
  assert.equal(
    database
      .prepare("SELECT count(*) AS count FROM venue_contributors WHERE display_name = 'Same Name'")
      .get().count,
    2,
  );
});

test("normalized DJ names are unique within a venue", () => {
  const database = createDatabase();
  insertContributor(database, "contributor-a", "venue-a", "DJ SAME", "DJ SAME");
  assert.throws(() =>
    insertContributor(database, "contributor-b", "venue-a", "DJ Same", "DJ SAME"),
  );
  insertContributor(database, "contributor-c", "venue-b", "DJ SAME", "DJ SAME");
});

test("user and link mappings cannot cross or later drift across venue boundaries", () => {
  const database = createDatabase();
  insertContributor(database, "contributor-a", "venue-a");
  insertContributor(database, "contributor-b", "venue-b");

  database
    .prepare("UPDATE users SET contributor_id = ? WHERE id = 'user-a'")
    .run("contributor-a");
  database
    .prepare("UPDATE external_dj_links SET contributor_id = ? WHERE id = 'link-a'")
    .run("contributor-a");
  assert.throws(
    () =>
      database
        .prepare("UPDATE users SET contributor_id = ? WHERE id = 'user-a'")
        .run("contributor-b"),
    /venue mismatch/,
  );
  assert.throws(
    () =>
      database
        .prepare("UPDATE external_dj_links SET contributor_id = ? WHERE id = 'link-a'")
        .run("contributor-b"),
    /venue mismatch/,
  );
  assert.throws(
    () => database.exec("UPDATE users SET venue_id = 'venue-b' WHERE id = 'user-a'"),
    /venue mismatch/,
  );
  assert.throws(
    () =>
      database.exec(
        "UPDATE venue_contributors SET venue_id = 'venue-b' WHERE id = 'contributor-a'",
      ),
    /identity is immutable/,
  );
});

test("closeout contributor metrics require exact tenant and source mappings", () => {
  const database = createDatabase();
  insertContributor(database, "contributor-a", "venue-a");
  insertContributor(database, "contributor-b", "venue-b");
  database.exec("UPDATE users SET contributor_id = 'contributor-a' WHERE id = 'user-a'");
  database.exec(
    "UPDATE external_dj_links SET contributor_id = 'contributor-a' WHERE id = 'link-a'",
  );

  const insert = database.prepare(`
    INSERT INTO event_closeout_contributor_metrics (
      event_id, venue_id, contributor_id, source_kind, source_id,
      registered_count, checked_in_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    "event-a",
    "venue-a",
    "contributor-a",
    "user",
    "user-a",
    10,
    8,
    "2026-08-14T00:05:00.000Z",
  );
  insert.run(
    "event-a",
    "venue-a",
    "contributor-a",
    "external_link",
    "link-a",
    5,
    4,
    "2026-08-14T00:05:00.000Z",
  );
  insert.run(
    "event-a",
    "venue-a",
    null,
    "unattributed",
    "unattributed",
    1,
    0,
    "2026-08-14T00:05:00.000Z",
  );
  assert.throws(
    () =>
      insert.run(
        "event-a",
        "venue-a",
        "contributor-b",
        "user",
        "user-a",
        1,
        1,
        "2026-08-14T00:05:00.000Z",
      ),
    /scope mismatch/,
  );
  assert.throws(
    () =>
      insert.run(
        "event-a",
        "venue-a",
        "contributor-a",
        "user",
        "user-b",
        1,
        1,
        "2026-08-14T00:05:00.000Z",
      ),
    /scope mismatch/,
  );
  assert.equal(
    database
      .prepare("SELECT sum(registered_count) AS total FROM event_closeout_contributor_metrics")
      .get().total,
    16,
  );
});

test("closeout contributor metrics are immutable", () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO event_closeout_contributor_metrics (
      event_id, venue_id, contributor_id, source_kind, source_id,
      registered_count, checked_in_count, created_at
    ) VALUES (
      'event-a', 'venue-a', NULL, 'unattributed', 'unattributed',
      1, 0, '2026-08-14T00:05:00.000Z'
    );
  `);
  assert.throws(
    () =>
      database.exec(
        "UPDATE event_closeout_contributor_metrics SET registered_count = 2",
      ),
    /immutable/,
  );
  assert.throws(
    () => database.exec("DELETE FROM event_closeout_contributor_metrics"),
    /immutable/,
  );
});

test("closeout contributor metrics contain aggregates without guest identity columns", () => {
  const database = createDatabase();
  const columns = database
    .prepare("PRAGMA table_info(event_closeout_contributor_metrics)")
    .all()
    .map((column) => column.name);
  assert.deepEqual(columns, [
    "event_id",
    "venue_id",
    "contributor_id",
    "source_kind",
    "source_id",
    "registered_count",
    "checked_in_count",
    "created_at",
  ]);
});

test("contributor mapping audit rows are tenant-scoped and immutable", () => {
  const database = createDatabase();
  insertContributor(database, "contributor-a", "venue-a");
  insertContributor(database, "contributor-b", "venue-b");
  database.exec("UPDATE users SET contributor_id = 'contributor-a' WHERE id = 'user-a'");
  database.prepare(`
    INSERT INTO contributor_audit_events (
      id, venue_id, contributor_id, actor_user_id, source_kind,
      source_id, action, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "audit-a",
    "venue-a",
    "contributor-a",
    "admin-a",
    "user",
    "user-a",
    "mapped",
    "{}",
    "2026-08-14T00:05:00.000Z",
  );
  assert.throws(
    () =>
      database.prepare(`
        INSERT INTO contributor_audit_events (
          id, venue_id, contributor_id, actor_user_id, source_kind,
          source_id, action, details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "audit-b",
        "venue-a",
        "contributor-b",
        "admin-a",
        "user",
        "user-a",
        "mapped",
        "{}",
        "2026-08-14T00:05:00.000Z",
      ),
    /scope mismatch/,
  );
  assert.throws(
    () => database.exec("UPDATE contributor_audit_events SET action = 'unmapped'"),
    /immutable/,
  );
  assert.throws(
    () => database.exec("DELETE FROM contributor_audit_events"),
    /immutable/,
  );
});

test("mapping audits require the current live source mapping", () => {
  const database = createDatabase();
  insertContributor(database, "contributor-a", "venue-a");
  const insertAudit = database.prepare(`
    INSERT INTO contributor_audit_events (
      id, venue_id, contributor_id, actor_user_id, source_kind,
      source_id, action, details, created_at
    ) VALUES (?, 'venue-a', ?, 'admin-a', 'user', 'user-a', ?, '{}', ?)
  `);
  const createdAt = "2026-08-14T00:05:00.000Z";

  assert.throws(
    () => insertAudit.run("audit-unapplied", "contributor-a", "mapped", createdAt),
    /scope mismatch/,
  );
  database.exec("UPDATE users SET contributor_id = 'contributor-a' WHERE id = 'user-a'");
  insertAudit.run("audit-mapped", "contributor-a", "mapped", createdAt);
  database.exec("UPDATE users SET deleted_at = '2026-08-14T01:00:00.000Z' WHERE id = 'user-a'");
  assert.throws(
    () => insertAudit.run("audit-deleted", "contributor-a", "mapped", createdAt),
    /scope mismatch/,
  );
});

test("archived external-link mappings remain auditable for historical backfill", () => {
  const database = createDatabase();
  insertContributor(database, "contributor-a", "venue-a", "DJ A", "DJ A");
  database.exec(`
    UPDATE external_dj_links
    SET contributor_id = 'contributor-a', deleted_at = '2026-08-14T01:00:00.000Z'
    WHERE id = 'link-a'
  `);
  database.prepare(`
    INSERT INTO contributor_audit_events (
      id, venue_id, contributor_id, actor_user_id, source_kind,
      source_id, action, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "audit-archived-link",
    "venue-a",
    "contributor-a",
    "admin-a",
    "external_link",
    "link-a",
    "mapped",
    '{"reason":"historical_backfill"}',
    "2026-08-14T02:00:00.000Z",
  );
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM contributor_audit_events WHERE id = 'audit-archived-link'",
    ).get().count,
    1,
  );
});
