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

/** Raised when the session check redirects a read; retrying on the same page cannot succeed. */
export const SESSION_EXPIRED_EVENT = "authon:session-expired";
export const SESSION_EXPIRED_SIGN_IN_PATH = "/auth/login?reason=session-expired";
const SESSION_EXPIRY_NAVIGATION_WINDOW_MS = 5_000;

export function notifySessionExpired(target: EventTarget | undefined = globalThis.window): void {
  target?.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/**
 * Sends the browser to sign-in once for a burst of expired reads. A later read may try again,
 * because an unsaved-work prompt can keep the expired page open.
 */
export function watchSessionExpiry(
  target: EventTarget,
  navigate: (href: string) => void,
  now: () => number = Date.now,
): () => void {
  let lastNavigationAt = Number.NEGATIVE_INFINITY;
  const handleExpiry = () => {
    const time = now();
    if (time - lastNavigationAt < SESSION_EXPIRY_NAVIGATION_WINDOW_MS) return;
    lastNavigationAt = time;
    navigate(SESSION_EXPIRED_SIGN_IN_PATH);
  };
  target.addEventListener(SESSION_EXPIRED_EVENT, handleExpiry);
  return () => target.removeEventListener(SESSION_EXPIRED_EVENT, handleExpiry);
}
