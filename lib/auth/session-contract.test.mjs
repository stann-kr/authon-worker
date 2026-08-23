import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  client,
  authGuard,
  homePage,
  loginPage,
  resetPasswordPage,
  setupPasswordPage,
  loginRoute,
    middleware,
    logoutRoute,
    logoutService,
    logoutPersistence,
    venuesApi,
] =
  await Promise.all([
    readFile(new URL("../auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../../components/AuthGuard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/auth/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/auth/reset-password/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/auth/setup-password/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../middleware.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
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
  assert.match(loginRoute, /createLoginSessionLifetime\(keepSignedIn === true\)/);
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
    koMessages.ResetPassword.adminFlowDescription,
    /관리자가 먼저 연락한 경우에만/,
  );
  assert.match(
    enMessages.ResetPassword.adminFlowDescription,
    /only after an administrator contacts you/,
  );
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
  const delegationIndex = logoutRoute.indexOf("logoutSession(");
  const responseIndex = logoutRoute.indexOf(
    "return createLogoutResponse(request, result.revocationPending)",
  );
  const responseHelper = logoutRoute.slice(
    logoutRoute.indexOf("function createLogoutResponse"),
  );
  assert.ok(originGuardIndex >= 0 && originGuardIndex < delegationIndex);
  assert.match(
    logoutRoute,
    /parseLogoutAuthCookies\(\s*request\.headers\.get\("cookie"\),\s*\)/,
  );
  assert.doesNotMatch(logoutRoute, /split\("; "\)/);
  assert.match(logoutRoute, /for \(const name of \["token", "sessionId"\] as const\)/);
  assert.match(logoutRoute, /response\.cookies\.set\([\s\S]*?maxAge: 0/);
  assert.match(logoutRoute, /jwtVerify\([\s\S]*?clockTolerance: 60/);
  assert.match(logoutRoute, /error instanceof joseErrors\.JOSEError/);
  assert.match(logoutRoute, /persistence: createLogoutPersistence\(env\)/);
  assert.doesNotMatch(
    logoutRoute,
    /env\.DB\.prepare|env\.SESSIONS\.(?:get|delete)|REVOKE_USER_SESSIONS_SQL/,
  );
  assert.match(logoutService, /resolveLogoutSessionBinding/);
  assert.match(logoutService, /retrySessionRevocation/);
  assert.match(logoutService, /if \(!revocationPending && input\.sessionId\)/);
  assert.match(logoutPersistence, /REVOKE_USER_SESSIONS_SQL/);
  assert.match(logoutPersistence, /env\.DB\.prepare\(REVOKE_USER_SESSIONS_SQL\)/);
  assert.match(logoutPersistence, /env\.SESSIONS\.get/);
  assert.match(logoutPersistence, /env\.SESSIONS\.delete/);
  assert.ok(delegationIndex < responseIndex);
  assert.match(logoutRoute, /code: "SESSION_REVOCATION_PENDING"/);
  assert.match(logoutRoute, /revocationPending: true/);
  assert.match(logoutRoute, /\{ status: 503 \}/);
  assert.match(logoutRoute, /createLogoutResponse\(request, result\.revocationPending\)/);
  assert.match(logoutRoute, /createLogoutResponse\(request, true\)/);
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
    /catch \(error\) \{\s*try \{\s*await reportServerError\("auth\.logout"/,
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

test("client auth mismatch defers final routing to authoritative middleware", () => {
  assert.doesNotMatch(authGuard, /router\.replace\("\/"\)/);
  assert.doesNotMatch(authGuard, /router\.replace\("\/auth\/login"\)/);
  assert.match(authGuard, /recoveryGate\.shouldRefresh\(isAllowed\)/);
  assert.match(authGuard, /router\.refresh\(\)/);
});
