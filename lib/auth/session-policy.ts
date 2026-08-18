export const STANDARD_SESSION_TTL_SECONDS = 60 * 60 * 24;
export const REMEMBERED_SESSION_IDLE_TTL_SECONDS = 60 * 60 * 24 * 30;
export const REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS = 60 * 60 * 24 * 180;
export const REMEMBERED_SESSION_REFRESH_MIN_EXTENSION_SECONDS = 60 * 60 * 24;

export type SessionMode = "standard" | "remembered";

export interface StoredSession {
  userId?: string;
  sessionVersion?: number;
  mode?: SessionMode;
  absoluteExpiresAt?: string;
}

export interface SessionLifetime {
  mode: SessionMode;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  absoluteExpiresAt: string | null;
  ttlSeconds: number;
  storageTtlSeconds: number;
}

export interface RememberedSessionRefresh {
  expiresAtSeconds: number;
  ttlSeconds: number;
}

function toUnixSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

function toIsoString(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function parseAbsoluteExpiry(value: string | undefined): number | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return Math.floor(milliseconds / 1000);
}

export function createLoginSessionLifetime(
  keepSignedIn: boolean,
  now = new Date(),
): SessionLifetime {
  const issuedAtSeconds = toUnixSeconds(now);
  if (!keepSignedIn) {
    return {
      mode: "standard",
      issuedAtSeconds,
      expiresAtSeconds: issuedAtSeconds + STANDARD_SESSION_TTL_SECONDS,
      absoluteExpiresAt: null,
      ttlSeconds: STANDARD_SESSION_TTL_SECONDS,
      storageTtlSeconds: STANDARD_SESSION_TTL_SECONDS,
    };
  }

  const absoluteExpiresAtSeconds = issuedAtSeconds + REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS;
  return {
    mode: "remembered",
    issuedAtSeconds,
    expiresAtSeconds: issuedAtSeconds + REMEMBERED_SESSION_IDLE_TTL_SECONDS,
    absoluteExpiresAt: toIsoString(absoluteExpiresAtSeconds),
    ttlSeconds: REMEMBERED_SESSION_IDLE_TTL_SECONDS,
    storageTtlSeconds: REMEMBERED_SESSION_ABSOLUTE_TTL_SECONDS,
  };
}

export function createStoredSession(
  userId: string,
  sessionVersion: number,
  lifetime: SessionLifetime,
): StoredSession {
  return {
    userId,
    sessionVersion,
    mode: lifetime.mode,
    ...(lifetime.absoluteExpiresAt
      ? { absoluteExpiresAt: lifetime.absoluteExpiresAt }
      : {}),
  };
}

export function parseStoredSession(raw: string): StoredSession | null {
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      parsed.mode !== undefined &&
      parsed.mode !== "standard" &&
      parsed.mode !== "remembered"
    ) {
      return null;
    }
    if (
      parsed.absoluteExpiresAt !== undefined &&
      typeof parsed.absoluteExpiresAt !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Only explicitly remembered sessions with their original absolute deadline
 * may roll. Sessions created before this metadata existed remain non-rolling.
 */
export function getRememberedSessionRefresh(
  session: StoredSession,
  currentExpiresAtSeconds: number | undefined,
  now = new Date(),
): RememberedSessionRefresh | null {
  if (
    session.mode !== "remembered" ||
    typeof currentExpiresAtSeconds !== "number" ||
    !Number.isFinite(currentExpiresAtSeconds)
  ) {
    return null;
  }

  const absoluteExpiresAtSeconds = parseAbsoluteExpiry(session.absoluteExpiresAt);
  if (absoluteExpiresAtSeconds === null) return null;

  const nowSeconds = toUnixSeconds(now);
  if (currentExpiresAtSeconds <= nowSeconds) return null;

  const expiresAtSeconds = Math.min(
    nowSeconds + REMEMBERED_SESSION_IDLE_TTL_SECONDS,
    absoluteExpiresAtSeconds,
  );
  const ttlSeconds = expiresAtSeconds - nowSeconds;
  if (
    expiresAtSeconds - currentExpiresAtSeconds <
      REMEMBERED_SESSION_REFRESH_MIN_EXTENSION_SECONDS ||
    ttlSeconds < 60
  ) {
    return null;
  }

  return { expiresAtSeconds, ttlSeconds };
}
