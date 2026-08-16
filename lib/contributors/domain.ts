export const CONTRIBUTOR_KINDS = ["dj"] as const;
export type ContributorKind = (typeof CONTRIBUTOR_KINDS)[number];

export interface PreparedContributorInput {
  displayName: string;
  nameKey: string;
  kind: ContributorKind;
}

export type ContributorInputError = "INVALID_DISPLAY_NAME" | "INVALID_KIND";

const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu;
const DANGEROUS_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const DANGEROUS_FORMAT_PATTERN =
  /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

export function isContributorKind(value: unknown): value is ContributorKind {
  return value === "dj";
}

export function normalizeContributorDisplayName(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 400) return null;
  const displayName = value
    .normalize("NFKC")
    .trim()
    .replace(UNICODE_WHITESPACE_PATTERN, " ");
  if (
    !displayName ||
    displayName.length > 100 ||
    DANGEROUS_CONTROL_PATTERN.test(displayName) ||
    DANGEROUS_FORMAT_PATTERN.test(value)
  ) {
    return null;
  }
  return displayName;
}

export function getContributorNameKey(value: unknown): string | null {
  const displayName = normalizeContributorDisplayName(value);
  return displayName ? displayName.toUpperCase() : null;
}

export function prepareContributorInput(input: {
  displayName: unknown;
  kind?: unknown;
}):
  | { contributor: PreparedContributorInput; error: null }
  | { contributor: null; error: ContributorInputError } {
  const displayName = normalizeContributorDisplayName(input.displayName);
  const nameKey = getContributorNameKey(input.displayName);
  if (!displayName || !nameKey) {
    return { contributor: null, error: "INVALID_DISPLAY_NAME" };
  }

  const kind = input.kind ?? "dj";
  if (!isContributorKind(kind)) {
    return { contributor: null, error: "INVALID_KIND" };
  }
  return { contributor: { displayName, nameKey, kind }, error: null };
}
