export const PASSWORD_RESET_RECEIPT_COOKIE_NAME =
  "authon-password-reset-receipt";
export const PASSWORD_RESET_RECEIPT_MAX_AGE_SECONDS = 24 * 60 * 60;
export const PASSWORD_RESET_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

const RECEIPT_SIGNATURE_PURPOSE = "authon:password-reset-receipt:v1";
const RECEIPT_SIGNATURE_PURPOSE_V2 = "authon:password-reset-receipt:v2";
const RECEIPT_CANDIDATE_PURPOSE = "authon:password-reset-candidate:v2";
const RECEIPT_CHALLENGE_PURPOSE = "authon:password-reset-challenge:v1";
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHALLENGE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface PasswordResetReceiptCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  maxAge: number;
  path: "/";
}

export interface PasswordResetReceiptStatusRecord {
  venueId: string | null;
  userRole: string;
  status: string;
  setupMethod: string | null;
  expiresAt: string | null;
}

export interface PasswordResetReceiptTenant {
  resolved: boolean;
  scope: "platform" | "venue";
  venueId: string | null;
}

export type PasswordResetReceiptState =
  | { state: "waiting"; expiresAt: null }
  | { state: "approved"; expiresAt: string };

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

  try {
    const paddingLength = (4 - (value.length % 4)) % 4;
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(paddingLength);
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("Password reset receipt signing secret is not configured");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function purposeMessage(purpose: string, value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${purpose}:${value}`) as Uint8Array<ArrayBuffer>;
}

async function signPurpose(
  purpose: string,
  value: string,
  secret: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    purposeMessage(purpose, value),
  );
  return new Uint8Array(signature) as Uint8Array<ArrayBuffer>;
}

async function verifyPurpose(
  purpose: string,
  value: string,
  signature: Uint8Array<ArrayBuffer>,
  secret: string,
): Promise<boolean> {
  const key = await importHmacKey(secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    purposeMessage(purpose, value),
  );
}

function normalizeReceiptCandidate(candidate: string): string {
  return candidate.trim().toLowerCase();
}

function candidateBindingValue(requestId: string, candidate: string): string {
  const normalizedCandidate = normalizeReceiptCandidate(candidate);
  return `${requestId}:${normalizedCandidate.length}:${normalizedCandidate}`;
}

interface VerifiedPasswordResetReceipt {
  requestId: string;
  candidateTag: Uint8Array<ArrayBuffer> | null;
}

async function verifyPasswordResetReceiptPayload(
  receipt: string | null | undefined,
  secret: string,
): Promise<VerifiedPasswordResetReceipt | null> {
  if (!receipt || receipt.length > 160) return null;
  const parts = receipt.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;

  const [requestId] = parts;
  if (!REQUEST_ID_PATTERN.test(requestId)) return null;

  if (parts.length === 2) {
    const signature = decodeBase64Url(parts[1]);
    if (!signature || signature.byteLength !== 32) return null;
    const valid = await verifyPurpose(
      RECEIPT_SIGNATURE_PURPOSE,
      requestId,
      signature,
      secret,
    );
    return valid ? { requestId, candidateTag: null } : null;
  }

  const encodedCandidateTag = parts[1];
  const candidateTag = decodeBase64Url(encodedCandidateTag);
  const signature = decodeBase64Url(parts[2]);
  if (
    !candidateTag ||
    candidateTag.byteLength !== 32 ||
    !signature ||
    signature.byteLength !== 32
  ) {
    return null;
  }

  const valid = await verifyPurpose(
    RECEIPT_SIGNATURE_PURPOSE_V2,
    `${requestId}:${encodedCandidateTag}`,
    signature,
    secret,
  );
  return valid ? { requestId, candidateTag } : null;
}

export async function createPasswordResetReceipt(
  requestId: string,
  secret: string,
  candidate: string,
): Promise<string> {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error("Password reset receipt request id is invalid");
  }
  if (typeof candidate !== "string" || !normalizeReceiptCandidate(candidate)) {
    throw new Error("Password reset receipt candidate is invalid");
  }

  const candidateTag = await signPurpose(
    RECEIPT_CANDIDATE_PURPOSE,
    candidateBindingValue(requestId, candidate),
    secret,
  );
  const encodedCandidateTag = encodeBase64Url(candidateTag);
  const signature = await signPurpose(
    RECEIPT_SIGNATURE_PURPOSE_V2,
    `${requestId}:${encodedCandidateTag}`,
    secret,
  );
  return `${requestId}.${encodedCandidateTag}.${encodeBase64Url(signature)}`;
}

export async function verifyPasswordResetReceipt(
  receipt: string | null | undefined,
  secret: string,
): Promise<string | null> {
  const verified = await verifyPasswordResetReceiptPayload(receipt, secret);
  return verified?.requestId ?? null;
}

export async function verifyPasswordResetReceiptForCandidate(
  receipt: string | null | undefined,
  candidate: string,
  secret: string,
): Promise<string | null> {
  if (typeof candidate !== "string" || !normalizeReceiptCandidate(candidate)) {
    return null;
  }

  const verified = await verifyPasswordResetReceiptPayload(receipt, secret);
  if (!verified?.candidateTag) return null;
  const candidateMatches = await verifyPurpose(
    RECEIPT_CANDIDATE_PURPOSE,
    candidateBindingValue(verified.requestId, candidate),
    verified.candidateTag,
    secret,
  );
  return candidateMatches ? verified.requestId : null;
}

export async function derivePasswordResetChallenge(
  requestId: string,
  secret: string,
): Promise<string> {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error("Password reset challenge request id is invalid");
  }

  const digest = await signPurpose(
    RECEIPT_CHALLENGE_PURPOSE,
    requestId,
    secret,
  );
  const value = Array.from(
    digest.slice(0, 8),
    (byte) => CHALLENGE_ALPHABET[byte & 31],
  ).join("");
  return `REQ-${value.slice(0, 4)}-${value.slice(4)}`;
}

export async function verifyPasswordResetChallenge(
  requestId: string,
  candidate: unknown,
  secret: string,
): Promise<boolean> {
  if (
    !REQUEST_ID_PATTERN.test(requestId) ||
    typeof candidate !== "string"
  ) {
    return false;
  }

  const normalizedCandidate = candidate.trim().toUpperCase();
  if (!/^REQ-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(normalizedCandidate)) {
    return false;
  }

  const expected = await derivePasswordResetChallenge(requestId, secret);
  let difference = normalizedCandidate.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |=
      (normalizedCandidate.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export function getPasswordResetRequestExpiry(nowMs = Date.now()): string {
  return new Date(nowMs + PASSWORD_RESET_REQUEST_TTL_MS).toISOString();
}

export function getPasswordResetReceiptCookieOptions(
  secure: boolean,
): PasswordResetReceiptCookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict",
    maxAge: PASSWORD_RESET_RECEIPT_MAX_AGE_SECONDS,
    path: "/",
  };
}

export function readPasswordResetReceiptCookie(
  headers: Pick<Headers, "get">,
): string | null {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(";")) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex < 0) continue;
    const name = entry.slice(0, separatorIndex).trim();
    if (name !== PASSWORD_RESET_RECEIPT_COOKIE_NAME) continue;
    const value = entry.slice(separatorIndex + 1).trim();
    return value || null;
  }

  return null;
}

export async function getPasswordResetReceiptRequestId(
  headers: Pick<Headers, "get">,
  secret: string,
): Promise<string | null> {
  return verifyPasswordResetReceipt(
    readPasswordResetReceiptCookie(headers),
    secret,
  );
}

export async function getPasswordResetReceiptRequestIdForCandidate(
  headers: Pick<Headers, "get">,
  candidate: string,
  secret: string,
): Promise<string | null> {
  return verifyPasswordResetReceiptForCandidate(
    readPasswordResetReceiptCookie(headers),
    candidate,
    secret,
  );
}

export function getPasswordResetReceiptState(
  record: PasswordResetReceiptStatusRecord | null | undefined,
  tenant: PasswordResetReceiptTenant,
  nowMs = Date.now(),
): PasswordResetReceiptState {
  if (!record || !tenant.resolved) return { state: "waiting", expiresAt: null };

  const tenantMatches =
    tenant.scope === "platform" ||
    record.userRole === "super_admin" ||
    (Boolean(tenant.venueId) && record.venueId === tenant.venueId);
  const expiresAtMs = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;

  if (
    !tenantMatches ||
    record.status !== "approved" ||
    record.setupMethod !== "admin_approved" ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= nowMs
  ) {
    return { state: "waiting", expiresAt: null };
  }

  return { state: "approved", expiresAt: record.expiresAt! };
}
