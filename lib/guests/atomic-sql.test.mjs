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
  RESTORE_DELETED_GUEST_SQL,
  UPDATE_GUEST_DETAILS_SQL,
  UPDATE_ACTIVE_GUEST_STATUS_SQL,
} from "./atomic-sql.ts";
import { prepareGuestActivityAfterChange } from "./activity-ledger.ts";

const NOW = "2026-08-05T12:00:00.000Z";
const DATE = "2026-08-05";

function actorBindings(id, {
  role = "staff",
  venueId = "venue-a",
  guestLimit = 3,
  accountKind = "personal",
  doorAccessEnabled = 0,
  sessionVersion = 1,
} = {}) {
  return [
    id,
    role,
    accountKind,
    doorAccessEnabled,
    venueId,
    guestLimit,
    sessionVersion,
  ];
}

function bulkActorBindings(id, options) {
  const [actorId, role, accountKind, doorAccessEnabled, venueId, , sessionVersion] =
    actorBindings(id, options);
  return [
    actorId,
    role,
    accountKind,
    doorAccessEnabled,
    venueId,
    sessionVersion,
  ];
}

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      active INTEGER NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE external_dj_links (
      id TEXT PRIMARY KEY,
      used_guests INTEGER NOT NULL,
      max_guests INTEGER NOT NULL,
      active INTEGER NOT NULL,
      deleted_at TEXT,
      expires_at TEXT,
      date TEXT,
      event_id TEXT DEFAULT 'event-a',
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
      updated_at TEXT NOT NULL,
      event_id TEXT
    );
    CREATE TABLE guest_limit_requests (
      venue_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      approved_extra INTEGER NOT NULL,
      status TEXT NOT NULL,
      event_id TEXT
    );
    CREATE TABLE event_contributor_limits (
      event_id TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      guest_limit INTEGER
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      account_kind TEXT NOT NULL,
      door_access_enabled INTEGER NOT NULL,
      venue_id TEXT,
      guest_limit INTEGER,
      session_version INTEGER NOT NULL,
      active INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE guest_activity_ledger (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      event_id TEXT,
      guest_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_user_id TEXT,
      actor_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      request_id TEXT NOT NULL,
      idempotency_key TEXT,
      payload_hash TEXT,
      outcome TEXT NOT NULL,
      previous_status TEXT,
      next_status TEXT,
      device_key_hash TEXT,
      session_key_hash TEXT,
      occurred_at TEXT NOT NULL
    );
    INSERT INTO venues (id, active) VALUES ('venue-a', 1);
    INSERT INTO events VALUES ('event-a', 'venue-a', '${DATE}', 'open');
    INSERT INTO users VALUES
      ('user-a', 'staff', 'personal', 0, 'venue-a', 3, 1, 1, NULL),
      ('count-user', 'staff', 'personal', 0, 'venue-a', 3, 1, 1, NULL),
      ('extra-user', 'staff', 'personal', 0, 'venue-a', 3, 1, 1, NULL),
      ('admin-a', 'venue_admin', 'personal', 0, 'venue-a', 3, 1, 1, NULL);
    INSERT INTO event_contributor_limits VALUES ('event-a', 'venue-a', 'user-a', 3);
  `);
  return db;
}

function sqliteD1() {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return { sql, args };
        },
      };
    },
  };
}

function runBatch(database, statements) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const results = statements.map(({ sql, args }) =>
      database.prepare(sql).all(...args),
    );
    database.exec("COMMIT");
    return results;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
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
      "event-a",
      "event-a",
      ...guardedNames.flatMap((name) => [linkId, name]),
    );
    const insert = db.prepare(EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL);
    const inserted = names.flatMap((name, index) => {
      const row = insert.get(
        `${linkId}-guest-${index}`,
        "venue-a",
        name,
        linkId,
        "event-a",
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
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
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
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
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
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, NULL)`);
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
     VALUES (?, ?, ?, NULL, ?, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
  ).run("guest", "venue-a", "ALICE", "user-a", DATE, NOW, NOW);
  const remove = db.prepare(SOFT_DELETE_GUEST_SQL);

  assert.equal(
    remove.get(NOW, "event-a", "guest", "venue-b", "event-a", 1, DATE, "event-a", 1, "user-b", ...actorBindings("user-a")),
    undefined,
  );
  assert.equal(
    remove.get(NOW, "event-a", "guest", "venue-a", "event-a", 1, DATE, "event-a", 0, "user-b", ...actorBindings("user-a")),
    undefined,
  );
  assert.equal(
    remove.get(NOW, "event-a", "guest", "venue-a", "event-a", 1, DATE, "event-a", 0, "user-a", ...actorBindings("user-a"))?.id,
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
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'deleted', NULL, ?, ?, NULL)`,
  ).run("deleted", "venue-a", "ALICE", DATE, NOW, NOW);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
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

test("guest detail updates keep destination venue, event, date, and ownership in one predicate", () => {
  const db = createDatabase();
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, NULL, ?, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
  ).run("guest", "venue-a", "ALICE", "user-a", DATE, NOW, NOW);
  const update = db.prepare(UPDATE_GUEST_DETAILS_SQL);

  assert.equal(
    update.get(
      "venue-a", "ALICE 2", DATE, "event-a", NOW,
      "guest", "venue-a", "venue-a", "event-a", "venue-a", DATE,
      0, "user-b", ...actorBindings("user-a"),
    ),
    undefined,
  );
  assert.equal(
    update.get(
      "venue-a", "ALICE 2", DATE, "event-a", NOW,
      "guest", "venue-a", "venue-a", "event-a", "venue-a", DATE,
      0, "user-a", ...actorBindings("user-a"),
    )?.id,
    "guest",
  );
  assert.deepEqual(
    { ...db.prepare("SELECT name, event_id AS eventId FROM guests WHERE id = 'guest'").get() },
    { name: "ALICE 2", eventId: "event-a" },
  );
});

test("restore is forward-only from deleted and requires an active writable event", () => {
  const db = createDatabase();
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, NULL, ?, NULL, ?, 'deleted', ?, ?, ?, NULL)`,
  ).run("guest", "venue-a", "ALICE", "user-a", DATE, NOW, NOW, NOW);
  const restore = db.prepare(RESTORE_DELETED_GUEST_SQL);

  assert.equal(
    restore.get(NOW, "event-a", "guest", "venue-a", "event-a", 1, DATE, "event-a", ...actorBindings("admin-a", { role: "venue_admin" }))?.id,
    "guest",
  );
  assert.equal(
    restore.get(NOW, "event-a", "guest", "venue-a", "event-a", 1, DATE, "event-a", ...actorBindings("admin-a", { role: "venue_admin" })),
    undefined,
  );
  assert.deepEqual(
    { ...db.prepare("SELECT status, check_in_time AS checkInTime, event_id AS eventId FROM guests WHERE id = 'guest'").get() },
    { status: "pending", checkInTime: null, eventId: "event-a" },
  );

  db.prepare("UPDATE guests SET status = 'deleted', event_id = NULL WHERE id = 'guest'").run();
  db.prepare("UPDATE events SET state = 'closed' WHERE id = 'event-a'").run();
  assert.equal(
    restore.get(NOW, "event-a", "guest", "venue-a", "event-a", 1, DATE, "event-a", ...actorBindings("admin-a", { role: "venue_admin" })),
    undefined,
  );
});

test("revoked actor snapshots leave authenticated guest mutations and link counters unchanged", () => {
  const db = createDatabase();
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'pending', NULL, ?, ?, ?)`,
  ).run("guest", "venue-a", "ALICE", "link", "user-a", DATE, NOW, NOW, "event-a");
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES ('link', 1, 3, 1, NULL, NULL, ?)",
  ).run(DATE);

  db.prepare("UPDATE users SET session_version = 2 WHERE id = 'user-a'").run();
  assert.equal(
    db.prepare(SOFT_DELETE_GUEST_SQL).get(
      NOW, "event-a", "guest", "venue-a", "event-a", 0, DATE, "event-a", 0, "user-a",
      ...actorBindings("user-a"),
    ),
    undefined,
  );
  assert.equal(
    db.prepare(UPDATE_GUEST_DETAILS_SQL).get(
      "venue-a", "ALICE 2", DATE, "event-a", NOW,
      "guest", "venue-a", "venue-a", "event-a", "venue-a", DATE,
      0, "user-a", ...actorBindings("user-a"),
    ),
    undefined,
  );
  assert.equal(
    db.prepare(INTERNAL_BULK_GUEST_INSERT_SQL).get(
      "new", "venue-a", "BOB", "user-a", null, "event-a", DATE, NOW, NOW,
      "venue-a", "event-a", "venue-a", DATE, 0, "venue-a", "user-a", "event-a", 0, DATE, "BOB", 3,
      "venue-a", "user-a", "event-a", 0, DATE, 3,
      "venue-a", "user-a", "event-a", 0, DATE,
      "event-a", "venue-a", "user-a", 3,
      ...bulkActorBindings("user-a"), "venue-a",
    ),
    undefined,
  );

  db.prepare("UPDATE users SET session_version = 2 WHERE id = 'admin-a'").run();
  db.prepare("UPDATE guests SET status = 'deleted' WHERE id = 'guest'").run();
  assert.equal(
    db.prepare(RESTORE_DELETED_GUEST_SQL).get(
      NOW, "event-a", "guest", "venue-a", "event-a", 0, DATE, "event-a",
      ...actorBindings("admin-a", { role: "venue_admin" }),
    ),
    undefined,
  );
  db.prepare("UPDATE guests SET status = 'pending' WHERE id = 'guest'").run();
  assert.equal(
    db.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).get(
      "link", "guest", "link", "venue-a",
      ...actorBindings("admin-a", { role: "venue_admin" }),
    ),
    undefined,
  );
  assert.equal(
    db.prepare(PERMANENT_DELETE_GUEST_SQL).get(
      "guest", "venue-a", ...actorBindings("admin-a", { role: "venue_admin" }),
    ),
    undefined,
  );
  assert.deepEqual(
    { ...db.prepare("SELECT name, status FROM guests WHERE id = 'guest'").get() },
    { name: "ALICE", status: "pending" },
  );
  assert.equal(
    db.prepare("SELECT used_guests AS usedGuests FROM external_dj_links WHERE id = 'link'").get().usedGuests,
    1,
  );
});

test("permanent delete decrements only when the external guest is still active", () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, ?, ?, 1, NULL, NULL, ?)",
  ).run("link", 1, 3, DATE);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
  ).run("active", "venue-a", "ALICE", "link", DATE, NOW, NOW);

  db.exec("BEGIN");
  db.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).get(
    "link",
    "active",
    "link",
    "venue-a",
    ...actorBindings("admin-a", { role: "venue_admin" }),
  );
  db.prepare(PERMANENT_DELETE_GUEST_SQL).get("active", "venue-a", ...actorBindings("admin-a", { role: "venue_admin" }));
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
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'deleted', NULL, ?, ?, NULL)`,
  ).run("already-deleted", "venue-a", "BOB", "link", DATE, NOW, NOW);
  db.exec("BEGIN");
  db.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).get(
    "link",
    "already-deleted",
    "link",
    "venue-a",
    ...actorBindings("admin-a", { role: "venue_admin" }),
  );
  db.prepare(PERMANENT_DELETE_GUEST_SQL).get("already-deleted", "venue-a", ...actorBindings("admin-a", { role: "venue_admin" }));
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
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
  ).run("guest", "venue-a", "ALICE", "link", DATE, NOW, NOW);

  db.exec("BEGIN");
  db.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).get(
    "link",
    "guest",
    "link",
    "venue-b",
    ...actorBindings("admin-a", { role: "venue_admin" }),
  );
  const removed = db
    .prepare(PERMANENT_DELETE_GUEST_SQL)
    .get("guest", "venue-b", ...actorBindings("admin-a", { role: "venue_admin" }));
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
  const bind = ({ id, name, allowDuplicate, limit, eventId = "event-a" }) => [
    id,
    "venue-a",
    name,
    "user-a",
    null,
    eventId,
    DATE,
    NOW,
    NOW,
    "venue-a",
    eventId,
    "venue-a",
    DATE,
    allowDuplicate ? 1 : 0,
    "venue-a",
    "user-a",
    eventId,
    0,
    DATE,
    name,
    limit,
    "venue-a",
    "user-a",
    eventId,
    0,
    DATE,
    limit ?? 0,
    "venue-a",
    "user-a",
    eventId,
    0,
    DATE,
    eventId,
    "venue-a",
    "user-a",
    limit,
    ...bulkActorBindings("user-a"),
    "venue-a",
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

  db.prepare("INSERT INTO events VALUES (?, ?, ?, ?)").run(
    "event-b",
    "venue-a",
    DATE,
    "open",
  );
  db.prepare("INSERT INTO event_contributor_limits VALUES (?, ?, ?, ?)").run(
    "event-b",
    "venue-a",
    "user-a",
    1,
  );
  assert.equal(
    Boolean(insert.get(...bind({
      id: "other-event",
      name: "ALICE",
      allowDuplicate: false,
      limit: 1,
      eventId: "event-b",
    }))),
    true,
  );
  assert.equal(
    db.prepare("SELECT event_id AS eventId FROM guests WHERE id = ?").get("other-event").eventId,
    "event-b",
  );
});

test("event contributor snapshot remains authoritative after global limit changes", () => {
  const db = createDatabase();
  const insert = db.prepare(INTERNAL_BULK_GUEST_INSERT_SQL);
  db.prepare("UPDATE users SET guest_limit = 0 WHERE id = 'user-a'").run();
  db.prepare(
    "UPDATE event_contributor_limits SET guest_limit = 5 WHERE event_id = 'event-a' AND user_id = 'user-a'",
  ).run();
  const bind = (id) => [
    id, "venue-a", id.toUpperCase(), "user-a", null, "event-a", DATE, NOW, NOW,
    "venue-a", "event-a", "venue-a", DATE, 0, "venue-a", "user-a", "event-a", 0, DATE, id.toUpperCase(), 5,
    "venue-a", "user-a", "event-a", 0, DATE, 5,
    "venue-a", "user-a", "event-a", 0, DATE,
    "event-a", "venue-a", "user-a", 5,
    ...bulkActorBindings("user-a", { guestLimit: 5 }), "venue-a",
  ];

  assert.equal(Boolean(insert.get(...bind("snapshot-five"))), true);
  db.prepare(
    "UPDATE event_contributor_limits SET guest_limit = 0 WHERE event_id = 'event-a' AND user_id = 'user-a'",
  ).run();
  assert.equal(Boolean(insert.get(...bind("snapshot-stale"))), false);
  assert.deepEqual(
    db.prepare("SELECT id FROM guests ORDER BY id").all().map((row) => row.id),
    ["snapshot-five"],
  );
});

test("bulk guest and ledger share the immutable contributor snapshot guard", () => {
  const db = createDatabase();
  const d1 = sqliteD1();
  db.prepare("UPDATE users SET guest_limit = 0 WHERE id = 'user-a'").run();
  db.prepare(
    "UPDATE event_contributor_limits SET guest_limit = 5 WHERE event_id = 'event-a' AND user_id = 'user-a'",
  ).run();
  const actor = {
    id: "user-a",
    role: "staff",
    venueId: "venue-a",
    guestLimit: 5,
    accountKind: "personal",
    doorAccessEnabled: false,
    sessionVersion: 1,
  };
  const insert = (id) => d1.prepare(INTERNAL_BULK_GUEST_INSERT_SQL).bind(
    id, "venue-a", id.toUpperCase(), "user-a", null, "event-a", DATE, NOW, NOW,
    "venue-a", "event-a", "venue-a", DATE, 0, "venue-a", "user-a", "event-a", 0, DATE, id.toUpperCase(), 5,
    "venue-a", "user-a", "event-a", 0, DATE, 5,
    "venue-a", "user-a", "event-a", 0, DATE,
    "event-a", "venue-a", "user-a", 5,
    ...bulkActorBindings("user-a", { guestLimit: 5 }), "venue-a",
  );
  const activity = (id) => prepareGuestActivityAfterChange(d1, {
    activityId: `activity-${id}`,
    venueId: "venue-a",
    eventId: "event-a",
    guestId: id,
    action: "add",
    actorUserId: "user-a",
    actorType: "user",
    channel: "guest",
    requestId: `request-${id}`,
    previousStatus: null,
    nextStatus: "pending",
    occurredAt: NOW,
    finalActor: actor,
    finalAccess: "guest",
    verifyGuestLimit: false,
  });

  const created = runBatch(db, [insert("snapshot-five"), activity("snapshot-five")]);
  assert.equal(created[0][0].id, "snapshot-five");
  assert.equal(created[1][0].id, "activity-snapshot-five");

  db.prepare(
    "UPDATE event_contributor_limits SET guest_limit = 0 WHERE event_id = 'event-a' AND user_id = 'user-a'",
  ).run();
  const denied = runBatch(db, [insert("snapshot-stale"), activity("snapshot-stale")]);
  assert.deepEqual(denied, [[], []]);
  assert.deepEqual(
    db.prepare("SELECT id FROM guests ORDER BY id").all().map((row) => row.id),
    ["snapshot-five"],
  );
  assert.deepEqual(
    db.prepare("SELECT id FROM guest_activity_ledger ORDER BY id").all().map((row) => row.id),
    ["activity-snapshot-five"],
  );
});

test("bulk guest and ledger reject stale event state, date, and venue snapshots", () => {
  for (const [label, mutateEvent] of [
    ["closed", (db) => db.prepare("UPDATE events SET state = 'closed' WHERE id = 'event-a'").run()],
    ["date", (db) => db.prepare("UPDATE events SET business_date = '2026-08-06' WHERE id = 'event-a'").run()],
    ["venue", (db) => db.prepare("UPDATE events SET venue_id = 'venue-b' WHERE id = 'event-a'").run()],
  ]) {
    const db = createDatabase();
    const d1 = sqliteD1();
    db.prepare("UPDATE users SET guest_limit = 0 WHERE id = 'user-a'").run();
    db.prepare(
      "UPDATE event_contributor_limits SET guest_limit = 5 WHERE event_id = 'event-a' AND user_id = 'user-a'",
    ).run();
    mutateEvent(db);
    const id = `event-stale-${label}`;
    const activityId = `activity-${id}`;
    const [guest, activity] = runBatch(db, [
      d1.prepare(INTERNAL_BULK_GUEST_INSERT_SQL).bind(
        id, "venue-a", id.toUpperCase(), "user-a", null, "event-a", DATE, NOW, NOW,
        "venue-a", "event-a", "venue-a", DATE, 0,
        "venue-a", "user-a", "event-a", 0, DATE, id.toUpperCase(), 5,
        "venue-a", "user-a", "event-a", 0, DATE, 5,
        "venue-a", "user-a", "event-a", 0, DATE,
        "event-a", "venue-a", "user-a", 5,
        ...bulkActorBindings("user-a", { guestLimit: 5 }), "venue-a",
      ),
      prepareGuestActivityAfterChange(d1, {
        activityId,
        venueId: "venue-a",
        eventId: "event-a",
        guestId: id,
        action: "add",
        actorUserId: "user-a",
        actorType: "user",
        channel: "guest",
        requestId: `request-${id}`,
        previousStatus: null,
        nextStatus: "pending",
        occurredAt: NOW,
        finalActor: {
          id: "user-a",
          role: "staff",
          venueId: "venue-a",
          guestLimit: 5,
          accountKind: "personal",
          doorAccessEnabled: false,
          sessionVersion: 1,
        },
        finalAccess: "guest",
        verifyGuestLimit: false,
      }),
    ]);
    assert.deepEqual(guest, [], label);
    assert.deepEqual(activity, [], label);
    assert.equal(db.prepare("SELECT count(*) AS count FROM guests").get().count, 0, label);
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM guest_activity_ledger").get().count,
      0,
      label,
    );
  }
});

test("legacy quota rows remain scoped to their exact venue", () => {
  const db = createDatabase();
  db.prepare("INSERT INTO venues (id, active) VALUES (?, 1)").run("venue-b");
  db.prepare("INSERT INTO events VALUES (?, ?, ?, ?)").run(
    "event-b",
    "venue-b",
    DATE,
    "open",
  );
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, NULL, ?, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
  ).run("legacy-other-venue", "venue-a", "ALICE", "count-user", DATE, NOW, NOW);
  db.prepare(
    `INSERT INTO guest_limit_requests
     (venue_id, user_id, date, approved_extra, status, event_id)
     VALUES (?, ?, ?, ?, 'approved', NULL)`,
  ).run("venue-a", "extra-user", DATE, 5);

  const insert = db.prepare(INTERNAL_BULK_GUEST_INSERT_SQL);
  db.prepare("UPDATE users SET venue_id = 'venue-b' WHERE id IN ('count-user', 'extra-user')").run();
  db.prepare("INSERT INTO event_contributor_limits VALUES (?, ?, ?, ?), (?, ?, ?, ?)").run(
    "event-b", "venue-b", "count-user", 1,
    "event-b", "venue-b", "extra-user", 1,
  );
  const bind = ({ id, actorUserId }) => [
    id,
    "venue-b",
    id.toUpperCase(),
    actorUserId,
    null,
    "event-b",
    DATE,
    NOW,
    NOW,
    "venue-b",
    "event-b",
    "venue-b",
    DATE,
    0,
    "venue-b",
    actorUserId,
    "event-b",
    1,
    DATE,
    id.toUpperCase(),
    1,
    "venue-b",
    actorUserId,
    "event-b",
    1,
    DATE,
    1,
    "venue-b",
    actorUserId,
    "event-b",
    1,
    DATE,
    "event-b",
    "venue-b",
    actorUserId,
    1,
    ...bulkActorBindings(actorUserId, { venueId: "venue-b" }),
    "venue-b",
  ];

  assert.equal(
    Boolean(insert.get(...bind({ id: "count-first", actorUserId: "count-user" }))),
    true,
  );
  assert.equal(
    Boolean(insert.get(...bind({ id: "extra-first", actorUserId: "extra-user" }))),
    true,
  );
  assert.equal(
    Boolean(insert.get(...bind({ id: "extra-over", actorUserId: "extra-user" }))),
    false,
  );
});

test("inactive venues reject guest registration and mutation at the SQL boundary", () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO external_dj_links (id, used_guests, max_guests, active, deleted_at, expires_at, date) VALUES (?, 0, 3, 1, NULL, NULL, ?)",
  ).run("link", DATE);
  db.prepare(
    `INSERT INTO guests
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'pending', NULL, ?, ?, NULL)`,
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
      "event-a",
      DATE,
      NOW,
      NOW,
      "venue-a",
      "event-a",
      "venue-a",
      DATE,
      0,
      "venue-a",
      "user-a",
      "event-a",
      0,
      DATE,
      "event-a",
      "venue-a",
      "user-a",
      10,
      ...bulkActorBindings("user-a"),
      "venue-a",
      "CAROL",
      10,
      "venue-a",
      "user-a",
      "event-a",
      0,
      DATE,
      10,
      "venue-a",
      "user-a",
      "event-a",
      0,
      DATE,
    ),
    undefined,
  );
});
