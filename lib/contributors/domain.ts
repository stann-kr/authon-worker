export const CONTRIBUTOR_KINDS = ["dj"] as const;
export type ContributorKind = (typeof CONTRIBUTOR_KINDS)[number];

export interface PreparedContributorInput {
  displayName: string;
  kind: ContributorKind;
}

export type ContributorInputError = "INVALID_DISPLAY_NAME" | "INVALID_KIND";

export function isContributorKind(value: unknown): value is ContributorKind {
  return value === "dj";
}

export function prepareContributorInput(input: {
  displayName: unknown;
  kind?: unknown;
}):
  | { contributor: PreparedContributorInput; error: null }
  | { contributor: null; error: ContributorInputError } {
  if (typeof input.displayName !== "string") {
    return { contributor: null, error: "INVALID_DISPLAY_NAME" };
  }
  if (/[\u0000-\u001f\u007f]/.test(input.displayName)) {
    return { contributor: null, error: "INVALID_DISPLAY_NAME" };
  }
  const displayName = input.displayName.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !displayName ||
    displayName.length > 100
  ) {
    return { contributor: null, error: "INVALID_DISPLAY_NAME" };
  }

  const kind = input.kind ?? "dj";
  if (!isContributorKind(kind)) {
    return { contributor: null, error: "INVALID_KIND" };
  }
  return { contributor: { displayName, kind }, error: null };
}
