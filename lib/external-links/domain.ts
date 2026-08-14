import type { ExternalDJLink } from "../api/types";

export type ExternalLinkDeletionDisposition = "archive" | "hard-delete";
export type ExternalLinkValidationDisposition =
  | "valid"
  | "invalid"
  | "unavailable";

export const MAX_EXTERNAL_LINK_DJ_NAME_LENGTH = 100;
export const MAX_EXTERNAL_LINK_EVENT_LENGTH = 120;

/** Keeps permanent credential failure separate from retryable infrastructure errors. */
export function getExternalLinkValidationDisposition(
  error: string | null | undefined,
): ExternalLinkValidationDisposition {
  if (!error) return "valid";
  return error === "INVALID_EXTERNAL_LINK" ? "invalid" : "unavailable";
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu;
const DANGEROUS_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const DANGEROUS_FORMAT_PATTERN =
  /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

export interface ExternalLinkCreateDraft {
  date: string;
  djName: string;
  event: string;
  maxGuests: number;
  localeMode: ExternalDJLink["localeMode"];
  kind: ExternalDJLink["kind"];
}

export type ExternalLinkCreateInputError =
  | "INVALID_INPUT"
  | "INVALID_DATE"
  | "INVALID_DJ_NAME"
  | "DJ_NAME_TOO_LONG"
  | "INVALID_EVENT"
  | "EVENT_TOO_LONG"
  | "INVALID_MAX_GUESTS"
  | "INVALID_LOCALE_MODE"
  | "INVALID_LINK_KIND";

export type ExternalLinkCreateInputResult =
  | { draft: ExternalLinkCreateDraft; error: null }
  | { draft: null; error: ExternalLinkCreateInputError };

export interface ExternalLinkShareData {
  url: string;
}

export interface ExternalLinkShareAdapter {
  share?: (data: ExternalLinkShareData) => Promise<void>;
  canShare?: (data: ExternalLinkShareData) => boolean;
  copy: (url: string) => Promise<void>;
}

export type ExternalLinkShareResult =
  | "shared"
  | "copied"
  | "cancelled"
  | "failed";

interface ExternalLinkRecord {
  id: string;
  venueId: string;
  token: string;
  djName: string;
  event: string | null;
  date: string | null;
  maxGuests: number;
  usedGuests: number;
  active: boolean;
  expiresAt: string | null;
  createdBy: string | null;
  localeMode: string;
  kind: string;
  createdAt: string | null;
}

function invalidCreateInput(
  error: ExternalLinkCreateInputError,
): ExternalLinkCreateInputResult {
  return { draft: null, error };
}

function normalizeExternalLinkText(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  // Avoid unbounded Unicode normalization work for direct Server Action calls.
  // The caller's normal length branch will reject this unchanged value.
  if (value.length > maxLength * 4) return value;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(UNICODE_WHITESPACE_PATTERN, " ");
  return DANGEROUS_CONTROL_PATTERN.test(normalized) ||
    DANGEROUS_FORMAT_PATTERN.test(value)
    ? null
    : normalized;
}

export function isValidExternalLinkDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/**
 * Normalizes and validates the only client-controlled fields accepted when an
 * external link is created. Credential, usage, lifecycle, and actor fields are
 * intentionally absent from the returned draft.
 */
export function prepareExternalLinkCreateInput(
  input: unknown,
): ExternalLinkCreateInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalidCreateInput("INVALID_INPUT");
  }

  const candidate = input as Record<string, unknown>;
  if (!isValidExternalLinkDate(candidate.date)) {
    return invalidCreateInput("INVALID_DATE");
  }

  const djName = normalizeExternalLinkText(
    candidate.djName,
    MAX_EXTERNAL_LINK_DJ_NAME_LENGTH,
  );
  if (!djName) return invalidCreateInput("INVALID_DJ_NAME");
  if (djName.length > MAX_EXTERNAL_LINK_DJ_NAME_LENGTH) {
    return invalidCreateInput("DJ_NAME_TOO_LONG");
  }

  const event = normalizeExternalLinkText(
    candidate.event,
    MAX_EXTERNAL_LINK_EVENT_LENGTH,
  );
  if (!event) return invalidCreateInput("INVALID_EVENT");
  if (event.length > MAX_EXTERNAL_LINK_EVENT_LENGTH) {
    return invalidCreateInput("EVENT_TOO_LONG");
  }

  if (
    typeof candidate.maxGuests !== "number" ||
    !Number.isInteger(candidate.maxGuests) ||
    candidate.maxGuests < 1 ||
    candidate.maxGuests > 999
  ) {
    return invalidCreateInput("INVALID_MAX_GUESTS");
  }

  const localeMode = candidate.localeMode ?? "auto";
  if (localeMode !== "auto" && localeMode !== "en" && localeMode !== "ko") {
    return invalidCreateInput("INVALID_LOCALE_MODE");
  }

  const kind = candidate.kind ?? "contributor";
  if (kind !== "contributor" && kind !== "self_rsvp") {
    return invalidCreateInput("INVALID_LINK_KIND");
  }

  return {
    draft: {
      date: candidate.date,
      djName,
      event,
      maxGuests: candidate.maxGuests,
      localeMode,
      kind,
    },
    error: null,
  };
}

/**
 * Builds an editable create-form draft from an existing link. The allowlist is
 * deliberate: token, id, usage, actor, URL, and lifecycle fields cannot leak
 * into a newly generated link through this helper.
 */
export function toExternalLinkTemplateDraft(
  source: Pick<
    ExternalDJLink,
    "djName" | "event" | "maxGuests" | "localeMode" | "kind"
  >,
  targetDate: string,
): ExternalLinkCreateDraft {
  return {
    date: targetDate,
    djName: source.djName,
    event: source.event ?? "",
    maxGuests: source.maxGuests,
    localeMode: source.localeMode,
    kind: source.kind === "self_rsvp" ? "self_rsvp" : "contributor",
  };
}

export function toExternalLinkShareData(
  url: string,
): ExternalLinkShareData {
  return { url };
}

export function isExternalLinkShareCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Shares only the URL so a native share target's Copy action cannot append
 * display metadata to the credential-bearing link. Clipboard fallback follows
 * the same URL-only contract.
 * The injected adapter keeps browser globals out of the domain and makes every
 * outcome deterministic in unit tests.
 */
export async function shareExternalLink(
  data: ExternalLinkShareData,
  adapter: ExternalLinkShareAdapter,
): Promise<ExternalLinkShareResult> {
  let canUseNativeShare = typeof adapter.share === "function";
  if (canUseNativeShare && adapter.canShare) {
    try {
      canUseNativeShare = adapter.canShare(data);
    } catch {
      canUseNativeShare = false;
    }
  }

  if (canUseNativeShare && adapter.share) {
    try {
      await adapter.share(data);
      return "shared";
    } catch (error: unknown) {
      if (isExternalLinkShareCancellation(error)) return "cancelled";
    }
  }

  try {
    await adapter.copy(data.url);
    return "copied";
  } catch {
    return "failed";
  }
}

export function getExternalLinkDeletionDisposition(
  hasGuestHistory: boolean,
): ExternalLinkDeletionDisposition {
  return hasGuestHistory ? "archive" : "hard-delete";
}

export function toExternalDJLink(
  link: ExternalLinkRecord,
  guestUrl?: string | null,
): ExternalDJLink {
  return {
    id: link.id,
    venueId: link.venueId,
    token: link.token,
    djName: link.djName,
    event: link.event,
    date: link.date,
    maxGuests: link.maxGuests,
    usedGuests: link.usedGuests,
    active: link.active,
    expiresAt: link.expiresAt,
    createdBy: link.createdBy,
    createdAt: link.createdAt,
    guestUrl,
    localeMode:
      link.localeMode === "en" || link.localeMode === "ko"
        ? link.localeMode
        : "auto",
    kind: link.kind === "self_rsvp" ? "self_rsvp" : "contributor",
  };
}
