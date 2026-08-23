import type { PasswordResetTokenPersistence } from "./password-reset-token-persistence.ts";
import { getPasswordPolicyError } from "./password-policy.ts";
import { hashPassword } from "./password.ts";
import { hashResetToken, isResetToken } from "./token.ts";

export type PreparedTokenPasswordReset =
  | { status: "missing" }
  | { status: "policy_error"; error: string }
  | { status: "invalid_token" }
  | { status: "ready"; token: string; newPassword: string };

export type TokenPasswordResetResult =
  | { status: "invalid_token" }
  | { status: "success"; userId: string; isInitialSetup: boolean };

export interface PasswordResetTokenServiceDependencies {
  persistence: PasswordResetTokenPersistence;
  now?: () => Date;
  createId?: () => string;
  hashPassword?: (password: string) => Promise<string>;
  hashResetToken?: (token: string) => Promise<string>;
}

export function prepareTokenPasswordReset(input: {
  token: unknown;
  newPassword: unknown;
}): PreparedTokenPasswordReset {
  if (typeof input.token !== "string" || typeof input.newPassword !== "string") {
    return { status: "missing" };
  }
  const policyError = getPasswordPolicyError(input.newPassword);
  if (policyError) return { status: "policy_error", error: policyError };
  const token = input.token.trim();
  return isResetToken(token)
    ? { status: "ready", token, newPassword: input.newPassword }
    : { status: "invalid_token" };
}

export async function resetPasswordWithToken(
  input: {
    token: string;
    newPassword: string;
    expectedVenueId: string | null;
  },
  dependencies: PasswordResetTokenServiceDependencies,
): Promise<TokenPasswordResetResult> {
  const nowIso = (dependencies.now?.() ?? new Date()).toISOString();
  const tokenHash = await (
    dependencies.hashResetToken ?? hashResetToken
  )(input.token);
  const candidate = await dependencies.persistence.loadCandidate({
    tokenHash,
    nowIso,
    expectedVenueId: input.expectedVenueId,
  });
  if (!candidate) return { status: "invalid_token" };

  // Keep the expensive password hash behind the exact token and tenant read.
  const passwordHash = await (
    dependencies.hashPassword ?? hashPassword
  )(input.newPassword);
  const isInitialSetup =
    candidate.migrationStatus === "pending_reset" && !candidate.passwordSetAt;
  const commit = await dependencies.persistence.commit({
    tokenHash,
    passwordHash,
    expectedVenueId: input.expectedVenueId,
    nowIso,
    auditEventId: (dependencies.createId ?? (() => crypto.randomUUID()))(),
    auditAction: isInitialSetup
      ? "password_setup_completed"
      : "password_reset_completed",
    auditMethod: isInitialSetup
      ? "invitation_link"
      : "password_reset_link",
  });

  if (
    !commit.updatedUserId ||
    !commit.consumedUserId ||
    !commit.auditedUserId ||
    commit.updatedUserId !== commit.consumedUserId ||
    commit.updatedUserId !== commit.auditedUserId
  ) {
    return { status: "invalid_token" };
  }
  return { status: "success", userId: commit.updatedUserId, isInitialSetup };
}
