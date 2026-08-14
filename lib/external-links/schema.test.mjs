import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = readFileSync(
  new URL("../../migrations/0019_external_link_ownership.sql", import.meta.url),
  "utf8",
);

function createDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE external_dj_links (id TEXT PRIMARY KEY);
    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO external_dj_links VALUES ('legacy-link');
    INSERT INTO guests VALUES ('guest-a', 'pending', '2026-08-13T00:00:00.000Z');
    INSERT INTO guests VALUES ('guest-b', 'pending', '2026-08-13T00:00:00.000Z');
  `);
  db.exec(migration);
  return db;
}

test("migration defaults existing links to contributor and constrains link kind", () => {
  const db = createDb();
  assert.equal(
    db.prepare("SELECT kind FROM external_dj_links WHERE id = 'legacy-link'").get().kind,
    "contributor",
  );
  assert.throws(() => db.exec(
    "INSERT INTO external_dj_links (id, kind) VALUES ('bad', 'scraper')",
  ));
});

test("active self RSVP ownership is unique and requires a SHA-256 hash", () => {
  const db = createDb();
  assert.throws(() => db.prepare(`
    INSERT INTO external_guest_owners
      (guest_id, external_link_id, owner_key_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run("guest-a", "legacy-link", "short", "2026-08-13T00:00:00.000Z"));

  const hash = "a".repeat(64);
  db.prepare(`
    INSERT INTO external_guest_owners
      (guest_id, external_link_id, owner_key_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run("guest-a", "legacy-link", hash, "2026-08-13T00:00:00.000Z");
  assert.throws(() => db.prepare(`
    INSERT INTO external_guest_owners
      (guest_id, external_link_id, owner_key_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run("guest-b", "legacy-link", hash, "2026-08-13T00:00:00.000Z"));
  db.prepare(`
    UPDATE guests SET status = 'deleted', updated_at = ? WHERE id = ?
  `).run("2026-08-13T01:00:00.000Z", "guest-a");
  assert.equal(
    db.prepare(
      "SELECT released_at AS releasedAt FROM external_guest_owners WHERE guest_id = 'guest-a'",
    ).get().releasedAt,
    "2026-08-13T01:00:00.000Z",
  );
  db.prepare(`
    INSERT INTO external_guest_owners
      (guest_id, external_link_id, owner_key_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run("guest-b", "legacy-link", hash, "2026-08-13T01:00:00.000Z");
  assert.equal(
    db.prepare("SELECT count(*) AS total FROM external_guest_owners").get().total,
    2,
  );
  db.exec("DELETE FROM guests WHERE id = 'guest-a'");
  assert.equal(
    db.prepare(
      "SELECT count(*) AS total FROM external_guest_owners WHERE guest_id = 'guest-a'",
    ).get().total,
    0,
  );
});
