export const MAX_BULK_PASTE_NAMES = 25;
export const MAX_BULK_WRITE_NAMES = MAX_BULK_PASTE_NAMES;
export const MAX_GUEST_NAME_LENGTH = 100;
export const MAX_BULK_INPUT_CHARACTERS = 10_000;
const MAX_GUEST_NAME_RAW_LENGTH = MAX_GUEST_NAME_LENGTH * 4;

export type GuestNamePreparationError =
  | "INVALID_TYPE"
  | "EMPTY"
  | "LINE_BREAK"
  | "CONTROL_CHARACTER"
  | "FORMAT_CHARACTER"
  | "TOO_LONG";

export interface PreparedGuestName {
  /** NFKC-normalized, trimmed name with Unicode whitespace collapsed. */
  name: string;
  /** Locale-independent comparison key used only for duplicate warnings. */
  key: string;
  error: GuestNamePreparationError | null;
}

export interface ParsedBulkGuestLine extends PreparedGuestName {
  /** Zero-based position among non-empty pasted lines. */
  inputIndex: number;
  /** One-based physical line number in the pasted text. */
  lineNumber: number;
  raw: string;
  isDuplicateInInput: boolean;
  isDuplicateExisting: boolean;
  /** Only the first 25 non-empty lines may be submitted from one preview. */
  inPasteLimit: boolean;
}

export interface ParsedBulkGuestInput {
  /** Non-empty lines in their original order, including overflow lines. */
  lines: ParsedBulkGuestLine[];
  blankLineCount: number;
  overflowCount: number;
}

/** Preserves rejected input verbatim so a successful sibling row cannot erase it. */
export function toRetainedBulkGuestLineText(
  line: Pick<ParsedBulkGuestLine, "error" | "name" | "raw">,
): string {
  return line.error === null ? line.name : line.raw;
}

const LINE_BREAK_PATTERN = /[\r\n]/u;
// Horizontal tab is intentionally allowed and normalized to a regular space.
// CR/LF have a dedicated error; the remaining C0/C1 controls are unsafe in names.
const DANGEROUS_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const DANGEROUS_FORMAT_PATTERN =
  /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu;

function normalizeGuestName(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .replace(UNICODE_WHITESPACE_PATTERN, " ");
}

/**
 * Validates and canonicalizes one guest name at the UI/server boundary.
 * Duplicate comparison is advisory: `key` must never be used as a unique ID.
 */
export function prepareGuestName(raw: unknown): PreparedGuestName {
  if (typeof raw !== "string") {
    return { name: "", key: "", error: "INVALID_TYPE" };
  }
  // Bound normalization work for direct Server Action callers that bypass the
  // UI textarea limit. Legitimate names remain far below this raw boundary.
  if (raw.length > MAX_GUEST_NAME_RAW_LENGTH) {
    return { name: "", key: "", error: "TOO_LONG" };
  }

  const hasLineBreak = LINE_BREAK_PATTERN.test(raw);
  const hasDangerousControl = DANGEROUS_CONTROL_PATTERN.test(raw);
  const hasDangerousFormat = DANGEROUS_FORMAT_PATTERN.test(raw);
  const name = normalizeGuestName(raw);
  // Match the persisted uppercase representation so case expansion such as
  // German ß -> SS cannot create a duplicate that the preview misses.
  const key = name.toUpperCase();

  if (hasLineBreak) return { name, key, error: "LINE_BREAK" };
  if (hasDangerousControl) {
    return { name, key, error: "CONTROL_CHARACTER" };
  }
  if (hasDangerousFormat) {
    return { name, key, error: "FORMAT_CHARACTER" };
  }
  if (!name) return { name, key, error: "EMPTY" };

  // The current registration flow stores uppercase names, whose length can
  // expand for a small number of Unicode characters (for example, ß -> SS).
  if (
    name.length > MAX_GUEST_NAME_LENGTH ||
    name.toUpperCase().length > MAX_GUEST_NAME_LENGTH
  ) {
    return { name, key, error: "TOO_LONG" };
  }

  return { name, key, error: null };
}

/** Converts an already validated name to the existing uppercase storage form. */
export function toStoredGuestName(name: string): string {
  return normalizeGuestName(name).toUpperCase();
}

function splitPhysicalLines(raw: string): string[] {
  if (raw.length === 0) return [];
  return raw.split(/\r\n|\n|\r/u);
}

/**
 * Builds a deterministic paste preview without writing data.
 * Invalid rows and duplicate candidates remain separate concepts: duplicate
 * flags are warnings and never populate `error` by themselves.
 */
export function parseBulkGuestInput(
  raw: string,
  existingNames: readonly string[] = [],
): ParsedBulkGuestInput {
  const existingKeys = new Set<string>();
  for (const existingName of existingNames) {
    const prepared = prepareGuestName(existingName);
    if (prepared.error === null) existingKeys.add(prepared.key);
  }

  const seenInputKeys = new Set<string>();
  const lines: ParsedBulkGuestLine[] = [];
  let blankLineCount = 0;

  splitPhysicalLines(raw).forEach((rawLine, physicalIndex) => {
    const prepared = prepareGuestName(rawLine);
    if (prepared.error === "EMPTY") {
      blankLineCount += 1;
      return;
    }

    const inputIndex = lines.length;
    const isValid = prepared.error === null;
    const isDuplicateInInput =
      isValid && seenInputKeys.has(prepared.key);
    const isDuplicateExisting =
      isValid && existingKeys.has(prepared.key);

    lines.push({
      ...prepared,
      inputIndex,
      lineNumber: physicalIndex + 1,
      raw: rawLine,
      isDuplicateInInput,
      isDuplicateExisting,
      inPasteLimit: inputIndex < MAX_BULK_PASTE_NAMES,
    });

    if (isValid) seenInputKeys.add(prepared.key);
  });

  return {
    lines,
    blankLineCount,
    overflowCount: Math.max(0, lines.length - MAX_BULK_PASTE_NAMES),
  };
}
