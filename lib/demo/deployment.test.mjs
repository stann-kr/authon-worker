import assert from "node:assert/strict";
import test from "node:test";

import {
  getDemoRouteDisposition,
  isAllowedDemoHostname,
  isDemoDeployment,
} from "./deployment.ts";

test("only the explicit demo deployment mode activates the boundary", () => {
  assert.equal(isDemoDeployment("demo"), true);
  assert.equal(isDemoDeployment("production"), false);
  assert.equal(isDemoDeployment(undefined), false);
});

test("the custom domain, workers.dev, and local preview hosts are allowed", () => {
  assert.equal(isAllowedDemoHostname("demo.authon.stann.kr"), true);
  assert.equal(isAllowedDemoHostname("authon-demo.example.workers.dev"), true);
  assert.equal(isAllowedDemoHostname("localhost"), true);
  assert.equal(isAllowedDemoHostname("preview.localhost"), true);
  assert.equal(isAllowedDemoHostname("guest.faustseoul.kr"), false);
});

test("the demo root redirects and only sandbox routes are allowed", () => {
  const hostname = "demo.authon.stann.kr";
  assert.equal(getDemoRouteDisposition("/", hostname), "redirect_to_demo");
  assert.equal(getDemoRouteDisposition("/demo", hostname), "allow");
  assert.equal(getDemoRouteDisposition("/demo/example", hostname), "allow");
  assert.equal(getDemoRouteDisposition("/api/locale", hostname), "allow");
});

test("production pages and APIs are hidden on the demo deployment", () => {
  const hostname = "demo.authon.stann.kr";
  for (const pathname of [
    "/auth/login",
    "/admin",
    "/door",
    "/guest",
    "/profile",
    "/api/auth/login",
    "/api/auth/reset-password",
    "/api/admin/migrate",
    "/api/internal/sync-guest",
    "/api/profile/password",
  ]) {
    assert.equal(getDemoRouteDisposition(pathname, hostname), "not_found", pathname);
  }
});

test("an unexpected hostname cannot use the demo Worker routes", () => {
  assert.equal(
    getDemoRouteDisposition("/demo", "guest.faustseoul.kr"),
    "not_found",
  );
});
