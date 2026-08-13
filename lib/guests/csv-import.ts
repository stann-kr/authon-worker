import {
  MAX_BULK_INPUT_CHARACTERS,
  parseBulkGuestInput,
  type ParsedBulkGuestInput,
} from "./bulk-entry.ts";

export const MAX_GUEST_CSV_COLUMNS = 50;
export const MAX_GUEST_CSV_ROWS = 1_000;

export interface ParsedGuestCsv {
  delimiter: "," | ";" | "\t";
  headers: string[];
  rows: string[][];
  error: "EMPTY" | "TOO_LARGE" | "TOO_MANY_COLUMNS" | "TOO_MANY_ROWS" | "UNCLOSED_QUOTE" | null;
}

export interface GuestCsvColumnPreview {
  rawInput: string;
  bulk: ParsedBulkGuestInput;
  sourceRowCount: number;
  multilineCellCount: number;
  canApply: boolean;
}

function detectDelimiter(raw: string): ParsedGuestCsv["delimiter"] {
  let quoted = false;
  const counts = new Map<ParsedGuestCsv["delimiter"], number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) break;
    if (!quoted && counts.has(char as ParsedGuestCsv["delimiter"])) {
      const delimiter = char as ParsedGuestCsv["delimiter"];
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? ",";
}

function emptyResult(error: ParsedGuestCsv["error"]): ParsedGuestCsv {
  return { delimiter: ",", headers: [], rows: [], error };
}

export function parseGuestCsv(rawInput: string): ParsedGuestCsv {
  if (typeof rawInput !== "string" || rawInput.length === 0) return emptyResult("EMPTY");
  if (rawInput.length > MAX_BULK_INPUT_CHARACTERS) return emptyResult("TOO_LARGE");
  const raw = rawInput.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(raw);
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;

  const pushRecord = () => {
    record.push(cell);
    if (record.some((value) => value.trim().length > 0)) records.push(record);
    record = [];
    cell = "";
  };

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (quoted || cell.length === 0) {
        quoted = !quoted;
      } else {
        cell += char;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      record.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      pushRecord();
      if (char === "\r" && raw[index + 1] === "\n") index += 1;
      continue;
    }
    cell += char;
  }
  if (quoted) return { delimiter, headers: [], rows: [], error: "UNCLOSED_QUOTE" };
  if (cell.length > 0 || record.length > 0) pushRecord();
  if (records.length === 0) return { delimiter, headers: [], rows: [], error: "EMPTY" };
  if (records.some((row) => row.length > MAX_GUEST_CSV_COLUMNS)) {
    return { delimiter, headers: [], rows: [], error: "TOO_MANY_COLUMNS" };
  }
  if (records.length - 1 > MAX_GUEST_CSV_ROWS) {
    return { delimiter, headers: [], rows: [], error: "TOO_MANY_ROWS" };
  }

  const [headerRow, ...rows] = records;
  const headers = headerRow.map((header, index) => header.trim() || `Column ${index + 1}`);
  return { delimiter, headers, rows, error: null };
}

const GUEST_NAME_HEADERS = new Set([
  "name",
  "guest",
  "guest name",
  "guest_name",
  "fullname",
  "full name",
  "이름",
  "성명",
  "게스트",
  "게스트 이름",
]);

export function inferGuestNameColumn(headers: readonly string[]): number | null {
  const index = headers.findIndex((header) =>
    GUEST_NAME_HEADERS.has(header.normalize("NFKC").trim().toLocaleLowerCase("en-US")),
  );
  return index >= 0 ? index : null;
}

export function previewGuestCsvColumn(params: {
  parsed: ParsedGuestCsv;
  columnIndex: number;
  existingNames?: readonly string[];
}): GuestCsvColumnPreview {
  if (
    params.parsed.error ||
    !Number.isInteger(params.columnIndex) ||
    params.columnIndex < 0 ||
    params.columnIndex >= params.parsed.headers.length
  ) {
    return {
      rawInput: "",
      bulk: parseBulkGuestInput("", params.existingNames),
      sourceRowCount: 0,
      multilineCellCount: 0,
      canApply: false,
    };
  }
  const values = params.parsed.rows.map((row) => row[params.columnIndex] ?? "");
  const multilineCellCount = values.filter((value) => /[\r\n]/.test(value)).length;
  const rawInput = multilineCellCount === 0 ? values.join("\n") : "";
  return {
    rawInput,
    bulk: parseBulkGuestInput(rawInput, params.existingNames),
    sourceRowCount: values.length,
    multilineCellCount,
    canApply: values.length > 0 && multilineCellCount === 0,
  };
}
