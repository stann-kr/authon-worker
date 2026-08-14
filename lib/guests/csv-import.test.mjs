import assert from "node:assert/strict";
import test from "node:test";

import {
  inferGuestNameColumn,
  parseGuestCsv,
  previewGuestCsvColumn,
} from "./csv-import.ts";

test("CSV parser preserves quoted delimiters and infers the guest name column", () => {
  const parsed = parseGuestCsv('\uFEFFemail,Guest Name,note\r\na@example.com,"Alice, A.","VIP"\r\n');
  assert.equal(parsed.error, null);
  assert.equal(parsed.delimiter, ",");
  assert.equal(inferGuestNameColumn(parsed.headers), 1);
  assert.deepEqual(parsed.rows, [["a@example.com", "Alice, A.", "VIP"]]);
});

test("semicolon mapping reuses the bulk duplicate and validation preview", () => {
  const parsed = parseGuestCsv("성명;note\nAlice;one\nBob;two\nAlice;three\n;blank");
  const preview = previewGuestCsvColumn({
    parsed,
    columnIndex: 0,
    existingNames: ["BOB"],
  });
  assert.equal(preview.canApply, true);
  assert.equal(preview.bulk.lines.length, 3);
  assert.equal(preview.bulk.blankLineCount, 1);
  assert.equal(preview.bulk.lines[1].isDuplicateExisting, true);
  assert.equal(preview.bulk.lines[2].isDuplicateInInput, true);
});

test("multiline cells and malformed quotes cannot be applied as line-based names", () => {
  const multiline = parseGuestCsv('name,note\n"Alice\nA",one');
  const preview = previewGuestCsvColumn({ parsed: multiline, columnIndex: 0 });
  assert.equal(preview.multilineCellCount, 1);
  assert.equal(preview.canApply, false);

  assert.equal(parseGuestCsv('name\n"Alice').error, "UNCLOSED_QUOTE");
});

test("invalid column mapping produces an inert preview", () => {
  const parsed = parseGuestCsv("name\nAlice");
  const preview = previewGuestCsvColumn({ parsed, columnIndex: 4 });
  assert.equal(preview.canApply, false);
  assert.equal(preview.sourceRowCount, 0);
});
