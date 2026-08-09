import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartFirstLoginSetup,
  getFirstLoginSetupMethod,
  isFirstLoginSetupMethod,
} from "./first-login-policy.ts";

test("이관 대기 계정도 관리자 설정 코드를 요구한다", () => {
  const method = getFirstLoginSetupMethod({
    migrationStatus: "pending_reset",
    passwordSetAt: null,
  });

  assert.equal(method, "setup_code");
  assert.equal(canStartFirstLoginSetup(method, false), false);
  assert.equal(canStartFirstLoginSetup(method, true), true);
});

test("관리자 생성·재설정 계정은 올바른 설정 코드가 있어야 한다", () => {
  const method = getFirstLoginSetupMethod({
    migrationStatus: "pending_reset",
    passwordSetAt: null,
  });

  assert.equal(method, "setup_code");
  assert.equal(canStartFirstLoginSetup(method, false), false);
  assert.equal(canStartFirstLoginSetup(method, true), true);
});

test("유효한 관리자 승인이 있는 대기 계정은 설정 코드 없이 시작한다", () => {
  const method = getFirstLoginSetupMethod({
    migrationStatus: "pending_reset",
    passwordSetAt: null,
    adminApprovedReset: true,
  });

  assert.equal(method, "admin_approved");
  assert.equal(canStartFirstLoginSetup(method, false), true);
});

test("설정이 끝났거나 대기 상태가 아닌 계정은 최초 로그인 대상이 아니다", () => {
  assert.equal(
    getFirstLoginSetupMethod({
      migrationStatus: "active",
      passwordSetAt: null,
    }),
    null,
  );
  assert.equal(
    getFirstLoginSetupMethod({
      migrationStatus: "pending_reset",
      passwordSetAt: "2026-08-07T01:00:00.000Z",
    }),
    null,
  );
});

test("클라이언트에는 알려진 최초 로그인 방식만 전달한다", () => {
  assert.equal(isFirstLoginSetupMethod("migration"), false);
  assert.equal(isFirstLoginSetupMethod("setup_code"), true);
  assert.equal(isFirstLoginSetupMethod("admin_approved"), true);
  assert.equal(isFirstLoginSetupMethod("unknown"), false);
  assert.equal(isFirstLoginSetupMethod(null), false);
});
