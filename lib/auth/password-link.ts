import { isResetToken } from "./token.ts";

export const ACCOUNT_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_LINK_TTL_MS = 60 * 60 * 1000;

export type PasswordLinkPurpose = "account_invitation" | "password_reset";

export interface OneTimePasswordLink {
  url: string;
  expiresAt: string;
}

export function getPasswordLinkExpiry(
  purpose: PasswordLinkPurpose,
  nowMs: number = Date.now(),
): string {
  const ttlMs = purpose === "account_invitation"
    ? ACCOUNT_INVITATION_TTL_MS
    : PASSWORD_RESET_LINK_TTL_MS;
  return new Date(nowMs + ttlMs).toISOString();
}

export function buildPasswordLinkUrl(params: {
  baseUrl: string;
  token: string;
  locale: "en" | "ko";
}): string {
  if (!isResetToken(params.token)) {
    throw new Error("One-time password token is invalid");
  }

  const passwordUrl = new URL("/auth/reset-password", params.baseUrl);
  passwordUrl.searchParams.set("lang", params.locale);
  passwordUrl.hash = new URLSearchParams({ token: params.token }).toString();
  return passwordUrl.toString();
}
