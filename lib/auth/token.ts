export function generateResetToken(): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(random);
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
