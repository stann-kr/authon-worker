import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [client, homePage, loginPage, loginRoute, middleware, logoutRoute, venuesApi] =
  await Promise.all([
    readFile(new URL("../auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/page.tsx", import.meta.url), "utf8"),
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
  const cleanupIndex = logoutRoute.indexOf("env.SESSIONS.delete");
  const sessionBindingIndex = logoutRoute.indexOf("parseStoredSession(sessionRaw)");
  const globalRevokeIndex = logoutRoute.indexOf("env.DB.prepare(REVOKE_USER_SESSIONS_SQL)");
  const responseIndex = logoutRoute.indexOf(
    "return createLogoutResponse(request, revocationPending)",
  );
  const responseHelper = logoutRoute.slice(
    logoutRoute.indexOf("function createLogoutResponse"),
  );
  assert.ok(originGuardIndex >= 0 && originGuardIndex < sessionBindingIndex);
  assert.match(
    logoutRoute,
    /parseLogoutAuthCookies\(\s*request\.headers\.get\("cookie"\),\s*\)/,
  );
  assert.doesNotMatch(logoutRoute, /split\("; "\)/);
  assert.match(logoutRoute, /for \(const name of \["token", "sessionId"\] as const\)/);
  assert.match(logoutRoute, /response\.cookies\.set\([\s\S]*?maxAge: 0/);
  assert.match(logoutRoute, /jwtVerify\([\s\S]*?clockTolerance: 60/);
  assert.match(logoutRoute, /error instanceof joseErrors\.JOSEError/);
  assert.match(logoutRoute, /resolveLogoutSessionBinding\([\s\S]*?env\.SESSIONS\.get/);
  assert.match(logoutRoute, /retrySessionRevocation\(\(\) =>[\s\S]*?REVOKE_USER_SESSIONS_SQL/);
  assert.ok(sessionBindingIndex >= 0 && sessionBindingIndex < globalRevokeIndex);
  assert.match(logoutRoute, /binding\.status === "pending"[\s\S]*?revocationPending = true/);
  assert.match(logoutRoute, /if \(!revocationPending && sessionId && env\.SESSIONS\)/);
  assert.ok(cleanupIndex < responseIndex);
  assert.match(logoutRoute, /code: "SESSION_REVOCATION_PENDING"/);
  assert.match(logoutRoute, /revocationPending: true/);
  assert.match(logoutRoute, /\{ status: 503 \}/);
  assert.match(logoutRoute, /createLogoutResponse\(request, revocationPending\)/);
  assert.doesNotMatch(logoutRoute, /createLogoutResponse\(request, cleanupFailed\)/);
  assert.match(
    responseHelper,
    /if \(revocationPending\) \{\s*return NextResponse\.json\([\s\S]*?\{ status: 503 \},\s*\);\s*\}\s*const response/,
  );
  assert.ok(
    responseHelper.indexOf("if (revocationPending)") <
      responseHelper.indexOf("response.cookies.set"),
  );
  assert.match(
    logoutRoute,
    /catch \(error\) \{\s*cleanupFailed = true;\s*revocationPending = true;\s*try \{\s*await reportServerError\("auth\.logout"/,
  );
  assert.match(venuesApi, /activeChanged/);
  assert.match(venuesApi, /sessionVersion: sql`\$\{users\.sessionVersion\} \+ 1`/);
  assert.match(venuesApi, /await db\.batch\(/);
});

test("client logout preserves local state on failure and Home recovers pending auth", () => {
  const resultCheckIndex = client.indexOf("if (!response.ok || resultBody?.ok !== true)");
  const cacheClearIndex = client.indexOf("cacheUser(null)");
  assert.match(client, /export type LogoutResult =/);
  assert.ok(resultCheckIndex >= 0 && resultCheckIndex < cacheClearIndex);
  assert.match(client, /code: "LOGOUT_NETWORK_ERROR"/);
  assert.match(client, /window\.location\.href = "\/auth\/login"/);
  assert.match(
    homePage,
    /const logoutResult = await logout\(\);[\s\S]*?if \(!logoutResult\.success && isLatestRequest\(\)\)[\s\S]*?router\.refresh\(\)/,
  );
});
