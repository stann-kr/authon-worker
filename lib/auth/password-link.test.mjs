import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_INVITATION_TTL_MS,
  PASSWORD_RESET_LINK_TTL_MS,
  buildPasswordLinkUrl,
  getPasswordLinkExpiry,
} from "./password-link.ts";
import {
  extractResetTokenFromUrl,
  generateResetToken,
  isResetToken,
} from "./token.ts";

const TOKEN = "A".repeat(43);

test("계정 초대는 24시간, 비밀번호 재설정 링크는 1시간 뒤 만료된다", () => {
  const nowMs = Date.parse("2026-08-15T00:00:00.000Z");
  assert.equal(ACCOUNT_INVITATION_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(PASSWORD_RESET_LINK_TTL_MS, 60 * 60 * 1000);
  assert.equal(
    getPasswordLinkExpiry("account_invitation", nowMs),
    "2026-08-16T00:00:00.000Z",
  );
  assert.equal(
    getPasswordLinkExpiry("password_reset", nowMs),
    "2026-08-15T01:00:00.000Z",
  );
});

test("일회용 password token은 query가 아닌 fragment에만 둔다", () => {
  const passwordUrl = buildPasswordLinkUrl({
    baseUrl: "https://venue.example.com/base",
    token: TOKEN,
    locale: "ko",
  });
  const parsed = new URL(passwordUrl);

  assert.equal(parsed.origin, "https://venue.example.com");
  assert.equal(parsed.pathname, "/auth/reset-password");
  assert.equal(parsed.searchParams.get("lang"), "ko");
  assert.equal(parsed.searchParams.has("token"), false);
  assert.equal(new URLSearchParams(parsed.hash.slice(1)).get("token"), TOKEN);
});

test("password URL은 fragment와 legacy query token을 추출한 뒤 주소에서 제거한다", () => {
  for (const rawUrl of [
    `https://venue.example.com/auth/reset-password?lang=en#token=${TOKEN}`,
    `https://venue.example.com/auth/reset-password?token=${TOKEN}&lang=ko`,
  ]) {
    const result = extractResetTokenFromUrl(rawUrl);
    assert.equal(result.token, TOKEN);
    assert.equal(result.hadToken, true);
    assert.equal(result.sanitizedPath.includes("token"), false);
    assert.equal(result.sanitizedPath.startsWith("/auth/reset-password?lang="), true);
  }
});

test("서로 다른 query와 fragment token 또는 잘못된 token은 거부한다", () => {
  const conflict = extractResetTokenFromUrl(
    `https://venue.example.com/auth/reset-password?token=${TOKEN}#token=${"B".repeat(43)}`,
  );
  assert.equal(conflict.hadToken, true);
  assert.equal(conflict.token, null);
  assert.equal(conflict.sanitizedPath, "/auth/reset-password");

  assert.equal(isResetToken("short"), false);
  assert.throws(
    () =>
      buildPasswordLinkUrl({
        baseUrl: "https://venue.example.com",
        token: "short",
        locale: "en",
      }),
    /invalid/,
  );
});

test("reset token 생성기는 256-bit base64url token을 만든다", () => {
  const token = generateResetToken();
  assert.equal(isResetToken(token), true);
  assert.equal(token.length, 43);
});
