import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { updateEventDetailsGuarded } from "./detail-persistence.ts";

const READ_AT = "2026-10-11T00:00:00.000Z";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      name TEXT NOT NULL,
      door_opens_at TEXT,
      guest_cutoff_at TEXT,
      capacity INTEGER,
      target_guests INTEGER,
      state TEXT NOT NULL,
      template_source_event_id TEXT,
      updated_by_user_id TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO events (id, venue_id, business_date, name, capacity, target_guests, state, updated_at)
    VALUES ('event-a', 'venue-a', '2026-10-11', 'Friday', 300, 200, 'closed', '${READ_AT}');
  `);
  return database;
}

function asD1(database) {
  return {
    prepare(statement) {
      let values = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          return this;
        },
        async run() {
          const { changes } = database.prepare(statement).run(...values);
          return { success: true, results: [], meta: { changes } };
        },
      };
    },
  };
}

function edit(overrides = {}) {
  return {
    eventId: "event-a",
    venueId: "venue-a",
    expectedState: "closed",
    expectedUpdatedAt: READ_AT,
    values: {
      businessDate: "2026-10-11",
      name: "Friday late",
      doorOpensAt: null,
      guestCutoffAt: null,
      capacity: 320,
      targetGuests: 220,
      templateSourceEventId: null,
    },
    actorUserId: "admin-a",
    updatedAt: "2026-10-11T00:05:00.000Z",
    ...overrides,
  };
}

function row(database) {
  return database.prepare("SELECT name, capacity, state, updated_by_user_id, updated_at FROM events WHERE id = 'event-a'").get();
}

test("an event detail edit applies when the event is unchanged since it was read", async () => {
  const database = createDatabase();
  assert.equal(await updateEventDetailsGuarded(asD1(database), edit()), true);
  assert.deepEqual({ ...row(database) }, {
    name: "Friday late", capacity: 320, state: "closed",
    updated_by_user_id: "admin-a", updated_at: "2026-10-11T00:05:00.000Z",
  });
});

test("an archive between reading and saving an event leaves the archived details untouched", async () => {
  const database = createDatabase();
  // Another admin archives the event after this edit read it as closed.
  database.prepare("UPDATE events SET state = 'archived', updated_at = ? WHERE id = 'event-a'").run("2026-10-11T00:01:00.000Z");

  assert.equal(await updateEventDetailsGuarded(asD1(database), edit()), false);
  assert.deepEqual({ ...row(database) }, {
    name: "Friday", capacity: 300, state: "archived",
    updated_by_user_id: null, updated_at: "2026-10-11T00:01:00.000Z",
  });
});

test("the second of two admins editing the same event cannot overwrite the first save", async () => {
  const database = createDatabase();
  const d1 = asD1(database);
  assert.equal(await updateEventDetailsGuarded(d1, edit({ actorUserId: "admin-a" })), true);
  assert.equal(await updateEventDetailsGuarded(d1, edit({
    actorUserId: "admin-b",
    values: { ...edit().values, name: "Friday second", capacity: 150 },
    updatedAt: "2026-10-11T00:06:00.000Z",
  })), false);
  assert.equal(row(database).name, "Friday late");
  assert.equal(row(database).updated_by_user_id, "admin-a");
});

test("archived or other-venue events never take a detail edit", async () => {
  const database = createDatabase();
  database.prepare("UPDATE events SET state = 'archived' WHERE id = 'event-a'").run();
  assert.equal(await updateEventDetailsGuarded(asD1(database), edit({ expectedState: "archived" })), false);

  database.prepare("UPDATE events SET state = 'closed' WHERE id = 'event-a'").run();
  assert.equal(await updateEventDetailsGuarded(asD1(database), edit({ venueId: "venue-b" })), false);
  assert.equal(row(database).name, "Friday");
});
