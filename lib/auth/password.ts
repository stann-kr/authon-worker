import bcrypt from "bcryptjs";

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

/** PBKDF2-SHA-256 형식: "pbkdf2$<iter>$<saltB64>$<hashB64>" */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const hashBuffer = await deriveKey(plain, salt, ITERATIONS);
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
  return `pbkdf2$${ITERATIONS}$${saltB64}$${hashB64}`;
}

/** pbkdf2$ 포맷이면 WebCrypto로, 그 외(bcrypt)는 bcryptjs로 검증 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return false;
    const [, iterStr, saltB64, hashB64] = parts;
    const iterations = parseInt(iterStr, 10);
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
    const expectedHash = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));
    const actualBuffer = await deriveKey(plain, salt, iterations);
    const actualHash = new Uint8Array(actualBuffer);
    if (actualHash.length !== expectedHash.length) return false;
    // constant-time 비교
    let diff = 0;
    for (let i = 0; i < actualHash.length; i++) diff |= actualHash[i] ^ expectedHash[i];
    return diff === 0;
  }
  // 기존 bcrypt 해시 호환
  return bcrypt.compare(plain, stored);
}

/** bcrypt 포맷이면 true → 로그인 후 재해시 필요 */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith("pbkdf2$");
}

async function deriveKey(
  plain: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    KEY_LENGTH * 8,
  );
}
