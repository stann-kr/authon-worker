import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [client, loginPage, loginRoute, middleware, logoutRoute, venuesApi] =
  await Promise.all([
    readFile(new URL("../auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/auth/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../middleware.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../api/venues.ts", import.meta.url), "utf8"),
  ]);

test("login exposes an accessible opt-in remembered-session control", () => {
  assert.match(client, /keepSignedIn = false/);
  assert.match(client, /JSON\.stringify\(\{ email, password, keepSignedIn \}\)/);
  assert.match(loginPage, /htmlFor="keep-signed-in"/);
  assert.match(loginPage, /id="keep-signed-in"/);
  assert.match(loginPage, /type="checkbox"/);
  assert.match(loginPage, /aria-describedby="keep-signed-in-help"/);
  assert.match(loginPage, /login\([\s\S]*?keepSignedIn,[\s\S]*?\)/);
  assert.match(loginRoute, /createLoginSessionLifetime\(keepSignedIn === true\)/);
});

test("rolling renewal follows complete auth and revocation checks", () => {
  const refreshIndex = middleware.indexOf("getRememberedSessionRefresh(session");
  assert.ok(refreshIndex > middleware.indexOf("jwtVerify(token, secret)"));
  assert.ok(refreshIndex > middleware.indexOf("env.SESSIONS.get"));
  assert.ok(refreshIndex > middleware.indexOf("sessionVersion !== expectedSessionVersion"));
  assert.doesNotMatch(middleware, /SESSIONS\.put/);
  assert.match(loginRoute, /expirationTtl: lifetime\.storageTtlSeconds/);
  assert.match(middleware, /\["token", refreshedToken\], \["sessionId", sessionId\]/);
});

test("explicit termination clears cookies and revokes venue sessions", () => {
  const originGuardIndex = logoutRoute.indexOf("isTrustedMutationOrigin(request)");
  const cookieClearIndex = logoutRoute.indexOf('name: "token"');
  const cleanupIndex = logoutRoute.indexOf("env.SESSIONS.delete");
  const sessionBindingIndex = logoutRoute.indexOf("parseStoredSession(sessionRaw)");
  const globalRevokeIndex = logoutRoute.indexOf("env.DB.prepare(REVOKE_USER_SESSIONS_SQL)");
  assert.ok(originGuardIndex >= 0 && originGuardIndex < cookieClearIndex);
  assert.ok(cookieClearIndex >= 0 && cookieClearIndex < cleanupIndex);
  assert.match(logoutRoute, /name: "sessionId"[\s\S]*?maxAge: 0/);
  assert.match(logoutRoute, /jwtVerify\([\s\S]*?clockTolerance: 60/);
  assert.match(logoutRoute, /REVOKE_USER_SESSIONS_SQL/);
  assert.ok(sessionBindingIndex >= 0 && sessionBindingIndex < globalRevokeIndex);
  assert.match(logoutRoute, /session\?\.userId === userId/);
  assert.match(logoutRoute, /session\.sessionVersion === sessionVersion/);
  assert.ok(globalRevokeIndex < cleanupIndex);
  assert.match(venuesApi, /activeChanged/);
  assert.match(venuesApi, /sessionVersion: sql`\$\{users\.sessionVersion\} \+ 1`/);
  assert.match(venuesApi, /await db\.batch\(/);
});
