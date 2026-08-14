import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  DECREMENT_SELF_RSVP_FOR_PENDING_GUEST_SQL,
  EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL,
  INSERT_SELF_RSVP_OWNER_AFTER_GUEST_SQL,
  RESERVE_SELF_RSVP_SLOT_SQL,
  SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL,
  UPDATE_SELF_RSVP_GUEST_SQL,
} from "../guests/atomic-sql.ts";

const NOW = "2026-08-13T16:00:00.000Z";
const DATE = "2026-08-13";

function createDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE venues (id TEXT PRIMARY KEY, active INTEGER NOT NULL);
    CREATE TABLE external_dj_links (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      token TEXT NOT NULL,
      kind TEXT NOT NULL,
      date TEXT,
      max_guests INTEGER NOT NULL,
      used_guests INTEGER NOT NULL,
      active INTEGER NOT NULL,
      expires_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      external_link_id TEXT,
      event_id TEXT,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE external_guest_owners (
      guest_id TEXT PRIMARY KEY,
      external_link_id TEXT NOT NULL,
      owner_key_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE UNIQUE INDEX idx_owner_active
      ON external_guest_owners(external_link_id, owner_key_hash)
      WHERE released_at IS NULL;
    CREATE TRIGGER release_owner_after_guest_delete
    AFTER UPDATE OF status ON guests
    WHEN NEW.status = 'deleted' AND OLD.status != 'deleted'
    BEGIN
      UPDATE external_guest_owners
      SET released_at = NEW.updated_at
      WHERE guest_id = NEW.id AND released_at IS NULL;
    END;
    INSERT INTO venues VALUES ('venue-a', 1);
    INSERT INTO external_dj_links VALUES (
      'link-a', 'venue-a', 'token-a', 'self_rsvp', '${DATE}', 5, 0, 1,
      '2026-08-20T00:00:00.000Z', NULL
    );
  `);
  return db;
}

function reserve(db, ownerHash) {
  return db.prepare(RESERVE_SELF_RSVP_SLOT_SQL).get(
    "link-a",
    "token-a",
    "venue-a",
    NOW,
    DATE,
    ownerHash,
  );
}

function insertOwnedGuest(db, id, ownerHash) {
  const guest = db.prepare(EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL).get(
    id,
    "venue-a",
    `GUEST ${id}`,
    "link-a",
    "event-a",
    DATE,
    NOW,
    NOW,
  );
  const owner = db.prepare(INSERT_SELF_RSVP_OWNER_AFTER_GUEST_SQL).get(
    id,
    "link-a",
    ownerHash,
    NOW,
  );
  return { guest, owner };
}

test("self RSVP atomically reserves one active row per owner capability", () => {
  const db = createDb();
  assert.equal(reserve(db, "a".repeat(64)).id, "link-a");
  const inserted = insertOwnedGuest(db, "guest-a", "a".repeat(64));
  assert.equal(inserted.guest.id, "guest-a");
  assert.equal(inserted.owner.guestId, "guest-a");

  assert.equal(reserve(db, "a".repeat(64)), undefined);
  assert.equal(reserve(db, "b".repeat(64)).id, "link-a");
  insertOwnedGuest(db, "guest-b", "b".repeat(64));
  assert.equal(
    db.prepare("SELECT used_guests FROM external_dj_links WHERE id = 'link-a'").get().used_guests,
    2,
  );
});

test("self RSVP update and delete require the exact active owner capability", () => {
  const db = createDb();
  reserve(db, "a".repeat(64));
  insertOwnedGuest(db, "guest-a", "a".repeat(64));

  const deniedUpdate = db.prepare(UPDATE_SELF_RSVP_GUEST_SQL).get(
    "WRONG",
    NOW,
    "guest-a",
    "link-a",
    "venue-a",
    DATE,
    "b".repeat(64),
    "token-a",
    NOW,
  );
  assert.equal(deniedUpdate, undefined);
  const ownedUpdate = db.prepare(UPDATE_SELF_RSVP_GUEST_SQL).get(
      "OWN NAME",
      NOW,
      "guest-a",
      "link-a",
      "venue-a",
      DATE,
      "a".repeat(64),
      "token-a",
      NOW,
    );
  assert.equal(ownedUpdate.id, "guest-a");

  assert.equal(
    db.prepare(DECREMENT_SELF_RSVP_FOR_PENDING_GUEST_SQL).get(
      "link-a", "token-a", "venue-a", NOW, DATE,
      "guest-a", "link-a", "venue-a", DATE, "b".repeat(64),
    ),
    undefined,
  );
  const decrement = db.prepare(DECREMENT_SELF_RSVP_FOR_PENDING_GUEST_SQL).get(
      "link-a", "token-a", "venue-a", NOW, DATE,
      "guest-a", "link-a", "venue-a", DATE, "a".repeat(64),
    );
  assert.equal(decrement.id, "link-a");
  const deleted = db.prepare(SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL).get(
      NOW, "guest-a", "link-a", "venue-a", DATE,
    );
  assert.equal(deleted.id, "guest-a");
  assert.equal(
    db.prepare(
      "SELECT released_at AS releasedAt FROM external_guest_owners WHERE guest_id = 'guest-a'",
    ).get().releasedAt,
    NOW,
  );
  assert.equal(
    db.prepare("SELECT used_guests FROM external_dj_links WHERE id = 'link-a'").get().used_guests,
    0,
  );
});
