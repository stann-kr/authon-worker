import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const facade = await readFile(new URL("../api/users.ts", import.meta.url), "utf8");
const credentials = await readFile(
  new URL("../auth/managed-user-credentials.ts", import.meta.url),
  "utf8",
);

test("user Server Actions delegate without owning raw user or credential persistence", () => {
  assert.match(facade, /listUserDirectory/);
  assert.match(facade, /updateManagedUserProfile/);
  assert.match(facade, /createManagedUser/);
  assert.match(facade, /deleteManagedUser/);
  assert.match(facade, /issueManagedPasswordLinkCredential/);
  assert.match(facade, /resendManagedInvitationCredential/);
  assert.doesNotMatch(
    facade,
    /getDb|db\/schema|\.select\(|\.insert\(|\.update\(|\.delete\(|\.batch\(|\.prepare\(/,
  );
});

test("managed password links remain an Auth-owned snapshot-guarded lifecycle", () => {
  assert.match(credentials, /INVALIDATE_OTHER_MANAGED_PASSWORD_LINKS_SQL/);
  assert.match(credentials, /ACTIVATE_MANAGED_PASSWORD_LINK_SQL/);
  assert.match(credentials, /INSERT_MANAGED_PASSWORD_LINK_AUDIT_SQL/);
  assert.match(credentials, /CANCEL_MANAGED_PASSWORD_RESET_REQUESTS_SQL/);
  assert.match(credentials, /credentialSnapshot\.passwordHash/);
  assert.match(credentials, /input\.actor\.sessionVersion/);
  assert.match(credentials, /used: true/);
});
