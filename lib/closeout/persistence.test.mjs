import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { persistEventCloseoutConfirmation } from "./persistence.ts";

class SqliteD1Statement {
  constructor(database, sql, args = []) {
    this.database = database;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new SqliteD1Statement(this.database, this.sql, args);
  }
}

class SqliteD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => ({
        results: this.database
          .prepare(statement.sql)
          .all(...statement.args)
          .map((row) => ({ ...row })),
      }));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE event_closeouts (
      event_id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      confirmed_by_user_id TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      report_hash TEXT NOT NULL,
      registered_count INTEGER NOT NULL,
      checked_in_count INTEGER NOT NULL,
      source_activity_count INTEGER NOT NULL
    );
    CREATE TABLE event_closeout_contributor_metrics (
      event_id TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      contributor_id TEXT,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      registered_count INTEGER NOT NULL,
      checked_in_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (event_id, source_kind, source_id),
      CHECK (checked_in_count >= 0 AND checked_in_count <= registered_count)
    );
    INSERT INTO events VALUES
      ('event-a', 'venue-a', 'closed'),
      ('event-b', 'venue-a', 'closed'),
      ('event-c', 'venue-a', 'closed');
  `);
  return database;
}

function confirmation(database, overrides = {}) {
  return persistEventCloseoutConfirmation({
    database: new SqliteD1Database(database),
    eventId: "event-a",
    venueId: "venue-a",
    confirmedByUserId: "admin-a",
    confirmedAt: "2026-08-14T00:05:00.000Z",
    reportHash: "a".repeat(64),
    registeredCount: 3,
    checkedInCount: 2,
    sourceActivityCount: 5,
    contributorMetrics: [
      {
        eventId: "event-a",
        venueId: "venue-a",
        contributorId: "contributor-a",
        sourceKind: "user",
        sourceId: "user-a",
        registeredCount: 3,
        checkedInCount: 2,
        createdAt: "2026-08-14T00:05:00.000Z",
      },
    ],
    ...overrides,
  });
}

test("closeout header and contributor metrics commit in one batch", async () => {
  const database = createDatabase();
  await confirmation(database);
  assert.deepEqual(
    {
      ...database
        .prepare(`
          SELECT c.registered_count AS registered,
            m.registered_count AS metric_registered,
            m.checked_in_count AS metric_checked
          FROM event_closeouts c
          JOIN event_closeout_contributor_metrics m ON m.event_id = c.event_id
        `)
        .get(),
    },
    { registered: 3, metric_registered: 3, metric_checked: 2 },
  );
});

test("a retry cannot silently add metrics to a legacy header", async () => {
  const database = createDatabase();
  database.prepare(`
    INSERT INTO event_closeouts VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "event-a",
    "venue-a",
    "admin-a",
    "2026-08-13T00:05:00.000Z",
    "a".repeat(64),
    3,
    2,
    5,
  );
  await confirmation(database);
  assert.equal(
    database
      .prepare("SELECT count(*) AS count FROM event_closeout_contributor_metrics")
      .get().count,
    0,
  );
});

test("a metric failure rolls the closeout header back", async () => {
  const database = createDatabase();
  await assert.rejects(() =>
    confirmation(database, {
      eventId: "event-b",
      contributorMetrics: [
        {
          eventId: "event-b",
          venueId: "venue-a",
          contributorId: null,
          sourceKind: "unattributed",
          sourceId: "unattributed",
          registeredCount: 1,
          checkedInCount: 2,
          createdAt: "2026-08-14T00:05:00.000Z",
        },
      ],
    }),
  );
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM event_closeouts").get().count,
    0,
  );
});

test("overlapping confirmations produce one immutable snapshot winner", async () => {
  const database = createDatabase();
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      confirmation(database, {
        eventId: "event-c",
        confirmedAt: `2026-08-14T00:05:${String(index).padStart(2, "0")}.000Z`,
        contributorMetrics: [
          {
            eventId: "event-c",
            venueId: "venue-a",
            contributorId: null,
            sourceKind: "unattributed",
            sourceId: "unattributed",
            registeredCount: 3,
            checkedInCount: 2,
            createdAt: `2026-08-14T00:05:${String(index).padStart(2, "0")}.000Z`,
          },
        ],
      }),
    ),
  );
  assert.equal(database.prepare("SELECT count(*) AS count FROM event_closeouts").get().count, 1);
  assert.equal(
    database
      .prepare("SELECT count(*) AS count FROM event_closeout_contributor_metrics")
      .get().count,
    1,
  );
});
