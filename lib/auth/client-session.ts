import type { User } from "./user-profile.ts";

export interface AuthGuardRecoveryGate {
  shouldRefresh: (isAllowed: boolean) => boolean;
}

/**
 * Client state can briefly lag the server-authenticated session during an RSC
 * refresh. Let middleware make the final redirect decision, and request at most
 * one authoritative refresh for each mismatch episode.
 */
export function createAuthGuardRecoveryGate(): AuthGuardRecoveryGate {
  let hasRequestedRefresh = false;

  return {
    shouldRefresh(isAllowed) {
      if (isAllowed) {
        hasRequestedRefresh = false;
        return false;
      }
      if (hasRequestedRefresh) return false;

      hasRequestedRefresh = true;
      return true;
    },
  };
}

export function completeAuthenticatedClientSession(params: {
  user: User;
  setUser: (user: User) => void;
  navigate: (href: string) => void;
}): void {
  params.setUser(params.user);
  params.navigate("/");
}
