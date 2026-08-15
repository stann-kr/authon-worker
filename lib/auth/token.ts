export const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateResetToken(): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(random);
}

export function isResetToken(token: unknown): token is string {
  return typeof token === "string" && RESET_TOKEN_PATTERN.test(token);
}

export interface ExtractedResetTokenUrl {
  token: string | null;
  hadToken: boolean;
  sanitizedPath: string;
}

/**
 * Accepts legacy query tokens and fragment-based tokens, then returns a path
 * that removes either secret from browser history before any form submission.
 */
export function extractResetTokenFromUrl(rawUrl: string): ExtractedResetTokenUrl {
  const url = new URL(rawUrl);
  const queryToken = url.searchParams.get("token");
  const fragmentToken = new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
  const hadToken = queryToken !== null || fragmentToken !== null;
  const candidates = [queryToken, fragmentToken].filter(
    (candidate): candidate is string => candidate !== null,
  );
  const token =
    candidates.length > 0 &&
    candidates.every((candidate) => candidate === candidates[0]) &&
    isResetToken(candidates[0])
      ? candidates[0]
      : null;

  url.searchParams.delete("token");
  url.hash = "";

  return {
    token,
    hadToken,
    sanitizedPath: `${url.pathname}${url.search}`,
  };
}

export async function hashResetToken(token: string): Promise<string> {
  const normalized = token.trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return hexEncode(new Uint8Array(digest));
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
