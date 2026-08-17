export const REVOKE_USER_SESSIONS_SQL = `
  UPDATE users
  SET session_version = session_version + 1
  WHERE id = ? AND session_version = ?
  RETURNING session_version AS sessionVersion
`;

export const SESSION_REVOCATION_MAX_ATTEMPTS = 3;

export type SessionRevocationRetryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export interface LogoutAuthCookies {
  token?: string;
  sessionId?: string;
}

export interface LogoutTokenIdentity {
  userId: unknown;
  sessionVersion: unknown;
}

export interface LogoutStoredSessionIdentity {
  userId?: string;
  sessionVersion?: number;
}

export type LogoutSessionBindingResult =
  | { status: "invalid-token" }
  | { status: "unbound" }
  | { status: "pending"; error: unknown }
  | { status: "bound"; userId: string; sessionVersion: number };

export function parseLogoutAuthCookies(
  cookieHeader: string | null,
): LogoutAuthCookies {
  const cookies: LogoutAuthCookies = {};

  for (const part of (cookieHeader ?? "").split(";")) {
    const entry = part.trim();
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) continue;

    const name = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1);
    if (name === "token") cookies.token = value;
    if (name === "sessionId") cookies.sessionId = value;
  }

  return cookies;
}

/**
 * JWT rejection is a usable local-logout outcome. Once JWT verification has
 * succeeded, however, a KV read failure means the durable user-session binding
 * cannot be established and the credential must be preserved for a retry.
 */
export async function resolveLogoutSessionBinding(
  verifyToken: () => Promise<LogoutTokenIdentity>,
  readSession: () => Promise<LogoutStoredSessionIdentity | null>,
  isInvalidTokenError: (error: unknown) => boolean,
): Promise<LogoutSessionBindingResult> {
  let identity: LogoutTokenIdentity;
  try {
    identity = await verifyToken();
  } catch (error) {
    return isInvalidTokenError(error)
      ? { status: "invalid-token" }
      : { status: "pending", error };
  }

  const { userId, sessionVersion } = identity;
  if (
    typeof userId !== "string" ||
    typeof sessionVersion !== "number" ||
    !Number.isSafeInteger(sessionVersion) ||
    sessionVersion < 0
  ) {
    return { status: "unbound" };
  }

  let session: LogoutStoredSessionIdentity | null;
  try {
    session = await readSession();
  } catch (error) {
    return { status: "pending", error };
  }

  if (
    session?.userId === userId &&
    session.sessionVersion === sessionVersion
  ) {
    return { status: "bound", userId, sessionVersion };
  }

  return { status: "unbound" };
}

export async function retrySessionRevocation<T>(
  revoke: () => Promise<T>,
): Promise<SessionRevocationRetryResult<T>> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SESSION_REVOCATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return { ok: true, value: await revoke() };
    } catch (error) {
      lastError = error;
    }
  }

  return { ok: false, error: lastError };
}
