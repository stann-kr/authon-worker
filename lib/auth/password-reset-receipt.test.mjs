import assert from "node:assert/strict";
import test from "node:test";

import {
  PASSWORD_RESET_RECEIPT_COOKIE_NAME,
  PASSWORD_RESET_RECEIPT_MAX_AGE_SECONDS,
  PASSWORD_RESET_REQUEST_TTL_MS,
  createPasswordResetReceipt,
  derivePasswordResetChallenge,
  getPasswordResetReceiptCookieOptions,
  getPasswordResetReceiptRequestId,
  getPasswordResetReceiptRequestIdForCandidate,
  getPasswordResetReceiptState,
  getPasswordResetRequestExpiry,
  readPasswordResetReceiptCookie,
  verifyPasswordResetReceipt,
  verifyPasswordResetChallenge,
  verifyPasswordResetReceiptForCandidate,
} from "./password-reset-receipt.ts";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";
const SECRET = "test-only-password-reset-receipt-secret";
const CANDIDATE = "person@example.com";
const NOW_MS = Date.parse("2026-08-09T06:00:00.000Z");

async function createLegacyReceipt(requestId, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`authon:password-reset-receipt:v1:${requestId}`),
  );
  return `${requestId}.${Buffer.from(signature).toString("base64url")}`;
}

test("receipt는 request id와 candidate를 purpose-separated HMAC으로 서명하고 검증한다", async () => {
  const receipt = await createPasswordResetReceipt(REQUEST_ID, SECRET, CANDIDATE);

  assert.match(
    receipt,
    new RegExp(`^${REQUEST_ID}\\.[A-Za-z0-9_-]{43}\\.[A-Za-z0-9_-]{43}$`),
  );
  assert.equal(
    await verifyPasswordResetReceipt(receipt, SECRET),
    REQUEST_ID,
  );
  assert.equal(
    await createPasswordResetReceipt(REQUEST_ID, SECRET, CANDIDATE),
    receipt,
  );
  assert.equal(receipt.includes(CANDIDATE), false);
});

test("receipt 위조, 다른 key, malformed 값은 검증하지 않는다", async () => {
  const receipt = await createPasswordResetReceipt(REQUEST_ID, SECRET, CANDIDATE);
  const [, candidateTag, signature] = receipt.split(".");
  const replacement = signature.endsWith("A") ? "B" : "A";
  const tampered = `${REQUEST_ID}.${candidateTag}.${signature.slice(0, -1)}${replacement}`;
  const swappedRequest = `${OTHER_REQUEST_ID}.${candidateTag}.${signature}`;
  const tagReplacement = candidateTag.endsWith("A") ? "B" : "A";
  const tamperedTag = `${REQUEST_ID}.${candidateTag.slice(0, -1)}${tagReplacement}.${signature}`;

  assert.equal(await verifyPasswordResetReceipt(tampered, SECRET), null);
  assert.equal(await verifyPasswordResetReceipt(swappedRequest, SECRET), null);
  assert.equal(await verifyPasswordResetReceipt(tamperedTag, SECRET), null);
  assert.equal(await verifyPasswordResetReceipt(receipt, `${SECRET}-other`), null);
  for (const malformed of [null, "", "not-a-receipt", `${REQUEST_ID}.***`, "x".repeat(161)]) {
    assert.equal(await verifyPasswordResetReceipt(malformed, SECRET), null);
  }
});

test("같은 candidate retry만 receipt request id를 재사용한다", async () => {
  const receipt = await createPasswordResetReceipt(REQUEST_ID, SECRET, CANDIDATE);

  const sameCandidateRequestId = await verifyPasswordResetReceiptForCandidate(
    receipt,
    "  PERSON@example.COM  ",
    SECRET,
  );
  assert.equal(sameCandidateRequestId, REQUEST_ID);
  assert.equal(
    await createPasswordResetReceipt(
      sameCandidateRequestId,
      SECRET,
      CANDIDATE,
    ),
    receipt,
  );
  assert.equal(
    await derivePasswordResetChallenge(sameCandidateRequestId, SECRET),
    await derivePasswordResetChallenge(REQUEST_ID, SECRET),
  );

  assert.equal(
    await verifyPasswordResetReceiptForCandidate(
      receipt,
      "different@example.com",
      SECRET,
    ),
    null,
  );
  assert.notEqual(
    await derivePasswordResetChallenge(OTHER_REQUEST_ID, SECRET),
    await derivePasswordResetChallenge(REQUEST_ID, SECRET),
  );
  assert.equal(
    await verifyPasswordResetReceiptForCandidate(receipt, CANDIDATE, `${SECRET}-other`),
    null,
  );
});

test("legacy receipt는 claim/status 검증만 유지하고 candidate retry에는 재사용하지 않는다", async () => {
  const legacyReceipt = await createLegacyReceipt(REQUEST_ID, SECRET);

  assert.equal(
    await verifyPasswordResetReceipt(legacyReceipt, SECRET),
    REQUEST_ID,
  );
  assert.equal(
    await verifyPasswordResetReceiptForCandidate(
      legacyReceipt,
      CANDIDATE,
      SECRET,
    ),
    null,
  );
});

test("challenge는 별도 HMAC purpose로 안정적인 비밀 비노출 형식을 만든다", async () => {
  const challenge = await derivePasswordResetChallenge(REQUEST_ID, SECRET);
  const otherChallenge = await derivePasswordResetChallenge(
    OTHER_REQUEST_ID,
    SECRET,
  );
  const receipt = await createPasswordResetReceipt(REQUEST_ID, SECRET, CANDIDATE);

  assert.match(challenge, /^REQ-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(
    await derivePasswordResetChallenge(REQUEST_ID, SECRET),
    challenge,
  );
  assert.notEqual(challenge, otherChallenge);
  assert.equal(receipt.includes(challenge.replaceAll("-", "")), false);
  assert.equal(
    await verifyPasswordResetChallenge(
      REQUEST_ID,
      `  ${challenge.toLowerCase()}  `,
      SECRET,
    ),
    true,
  );
  assert.equal(
    await verifyPasswordResetChallenge(REQUEST_ID, otherChallenge, SECRET),
    false,
  );
  assert.equal(
    await verifyPasswordResetChallenge(OTHER_REQUEST_ID, challenge, SECRET),
    false,
  );
  assert.equal(
    await verifyPasswordResetChallenge(REQUEST_ID, "REQ-OOOO-1111", SECRET),
    false,
  );
});

test("pending request와 receipt cookie는 24시간 수명을 사용한다", () => {
  assert.equal(PASSWORD_RESET_REQUEST_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(PASSWORD_RESET_RECEIPT_MAX_AGE_SECONDS, 24 * 60 * 60);
  assert.equal(
    getPasswordResetRequestExpiry(NOW_MS),
    "2026-08-10T06:00:00.000Z",
  );
});

test("receipt cookie는 host 정책에 맞춘 Secure와 엄격한 browser 경계를 사용한다", () => {
  const production = getPasswordResetReceiptCookieOptions(true);
  assert.deepEqual(production, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 24 * 60 * 60,
    path: "/",
  });

  const local = getPasswordResetReceiptCookieOptions(false);
  assert.equal(local.secure, false);
});

test("cookie parser는 exact receipt cookie만 읽는다", () => {
  const headers = new Headers({
    cookie: `other=one; ${PASSWORD_RESET_RECEIPT_COOKIE_NAME}=signed.value; trailing=two`,
  });
  assert.equal(readPasswordResetReceiptCookie(headers), "signed.value");
  assert.equal(
    readPasswordResetReceiptCookie(
      new Headers({ cookie: `${PASSWORD_RESET_RECEIPT_COOKIE_NAME}-other=value` }),
    ),
    null,
  );
  assert.equal(readPasswordResetReceiptCookie(new Headers()), null);
});

test("cookie header에서 검증된 exact request id만 복구한다", async () => {
  const receipt = await createPasswordResetReceipt(REQUEST_ID, SECRET, CANDIDATE);
  const headers = new Headers({
    cookie: `${PASSWORD_RESET_RECEIPT_COOKIE_NAME}=${receipt}`,
  });

  assert.equal(
    await getPasswordResetReceiptRequestId(headers, SECRET),
    REQUEST_ID,
  );
  assert.equal(
    await getPasswordResetReceiptRequestId(headers, `${SECRET}-other`),
    null,
  );
  assert.equal(
    await getPasswordResetReceiptRequestId(new Headers(), SECRET),
    null,
  );
  assert.equal(
    await getPasswordResetReceiptRequestIdForCandidate(
      headers,
      CANDIDATE,
      SECRET,
    ),
    REQUEST_ID,
  );
  assert.equal(
    await getPasswordResetReceiptRequestIdForCandidate(
      headers,
      "different@example.com",
      SECRET,
    ),
    null,
  );
});

test("exact tenant의 미만료 direct 승인만 approved로 공개한다", () => {
  const expiresAt = "2026-08-09T06:15:00.000Z";
  const record = {
    venueId: "venue-a",
    userRole: "staff",
    status: "approved",
    setupMethod: "admin_approved",
    expiresAt,
  };
  const venueTenant = {
    resolved: true,
    scope: "venue",
    venueId: "venue-a",
  };

  assert.deepEqual(
    getPasswordResetReceiptState(record, venueTenant, NOW_MS),
    { state: "approved", expiresAt },
  );
  assert.deepEqual(
    getPasswordResetReceiptState(
      { ...record, userRole: "super_admin", venueId: null },
      venueTenant,
      NOW_MS,
    ),
    { state: "approved", expiresAt },
  );
});

test("receipt 부재, decoy, tenant 불일치, 비승인 및 만료 상태는 모두 waiting이다", () => {
  const expiresAt = "2026-08-09T06:15:00.000Z";
  const record = {
    venueId: "venue-a",
    userRole: "staff",
    status: "approved",
    setupMethod: "admin_approved",
    expiresAt,
  };
  const tenant = {
    resolved: true,
    scope: "venue",
    venueId: "venue-a",
  };
  const waiting = { state: "waiting", expiresAt: null };

  assert.deepEqual(getPasswordResetReceiptState(null, tenant, NOW_MS), waiting);
  assert.deepEqual(
    getPasswordResetReceiptState(record, { ...tenant, venueId: "venue-b" }, NOW_MS),
    waiting,
  );
  assert.deepEqual(
    getPasswordResetReceiptState({ ...record, status: "pending" }, tenant, NOW_MS),
    waiting,
  );
  assert.deepEqual(
    getPasswordResetReceiptState({ ...record, setupMethod: "setup_code" }, tenant, NOW_MS),
    waiting,
  );
  assert.deepEqual(
    getPasswordResetReceiptState(record, tenant, Date.parse(expiresAt)),
    waiting,
  );
  assert.deepEqual(
    getPasswordResetReceiptState(record, { ...tenant, resolved: false }, NOW_MS),
    waiting,
  );
});
