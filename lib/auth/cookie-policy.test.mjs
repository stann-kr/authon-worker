import assert from "node:assert/strict";
import test from "node:test";
import { shouldUseSecureAuthCookies } from "./cookie-policy.ts";

test("로컬 HTTP에서는 인증 쿠키를 Secure로 표시하지 않는다", () => {
  assert.equal(
    shouldUseSecureAuthCookies(
      { url: "http://127.0.0.1:3000/api/auth/login" },
      "development",
    ),
    false,
  );
  assert.equal(
    shouldUseSecureAuthCookies(
      { url: "http://faust.localhost:3000/api/auth/login" },
      "development",
    ),
    false,
  );
  assert.equal(
    shouldUseSecureAuthCookies(
      { url: "http://[::1]:3000/api/auth/login" },
      "development",
    ),
    false,
  );
  assert.equal(
    shouldUseSecureAuthCookies({
      url: "http://0.0.0.0:3000/api/auth/login",
      headers: new Headers({ host: "127.0.0.1:3000" }),
    }, "development"),
    false,
  );
});

test("개발 환경에서도 HTTPS와 외부 Host는 Secure 처리한다", () => {
  assert.equal(
    shouldUseSecureAuthCookies(
      { url: "https://auth.example.com/api/auth/login" },
      "development",
    ),
    true,
  );
  assert.equal(
    shouldUseSecureAuthCookies(
      { url: "http://auth.example.com/api/auth/login" },
      "development",
    ),
    true,
  );
  assert.equal(
    shouldUseSecureAuthCookies({
      url: "http://127.0.0.1:3000/api/auth/login",
      headers: new Headers({ host: "auth.example.com" }),
    }, "development"),
    true,
  );
});

test("production에서는 로컬 주소도 항상 Secure 처리한다", () => {
  assert.equal(
    shouldUseSecureAuthCookies(
      { url: "http://127.0.0.1:3000/api/auth/login" },
      "production",
    ),
    true,
  );
});
