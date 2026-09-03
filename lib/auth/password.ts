import bcrypt from "bcryptjs";

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const PBKDF2_PASSWORD_HASH_PATTERN =
  /^pbkdf2\$100000\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/;
const BCRYPT_COST_10_PASSWORD_HASH_PATTERN =
  /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/;

export const DUMMY_PBKDF2_PASSWORD_HASH =
  "pbkdf2$100000$Yud1PnfAdnmks4HLqvBwVQ==$bgkDnZqJEDZaY7gsi+3OYHDi0Px87/E9QAWdGgOgXtI=";
export const DUMMY_PASSWORD_HASH = DUMMY_PBKDF2_PASSWORD_HASH;
export const DUMMY_BCRYPT_PASSWORD_HASH =
  "$2a$10$ZqOvmOl4eVCHtJTwEosCxu9OM.079j7qKOsCmJSvJB/Hk4c7wO4a2";

export type PasswordVerifier = (
  plain: string,
  stored: string,
) => Promise<boolean>;

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

/**
 * 계정 존재 여부와 저장 hash 포맷에 관계없이 PBKDF2와 bcrypt cost를 모두
 * 지불한다. 실제 credential이 없는 경우에는 두 결과를 모두 폐기한다.
 */
export async function verifyPasswordWithDummies(
  plain: string,
  stored: string | null | undefined,
  verifier: PasswordVerifier = verifyPassword,
): Promise<boolean> {
  const storedHash = typeof stored === "string" ? stored : null;
  const usesPbkdf2 =
    storedHash !== null && PBKDF2_PASSWORD_HASH_PATTERN.test(storedHash);
  const usesBcrypt =
    storedHash !== null && BCRYPT_COST_10_PASSWORD_HASH_PATTERN.test(storedHash);
  const [pbkdf2Matches, bcryptMatches] = await Promise.all([
    verifier(plain, usesPbkdf2 ? storedHash : DUMMY_PBKDF2_PASSWORD_HASH),
    verifier(
      plain,
      usesBcrypt ? storedHash : DUMMY_BCRYPT_PASSWORD_HASH,
    ),
  ]);

  if (usesPbkdf2) return pbkdf2Matches;
  if (usesBcrypt) return bcryptMatches;
  return false;
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
