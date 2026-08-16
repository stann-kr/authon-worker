import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { REVOKE_USER_SESSIONS_SQL } from "./session-revocation.ts";

test("logout session revocation advances the version exactly once", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      session_version INTEGER NOT NULL
    );
    INSERT INTO users VALUES ('user-a', 3);
  `);
  const statement = database.prepare(REVOKE_USER_SESSIONS_SQL);

  assert.deepEqual(
    { ...statement.get("user-a", 3) },
    { sessionVersion: 4 },
  );
  assert.equal(statement.get("user-a", 3), undefined);
  assert.equal(
    database.prepare("SELECT session_version FROM users WHERE id = 'user-a'").get()
      .session_version,
    4,
  );
  database.close();
});
