import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const facade = await readFile(new URL("../api/guests.ts", import.meta.url), "utf8");
const service = await readFile(new URL("./service.ts", import.meta.url), "utf8");
const persistence = await readFile(new URL("./persistence.ts", import.meta.url), "utf8");
const quota = await readFile(new URL("../guest-limits/server.ts", import.meta.url), "utf8");

test("guest Server Actions retain auth and response mapping without raw persistence", () => {
  assert.match(facade, /requireAccess\("door"\)/);
  assert.match(facade, /requireAccess\("guest"\)/);
  assert.match(facade, /createGuestBatch/);
  assert.match(facade, /updateManagedGuestStatus/);
  assert.match(facade, /deleteManagedGuest/);
  assert.match(facade, /restoreManagedGuest/);
  assert.doesNotMatch(
    facade,
    /getDb|db\/schema|atomic-sql|\.select\(|\.insert\(|\.update\(|\.delete\(|\.batch\(|\.prepare\(/,
  );
});

test("guest orchestration consumes Events and Guest Limits public contracts", () => {
  assert.match(facade, /resolveEventForRosterRead/);
  assert.match(facade, /resolveEventForRosterWrite/);
  assert.match(facade, /loadEventForRosterReadById/);
  assert.match(facade, /getOrCreateEventContributorGuestLimit/);
  assert.doesNotMatch(service, /db\/schema|eventContributorLimits|getDb/);
  assert.match(quota, /eventContributorLimits/);
  assert.match(quota, /onConflictDoNothing/);
});

test("guest persistence keeps each mutation adjacent to its existing ledger write", () => {
  assert.match(persistence, /INTERNAL_BULK_GUEST_INSERT_SQL/);
  assert.match(persistence, /SOFT_DELETE_GUEST_SQL/);
  assert.match(persistence, /UPDATE_GUEST_DETAILS_SQL/);
  assert.match(persistence, /RESTORE_DELETED_GUEST_SQL/);
  assert.match(persistence, /prepareGuestActivityAfterChange/);
  assert.match(persistence, /persistGuestStatusActivity/);
  assert.match(persistence, /Guest and activity ledger result diverged/);
});
