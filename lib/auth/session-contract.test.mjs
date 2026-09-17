import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  client,
  authGuard,
  loginPage,
  resetPasswordPage,
  setupPasswordPage,
  loginRoute,
  loginSession,
  middleware,
  logoutRoute,
  logoutHandler,
  logoutService,
  logoutPersistence,
  venuesApi,
] =
  await Promise.all([
    readFile(new URL("../auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../../components/AuthGuard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/auth/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/auth/reset-password/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/auth/setup-password/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("./login-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../../middleware.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("./logout-route-handler.ts", import.meta.url), "utf8"),
    readFile(new URL("./logout-service.ts", import.meta.url), "utf8"),
    readFile(new URL("./logout-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../api/venues.ts", import.meta.url), "utf8"),
  ]);
const koMessages = JSON.parse(
  await readFile(new URL("../../messages/ko.json", import.meta.url), "utf8"),
);
const enMessages = JSON.parse(
  await readFile(new URL("../../messages/en.json", import.meta.url), "utf8"),
);

test("login exposes a concise accessible opt-in remembered-session control", () => {
  assert.match(client, /keepSignedIn = false/);
  assert.match(client, /JSON\.stringify\(\{ email, password, keepSignedIn \}\)/);
  assert.match(loginPage, /htmlFor="keep-signed-in"/);
  assert.match(loginPage, /id="keep-signed-in"/);
  assert.match(loginPage, /type="checkbox"/);
  assert.doesNotMatch(loginPage, /keep-signed-in-help/);
  assert.doesNotMatch(loginPage, /password-support/);
  assert.match(loginPage, /aria-describedby=\{`password-helper/);
  assert.match(loginPage, /login\([\s\S]*?keepSignedIn,[\s\S]*?\)/);
  assert.match(loginRoute, /loginWithPassword/);
  assert.match(loginSession, /createLoginSessionLifetime\(input\.keepSignedIn === true\)/);
});

test("auth entry flows render each explanatory state once", () => {
  assert.doesNotMatch(loginPage, /t\("emailLoginHelp"\)/);
  assert.doesNotMatch(loginPage, /t\("keepSignedInHelp"\)/);
  assert.doesNotMatch(setupPasswordPage, /t\("setupCodePageDescription"\)/);
  assert.doesNotMatch(resetPasswordPage, /t\("adminRequestSuccess"\)/);
  assert.doesNotMatch(resetPasswordPage, /t\("adminApprovedReset(?:Title|Help)"\)/);
  assert.equal(resetPasswordPage.match(/t\("adminRequestSent"\)/g)?.length, 2);
  assert.match(
    resetPasswordPage,
    /message\?\.type !== "success" && \([\s\S]*?<p/,
  );
  assert.equal(resetPasswordPage.match(/t\("resetSuccess"\)/g)?.length, 1);
  assert.match(
    koMessages.ResetPassword.requestStepShareCode,
    /먼저 연락한 관리자에게만/,
  );
  assert.match(
    enMessages.ResetPassword.requestStepShareCode,
    /only with the administrator who contacted you first/,
  );
});

test("rolling renewal follows complete auth and revocation checks", () => {
  const refreshIndex = middleware.indexOf("getRememberedSessionRefresh(session");
  assert.ok(refreshIndex > middleware.indexOf("jwtVerify(token, secret)"));
  assert.ok(refreshIndex > middleware.indexOf("env.SESSIONS.get"));
  assert.ok(refreshIndex > middleware.indexOf("sessionVersion !== expectedSessionVersion"));
  assert.doesNotMatch(middleware, /SESSIONS\.put/);
  assert.match(loginSession, /expirationTtl: lifetime\.storageTtlSeconds/);
  assert.match(middleware, /\["token", refreshedToken\], \["sessionId", sessionId\]/);
});

test("logout production route retains only service and cryptographic wiring", () => {
  assert.match(logoutRoute, /createLogoutPostHandler/);
  assert.match(logoutRoute, /logoutSession/);
  assert.match(logoutRoute, /jwtVerify\([\s\S]*?clockTolerance: 60/);
  assert.match(logoutRoute, /error instanceof joseErrors\.JOSEError/);
  assert.match(logoutRoute, /persistence: createLogoutPersistence\(env\)/);
  assert.doesNotMatch(
    logoutRoute,
    /env\.DB\.prepare|env\.SESSIONS\.(?:get|delete)|REVOKE_USER_SESSIONS_SQL/,
  );
});

test("logout handler owns origin, cookie, and pending-revocation response policy", () => {
  const originGuardIndex = logoutHandler.indexOf("isTrustedMutationOrigin(request)");
  const delegationIndex = logoutHandler.indexOf("dependencies.logout(");
  const responseIndex = logoutHandler.indexOf(
    "return createLogoutResponse(request, result.revocationPending)",
  );
  const responseHelper = logoutHandler.slice(
    logoutHandler.indexOf("function createLogoutResponse"),
  );
  assert.ok(originGuardIndex >= 0 && originGuardIndex < delegationIndex);
  assert.match(
    logoutHandler,
    /parseLogoutAuthCookies\(\s*request\.headers\.get\("cookie"\),\s*\)/,
  );
  assert.doesNotMatch(logoutHandler, /split\("; "\)/);
  assert.match(logoutHandler, /for \(const name of \["token", "sessionId"\] as const\)/);
  assert.match(logoutHandler, /response\.cookies\.set\([\s\S]*?maxAge: 0/);
  assert.doesNotMatch(
    logoutHandler,
    /createLogoutPersistence|jwtVerify|joseErrors|env\.DB\.prepare|env\.SESSIONS\.(?:get|delete)|REVOKE_USER_SESSIONS_SQL/,
  );
  assert.ok(delegationIndex < responseIndex);
  assert.match(logoutHandler, /code: "SESSION_REVOCATION_PENDING"/);
  assert.match(logoutHandler, /revocationPending: true/);
  assert.match(logoutHandler, /\{ status: 503 \}/);
  assert.match(logoutHandler, /createLogoutResponse\(request, result\.revocationPending\)/);
  assert.match(logoutHandler, /createLogoutResponse\(request, true\)/);
  assert.match(
    responseHelper,
    /if \(revocationPending\) \{\s*return NextResponse\.json\([\s\S]*?\{ status: 503 \},\s*\);\s*\}\s*const response/,
  );
  assert.ok(
    responseHelper.indexOf("if (revocationPending)") <
      responseHelper.indexOf("response.cookies.set"),
  );
  assert.match(
    logoutHandler,
    /catch \(error\) \{\s*try \{\s*await reportError\("auth\.logout"/,
  );
});

test("logout service and persistence own revocation and cleanup", () => {
  assert.match(logoutService, /resolveLogoutSessionBinding/);
  assert.match(logoutService, /retrySessionRevocation/);
  assert.match(logoutService, /if \(!revocationPending && input\.sessionId\)/);
  assert.match(logoutPersistence, /REVOKE_USER_SESSIONS_SQL/);
  assert.match(logoutPersistence, /env\.DB\.prepare\(REVOKE_USER_SESSIONS_SQL\)/);
  assert.match(logoutPersistence, /env\.SESSIONS\.get/);
  assert.match(logoutPersistence, /env\.SESSIONS\.delete/);
  assert.match(venuesApi, /activeChanged/);
  assert.match(venuesApi, /sessionVersion: sql`\$\{users\.sessionVersion\} \+ 1`/);
  assert.match(venuesApi, /await db\.batch\(/);
});

test("client logout preserves local state on failure", () => {
  const resultCheckIndex = client.indexOf("if (!response.ok || resultBody?.ok !== true)");
  const cacheClearIndex = client.indexOf("cacheUser(null)");
  assert.match(client, /export type LogoutResult =/);
  assert.ok(resultCheckIndex >= 0 && resultCheckIndex < cacheClearIndex);
  assert.match(client, /code: "LOGOUT_NETWORK_ERROR"/);
  assert.match(client, /window\.location\.href = "\/auth\/login"/);
});

test("client auth mismatch defers final routing to authoritative middleware", () => {
  assert.doesNotMatch(authGuard, /router\.replace\("\/"\)/);
  assert.doesNotMatch(authGuard, /router\.replace\("\/auth\/login"\)/);
  assert.match(authGuard, /recoveryGate\.shouldRefresh\(isAllowed\)/);
  assert.match(authGuard, /router\.refresh\(\)/);
});
