import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  buildExternalGuestReservationSql,
  DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL,
  DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL,
  EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL,
  INTERNAL_BULK_GUEST_INSERT_SQL,
  PERMANENT_DELETE_GUEST_SQL,
  SOFT_DELETE_GUEST_SQL,
  SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL,
  UPDATE_ACTIVE_GUEST_STATUS_SQL,
} from "./atomic-sql.ts";

const NOW = "2026-08-05T12:00:00.000Z";
const DATE = "2026-08-05";

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      active INTEGER NOT NULL
    );
    CREATE TABLE external_dj_links (
      id TEXT PRIMARY KEY,
      used_guests INTEGER NOT NULL,
      max_guests INTEGER NOT NULL,
      active INTEGER NOT NULL,
      deleted_at TEXT,
      expires_at TEXT,
      date TEXT,
      token TEXT NOT NULL DEFAULT 'token',
      venue_id TEXT NOT NULL DEFAULT 'venue-a'
    );
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      external_link_id TEXT,
      created_by_user_id TEXT,
      registered_by_name TEXT,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      check_in_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE guest_limit_requests (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      approved_extra INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    INSERT INTO venues (id, active) VALUES ('venue-a', 1);
  `);
  return db;
}

function runExternalRegistration(
  db,
  { linkId, names, guardedNames = names },
) {
  db.exec("BEGIN");
  try {
    const reservation = db.prepare(
      buildExternalGuestReservationSql(guardedNames.length),
    );
    const reserved = reservation.get(
      names.length,
      linkId,
      NOW,
      DATE,
      names.length,
      ...guardedNames.flatMap((name) => [linkId, name]),
    );
    const insert = db.prepare(EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL);
    const inserted = names.flatMap((name, index) => {
      const row = insert.get(
        `${linkId}-guest-${index}`,
        "venue-a",
        name,
        linkId,
        DATE,
        NOW,
        NOW,
      );
      return row ? [row.id] : [];
    });
    db.exec("COMMIT");
    return { reserved: Boolean(reserved), inserted };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function runExternalSoftDelete(
  db,
  linkId,
  guestId,
  { token = "token", venueId = "venue-a", date = DATE } = {},
) {
  db.exec("BEGIN");
  try {
    const decremented = db
      .prepare(DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL)
      .get(
        linkId,
        token,
        venueId,
        NOW,
        date,
        guestId,
        linkId,
        venueId,
        date,
      );
    const deleted = db
      .prepare(SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL)
      .get(NOW, guestId, linkId, venueId, date);
    db.exec("COMMIT");
    return { decremented: Boolean(decremented), deleted: Boolean(deleted) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("external reservation inserts every guest or none when capacity is unavailable", () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, ?, ?, 1, NULL, NULL, ?)",
  ).run("open", 0, 2, DATE);
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, ?, ?, 1, NULL, NULL, ?)",
  ).run("full", 2, 2, DATE);
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, ?, ?, 1, NULL, NULL, NULL)",
  ).run("missing-date", 0, 2);

  assert.deepEqual(runExternalRegistration(db, {
    linkId: "open",
    names: ["ALICE", "BOB"],
  }), {
    reserved: true,
    inserted: ["open-guest-0", "open-guest-1"],
  });
  assert.deepEqual(runExternalRegistration(db, {
    linkId: "full",
    names: ["CAROL"],
  }), {
    reserved: false,
    inserted: [],
  });
  assert.deepEqual(runExternalRegistration(db, {
    linkId: "missing-date",
    names: ["DATELESS"],
  }), {
    reserved: false,
    inserted: [],
  });
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM guests").get().count,
    2,
  );
  assert.equal(
    db.prepare("SELECT used_guests FROM external_dj_links WHERE id = 'open'").get()
      .used_guests,
    2,
  );
});

test("external reservation aborts the whole write when an unconfirmed name appears", () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, ?, ?, 1, NULL, NULL, ?)",
  ).run("link", 1, 3, DATE);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', NULL, ?, ?)`,
  ).run("existing", "venue-a", "ALICE", "link", DATE, NOW, NOW);

  assert.deepEqual(runExternalRegistration(db, {
    linkId: "link",
    names: ["ALICE", "BOB"],
  }), {
    reserved: false,
    inserted: [],
  });
  assert.equal(
    db.prepare("SELECT used_guests FROM external_dj_links WHERE id = 'link'").get()
      .used_guests,
    1,
  );
});

test("repeated external soft delete decrements capacity exactly once", () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, ?, ?, 1, NULL, NULL, ?)",
  ).run("link", 1, 3, DATE);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', NULL, ?, ?)`,
  ).run("guest", "venue-a", "ALICE", "link", DATE, NOW, NOW);

  assert.deepEqual(runExternalSoftDelete(db, "link", "guest"), {
    decremented: true,
    deleted: true,
  });
  assert.deepEqual(runExternalSoftDelete(db, "link", "guest"), {
    decremented: false,
    deleted: false,
  });

  assert.equal(
    db.prepare("SELECT used_guests FROM external_dj_links WHERE id = 'link'").get()
      .used_guests,
    0,
  );
  assert.equal(
    db.prepare("SELECT status FROM guests WHERE id = 'guest'").get().status,
    "deleted",
  );
});

test("external token delete rechecks link capability and pending status atomically", () => {
  const db = createDatabase();
  const insertLink = db.prepare(`INSERT INTO external_dj_links (
    id, used_guests, max_guests, active, deleted_at, expires_at, date, token, venue_id
  ) VALUES (?, 1, 3, ?, ?, ?, ?, ?, ?)`);
  const insertGuest = db.prepare(`INSERT INTO guests
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?)`);
  const cases = [
    {
      id: "inactive",
      active: 0,
      deletedAt: null,
      expiresAt: null,
      linkDate: DATE,
      token: "token",
      venueId: "venue-a",
      guestStatus: "pending",
    },
    {
      id: "archived",
      active: 0,
      deletedAt: NOW,
      expiresAt: null,
      linkDate: DATE,
      token: "token",
      venueId: "venue-a",
      guestStatus: "pending",
    },
    {
      id: "expired",
      active: 1,
      deletedAt: null,
      expiresAt: "2026-08-05T11:59:59.999Z",
      linkDate: DATE,
      token: "token",
      venueId: "venue-a",
      guestStatus: "pending",
    },
    {
      id: "date-mismatch",
      active: 1,
      deletedAt: null,
      expiresAt: null,
      linkDate: "2026-08-06",
      token: "token",
      venueId: "venue-a",
      guestStatus: "pending",
    },
    {
      id: "checked",
      active: 1,
      deletedAt: null,
      expiresAt: null,
      linkDate: DATE,
      token: "token",
      venueId: "venue-a",
      guestStatus: "checked",
    },
    {
      id: "wrong-token",
      active: 1,
      deletedAt: null,
      expiresAt: null,
      linkDate: DATE,
      token: "rotated-token",
      venueId: "venue-a",
      guestStatus: "pending",
    },
    {
      id: "wrong-venue",
      active: 1,
      deletedAt: null,
      expiresAt: null,
      linkDate: DATE,
      token: "token",
      venueId: "venue-b",
      guestStatus: "pending",
    },
  ];

  for (const candidate of cases) {
    insertLink.run(
      candidate.id,
      candidate.active,
      candidate.deletedAt,
      candidate.expiresAt,
      candidate.linkDate,
      candidate.token,
      candidate.venueId,
    );
    insertGuest.run(
      `${candidate.id}-guest`,
      "venue-a",
      candidate.id.toUpperCase(),
      candidate.id,
      DATE,
      candidate.guestStatus,
      NOW,
      NOW,
    );

    const result = runExternalSoftDelete(
      db,
      candidate.id,
      `${candidate.id}-guest`,
      { date: candidate.linkDate },
    );

    assert.deepEqual(result, { decremented: false, deleted: false }, candidate.id);
    assert.equal(
      db.prepare("SELECT used_guests FROM external_dj_links WHERE id = ?")
        .get(candidate.id).used_guests,
      1,
      candidate.id,
    );
    assert.equal(
      db.prepare("SELECT status FROM guests WHERE id = ?")
        .get(`${candidate.id}-guest`).status,
      candidate.guestStatus,
      candidate.id,
    );
  }
});

test("authenticated soft delete enforces expected venue and ownership", () => {
  const db = createDatabase();
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, NULL, ?, NULL, ?, 'pending', NULL, ?, ?)`,
  ).run("guest", "venue-a", "ALICE", "user-a", DATE, NOW, NOW);
  const remove = db.prepare(SOFT_DELETE_GUEST_SQL);

  assert.equal(
    remove.get(NOW, "guest", "venue-b", 1, "user-b"),
    undefined,
  );
  assert.equal(
    remove.get(NOW, "guest", "venue-a", 0, "user-b"),
    undefined,
  );
  assert.equal(
    remove.get(NOW, "guest", "venue-a", 0, "user-a")?.id,
    "guest",
  );
  assert.equal(
    db.prepare("SELECT status FROM guests WHERE id = 'guest'").get().status,
    "deleted",
  );
});

test("status updates cannot revive deleted guests or cross venue scope", () => {
  const db = createDatabase();
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'deleted', NULL, ?, ?)`,
  ).run("deleted", "venue-a", "ALICE", DATE, NOW, NOW);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'pending', NULL, ?, ?)`,
  ).run("active", "venue-a", "BOB", DATE, NOW, NOW);
  const update = db.prepare(UPDATE_ACTIVE_GUEST_STATUS_SQL);

  assert.equal(
    update.get("checked", NOW, NOW, "deleted", "venue-a", "checked"),
    undefined,
  );
  assert.equal(
    update.get("checked", NOW, NOW, "active", "venue-b", "checked"),
    undefined,
  );
  assert.equal(
    update.get("deleted", null, NOW, "active", "venue-a", "deleted"),
    undefined,
  );
  assert.equal(
    update.get("checked", NOW, NOW, "active", "venue-a", "checked")?.id,
    "active",
  );
  const active = db
    .prepare("SELECT status, check_in_time FROM guests WHERE id = 'active'")
    .get();
  assert.equal(active.status, "checked");
  assert.equal(active.check_in_time, NOW);
});

test("permanent delete decrements only when the external guest is still active", () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, ?, ?, 1, NULL, NULL, ?)",
  ).run("link", 1, 3, DATE);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', NULL, ?, ?)`,
  ).run("active", "venue-a", "ALICE", "link", DATE, NOW, NOW);

  db.exec("BEGIN");
  db.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).get(
    "link",
    "active",
    "link",
    "venue-a",
  );
  db.prepare(PERMANENT_DELETE_GUEST_SQL).get("active", "venue-a");
  db.exec("COMMIT");

  assert.equal(
    db.prepare("SELECT used_guests FROM external_dj_links WHERE id = 'link'").get()
      .used_guests,
    0,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM guests").get().count,
    0,
  );

  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'deleted', NULL, ?, ?)`,
  ).run("already-deleted", "venue-a", "BOB", "link", DATE, NOW, NOW);
  db.exec("BEGIN");
  db.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).get(
    "link",
    "already-deleted",
    "link",
    "venue-a",
  );
  db.prepare(PERMANENT_DELETE_GUEST_SQL).get("already-deleted", "venue-a");
  db.exec("COMMIT");

  assert.equal(
    db.prepare("SELECT used_guests FROM external_dj_links WHERE id = 'link'").get()
      .used_guests,
    0,
  );
});

test("permanent delete cannot decrement or remove a guest outside the expected venue", () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, ?, ?, 1, NULL, NULL, ?)",
  ).run("link", 1, 3, DATE);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', NULL, ?, ?)`,
  ).run("guest", "venue-a", "ALICE", "link", DATE, NOW, NOW);

  db.exec("BEGIN");
  db.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).get(
    "link",
    "guest",
    "link",
    "venue-b",
  );
  const removed = db
    .prepare(PERMANENT_DELETE_GUEST_SQL)
    .get("guest", "venue-b");
  db.exec("COMMIT");

  assert.equal(removed, undefined);
  assert.equal(
    db.prepare("SELECT used_guests FROM external_dj_links WHERE id = 'link'").get()
      .used_guests,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM guests WHERE id = 'guest'").get()
      .count,
    1,
  );
});

test("internal bulk SQL enforces duplicate confirmation and quota in one transaction", () => {
  const db = createDatabase();
  const insert = db.prepare(INTERNAL_BULK_GUEST_INSERT_SQL);
  const bind = ({ id, name, allowDuplicate, limit }) => [
    id,
    "venue-a",
    name,
    "user-a",
    null,
    DATE,
    NOW,
    NOW,
    "venue-a",
    allowDuplicate ? 1 : 0,
    "venue-a",
    "user-a",
    DATE,
    name,
    limit,
    "user-a",
    DATE,
    limit ?? 0,
    "user-a",
    DATE,
  ];

  db.exec("BEGIN");
  assert.equal(Boolean(insert.get(...bind({ id: "one", name: "ALICE", allowDuplicate: false, limit: 3 }))), true);
  assert.equal(Boolean(insert.get(...bind({ id: "duplicate", name: "ALICE", allowDuplicate: false, limit: 3 }))), false);
  assert.equal(Boolean(insert.get(...bind({ id: "duplicate-allowed", name: "ALICE", allowDuplicate: true, limit: 3 }))), true);
  assert.equal(Boolean(insert.get(...bind({ id: "two", name: "BOB", allowDuplicate: false, limit: 3 }))), true);
  assert.equal(Boolean(insert.get(...bind({ id: "over", name: "CAROL", allowDuplicate: false, limit: 3 }))), false);
  db.exec("COMMIT");

  assert.deepEqual(
    db.prepare("SELECT id FROM guests ORDER BY id").all().map((row) => row.id),
    ["duplicate-allowed", "one", "two"],
  );
});

test("inactive venues reject guest registration and mutation at the SQL boundary", () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, 0, 3, 1, NULL, NULL, ?)",
  ).run("link", DATE);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'pending', NULL, ?, ?)`,
  ).run("guest", "venue-a", "ALICE", "link", "user-a", DATE, NOW, NOW);
  db.prepare("UPDATE venues SET active = 0 WHERE id = 'venue-a'").run();

  assert.deepEqual(
    runExternalRegistration(db, { linkId: "link", names: ["BOB"] }),
    { reserved: false, inserted: [] },
  );
  assert.deepEqual(runExternalSoftDelete(db, "link", "guest"), {
    decremented: false,
    deleted: false,
  });
  assert.equal(
    db
      .prepare(UPDATE_ACTIVE_GUEST_STATUS_SQL)
      .get("checked", NOW, NOW, "guest", "venue-a", "checked"),
    undefined,
  );

  const internalInsert = db.prepare(INTERNAL_BULK_GUEST_INSERT_SQL);
  assert.equal(
    internalInsert.get(
      "internal",
      "venue-a",
      "CAROL",
      "user-a",
      null,
      DATE,
      NOW,
      NOW,
      "venue-a",
      0,
      "venue-a",
      "user-a",
      DATE,
      "CAROL",
      10,
      "user-a",
      DATE,
      10,
      "user-a",
      DATE,
    ),
    undefined,
  );
});
