import type {
  ProfilePasswordPersistence,
  ProfilePasswordUser,
} from "./profile-password-persistence.ts";
import { getPasswordPolicyError } from "./password-policy.ts";
import { hashPassword, verifyPassword } from "./password.ts";

export type ProfilePasswordChangeResult =
  | { status: "missing" }
  | { status: "policy_error"; error: string }
  | { status: "user_not_found" }
  | { status: "password_mismatch" }
  | { status: "conflict" }
  | {
      status: "success";
      user: ProfilePasswordUser;
      sessionCleanupError: unknown | null;
    };

export interface ProfilePasswordServiceDependencies {
  persistence: ProfilePasswordPersistence;
  now?: () => Date;
  createId?: () => string;
  hashPassword?: (password: string) => Promise<string>;
  verifyPassword?: (password: string, storedHash: string) => Promise<boolean>;
}

export async function changeProfilePassword(
  input: {
    actorUserId: string;
    currentPassword: unknown;
    newPassword: unknown;
    sessionId?: string;
  },
  dependencies: ProfilePasswordServiceDependencies,
): Promise<ProfilePasswordChangeResult> {
  if (!input.currentPassword || !input.newPassword) {
    return { status: "missing" };
  }
  const policyError = getPasswordPolicyError(input.newPassword as string);
  if (policyError) return { status: "policy_error", error: policyError };

  const user = await dependencies.persistence.loadUser(input.actorUserId);
  if (!user?.active) return { status: "user_not_found" };
  const isMatch = await (dependencies.verifyPassword ?? verifyPassword)(
    input.currentPassword as string,
    user.passwordHash,
  );
  if (!isMatch) return { status: "password_mismatch" };

  const passwordHash = await (dependencies.hashPassword ?? hashPassword)(
    input.newPassword as string,
  );
  const nowIso = (dependencies.now?.() ?? new Date()).toISOString();
  const commit = await dependencies.persistence.commitChange({
    user,
    passwordHash,
    nowIso,
    auditEventId: (dependencies.createId ?? (() => crypto.randomUUID()))(),
  });
  if (commit.updatedUserId !== user.id || commit.auditedUserId !== user.id) {
    return { status: "conflict" };
  }

  let sessionCleanupError: unknown | null = null;
  if (input.sessionId) {
    try {
      await dependencies.persistence.deleteSession(input.sessionId);
    } catch (error) {
      // D1 session_version is authoritative after the committed password change.
      sessionCleanupError = error;
    }
  }
  return { status: "success", user, sessionCleanupError };
}
