import type { TenantContext } from "@/lib/tenant/types";

import { hasActiveVenueAccess } from "../tenant/active-policy.ts";
import { isAccountKind, isRole } from "../users/policy.ts";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password.ts";
import type { LoginCandidate, LoginPersistence } from "./login-persistence.ts";
import type { CreatedLoginSession, LoginSessionAdapter } from "./login-session.ts";

export type LoginResult =
  | { status: "invalid_credentials" }
  | { status: "setup_required" }
  | { status: "unavailable"; user: LoginCandidate }
  | {
      status: "success";
      user: LoginCandidate;
      session: CreatedLoginSession;
    };

export interface LoginServiceDependencies {
  persistence: LoginPersistence;
  session: LoginSessionAdapter;
  verifyPassword?: (password: string, storedHash: string) => Promise<boolean>;
  hashPassword?: (password: string) => Promise<string>;
  needsRehash?: (storedHash: string) => boolean;
  now?: () => Date;
  createId?: () => string;
}

export function isEligibleLoginCandidate(
  user: LoginCandidate | null,
  tenant: Pick<TenantContext, "resolved" | "scope" | "venueId">,
): user is LoginCandidate {
  return Boolean(
    tenant.resolved &&
      user &&
      user.active &&
      !user.deletedAt &&
      isRole(user.role) &&
      isAccountKind(user.accountKind) &&
      hasActiveVenueAccess({
        role: user.role,
        venueId: user.venueId,
        venueActive: user.venueActive,
      }) &&
      !(
        tenant.scope === "venue" &&
        user.role !== "super_admin" &&
        user.venueId !== tenant.venueId
      ),
  );
}

export async function loginWithPassword(
  input: {
    email: string;
    password: string;
    keepSignedIn: boolean;
    tenant: Pick<TenantContext, "resolved" | "scope" | "venueId">;
  },
  dependencies: LoginServiceDependencies,
): Promise<LoginResult> {
  const user = await dependencies.persistence.findCandidate(input.email);
  const isEligible = isEligibleLoginCandidate(user, input.tenant);
  const lookupUserId = isEligible
    ? user.id
    : (dependencies.createId ?? (() => crypto.randomUUID()))();
  const nowIso = (dependencies.now?.() ?? new Date()).toISOString();
  const [latestSetupCodeRequest, passwordMatches] = await Promise.all([
    dependencies.persistence.findLatestSetupCodeRequest(lookupUserId),
    (dependencies.verifyPassword ?? verifyPassword)(
      input.password,
      isEligible ? user.passwordHash : DUMMY_PASSWORD_HASH,
    ),
  ]);

  if (!isEligible) return { status: "invalid_credentials" };

  const isPendingSetup =
    user.migrationStatus === "pending_reset" && !user.passwordSetAt;
  if (isPendingSetup) {
    const isLegacySetup = !latestSetupCodeRequest;
    const hasUsableSetupCodeApproval =
      latestSetupCodeRequest?.status === "approved" &&
      latestSetupCodeRequest.setupMethod === "setup_code" &&
      typeof latestSetupCodeRequest.expiresAt === "string" &&
      latestSetupCodeRequest.expiresAt > nowIso;
    if ((!isLegacySetup && !hasUsableSetupCodeApproval) || !passwordMatches) {
      return { status: "invalid_credentials" };
    }
    return { status: "setup_required" };
  }

  if (!passwordMatches) return { status: "invalid_credentials" };
  if (!dependencies.session.isConfigured()) return { status: "unavailable", user };

  const passwordHash = (dependencies.needsRehash ?? needsRehash)(user.passwordHash)
    ? await (dependencies.hashPassword ?? hashPassword)(input.password)
    : user.passwordHash;
  const sessionVersion = await dependencies.persistence.commitLogin({
    user,
    passwordHash,
    nowIso,
  });
  if (typeof sessionVersion !== "number") return { status: "invalid_credentials" };

  const session = await dependencies.session.createSession({
    user,
    sessionVersion,
    keepSignedIn: input.keepSignedIn,
  });
  return { status: "success", user, session };
}
