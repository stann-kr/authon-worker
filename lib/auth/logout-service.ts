import type { LogoutPersistence } from "./logout-persistence.ts";
import {
  resolveLogoutSessionBinding,
  retrySessionRevocation,
  type LogoutTokenIdentity,
} from "./session-revocation.ts";

export type LogoutFailureEvent =
  | "auth.logout.session_binding"
  | "auth.logout.session_revocation"
  | "auth.logout.session_cleanup";

export interface LogoutServiceFailure {
  event: LogoutFailureEvent;
  error: unknown;
}

export interface LogoutServiceResult {
  cleanupFailed: boolean;
  revocationPending: boolean;
  failures: LogoutServiceFailure[];
}

export interface LogoutServiceDependencies {
  persistence: LogoutPersistence;
  verifyToken(token: string): Promise<LogoutTokenIdentity>;
  isInvalidTokenError(error: unknown): boolean;
}

export async function logoutSession(
  input: { token?: string; sessionId?: string },
  dependencies: LogoutServiceDependencies,
): Promise<LogoutServiceResult> {
  const failures: LogoutServiceFailure[] = [];
  let cleanupFailed = false;
  let revocationPending = false;

  if (input.token && input.sessionId) {
    const binding = await resolveLogoutSessionBinding(
      () => dependencies.verifyToken(input.token!),
      () => dependencies.persistence.readSession(input.sessionId!),
      dependencies.isInvalidTokenError,
    );

    if (binding.status === "pending") {
      cleanupFailed = true;
      revocationPending = true;
      failures.push({
        event: "auth.logout.session_binding",
        error: binding.error,
      });
    } else if (binding.status === "bound") {
      const revocation = await retrySessionRevocation(() =>
        dependencies.persistence.revokeUserSessions(
          binding.userId,
          binding.sessionVersion,
        ),
      );
      if (!revocation.ok) {
        cleanupFailed = true;
        revocationPending = true;
        failures.push({
          event: "auth.logout.session_revocation",
          error: revocation.error,
        });
      }
    }
  }

  if (!revocationPending && input.sessionId) {
    try {
      await dependencies.persistence.deleteSession(input.sessionId);
    } catch (error) {
      cleanupFailed = true;
      failures.push({ event: "auth.logout.session_cleanup", error });
    }
  }

  return { cleanupFailed, revocationPending, failures };
}
