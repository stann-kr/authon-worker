import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BULK_PASTE_NAMES,
  MAX_BULK_INPUT_CHARACTERS,
  MAX_BULK_WRITE_NAMES,
  MAX_GUEST_NAME_LENGTH,
  parseBulkGuestInput,
  prepareGuestName,
  toRetainedBulkGuestLineText,
  toStoredGuestName,
} from "./bulk-entry.ts";

test("bulk entry limits expose the UI preview and server write boundaries", () => {
  assert.equal(MAX_BULK_PASTE_NAMES, 25);
  assert.equal(MAX_BULK_WRITE_NAMES, 25);
  assert.equal(MAX_GUEST_NAME_LENGTH, 100);
  assert.equal(MAX_BULK_INPUT_CHARACTERS, 10_000);
});

test("guest names use NFKC and collapse Unicode whitespace", () => {
  const prepared = prepareGuestName("  Ａｌｉｃｅ\u00a0\t  Ｓｍｉｔｈ  ");

  assert.deepEqual(prepared, {
    name: "Alice Smith",
    key: "ALICE SMITH",
    error: null,
  });
  assert.equal(toStoredGuestName(prepared.name), "ALICE SMITH");
});

test("composed and decomposed Unicode names share one comparison key", () => {
  const composed = prepareGuestName("José");
  const decomposed = prepareGuestName("Jose\u0301");

  assert.equal(composed.error, null);
  assert.equal(decomposed.error, null);
  assert.equal(decomposed.name, "José");
  assert.equal(decomposed.key, composed.key);
  assert.equal(toStoredGuestName(decomposed.name), "JOSÉ");
});

test("comparison keys ignore case and repeated spaces without changing validity", () => {
  const first = prepareGuestName("Alice   Van\tSmith");
  const second = prepareGuestName("  ALICE VAN SMITH  ");

  assert.equal(first.error, null);
  assert.equal(second.error, null);
  assert.equal(first.name, "Alice Van Smith");
  assert.equal(first.key, second.key);
});

test("comparison keys follow uppercase storage case expansion", () => {
  const expanded = prepareGuestName("Straße");
  const storedEquivalent = prepareGuestName("STRASSE");

  assert.equal(expanded.error, null);
  assert.equal(expanded.key, storedEquivalent.key);
  assert.equal(toStoredGuestName(expanded.name), storedEquivalent.key);
});

test("prepareGuestName rejects invalid types, empty names, line breaks, and controls", () => {
  assert.equal(prepareGuestName(null).error, "INVALID_TYPE");
  assert.equal(prepareGuestName("\u00a0\t ").error, "EMPTY");
  assert.equal(prepareGuestName("Alice\nBob").error, "LINE_BREAK");
  assert.equal(prepareGuestName("Alice\rBob").error, "LINE_BREAK");
  assert.equal(prepareGuestName("Alice\u0000Bob").error, "CONTROL_CHARACTER");
  assert.equal(prepareGuestName("Alice\u001bBob").error, "CONTROL_CHARACTER");
  assert.equal(prepareGuestName("Alice\u0085Bob").error, "CONTROL_CHARACTER");
  assert.equal(prepareGuestName("Alice\u202eBob").error, "FORMAT_CHARACTER");
  assert.equal(prepareGuestName("Alice\u200bBob").error, "FORMAT_CHARACTER");
  assert.equal(prepareGuestName("Alice\ufeffBob").error, "FORMAT_CHARACTER");
  assert.equal(prepareGuestName("نیم\u200cفاصله").error, null);
});

test("guest name length is checked after normalization and uppercase expansion", () => {
  assert.equal(prepareGuestName("a".repeat(MAX_GUEST_NAME_LENGTH)).error, null);
  assert.equal(
    prepareGuestName("a".repeat(MAX_GUEST_NAME_LENGTH + 1)).error,
    "TOO_LONG",
  );
  assert.equal(prepareGuestName("ß".repeat(51)).error, "TOO_LONG");
  assert.equal(prepareGuestName(" ".repeat(10_000) + "Alice").error, "TOO_LONG");
});

test("CRLF parsing ignores blank lines while preserving order and physical line numbers", () => {
  const result = parseBulkGuestInput(
    " Alice \r\n\r\n Bob\r\n\u00a0\t\r\nCharlie",
  );

  assert.equal(result.blankLineCount, 2);
  assert.equal(result.overflowCount, 0);
  assert.deepEqual(
    result.lines.map(({ inputIndex, lineNumber, name, raw }) => ({
      inputIndex,
      lineNumber,
      name,
      raw,
    })),
    [
      { inputIndex: 0, lineNumber: 1, name: "Alice", raw: " Alice " },
      { inputIndex: 1, lineNumber: 3, name: "Bob", raw: " Bob" },
      { inputIndex: 2, lineNumber: 5, name: "Charlie", raw: "Charlie" },
    ],
  );
});

test("existing and later in-paste duplicates are independent warning flags", () => {
  const result = parseBulkGuestInput(
    "alice   smith\nBob\nＢＯＢ\nJose\u0301\nCarol",
    ["ALICE SMITH", "JOSÉ"],
  );

  assert.deepEqual(
    result.lines.map((line) => ({
      name: line.name,
      error: line.error,
      inInput: line.isDuplicateInInput,
      existing: line.isDuplicateExisting,
    })),
    [
      { name: "alice smith", error: null, inInput: false, existing: true },
      { name: "Bob", error: null, inInput: false, existing: false },
      { name: "BOB", error: null, inInput: true, existing: false },
      { name: "José", error: null, inInput: false, existing: true },
      { name: "Carol", error: null, inInput: false, existing: false },
    ],
  );

  for (const duplicate of result.lines.filter(
    (line) => line.isDuplicateInInput || line.isDuplicateExisting,
  )) {
    assert.equal(duplicate.error, null, "duplicate warnings must remain valid");
  }
});

test("invalid non-empty lines remain addressable but never become duplicate warnings", () => {
  const tooLong = "A".repeat(MAX_GUEST_NAME_LENGTH + 1);
  const result = parseBulkGuestInput(
    `Alice\nBad\u0000Name\n${tooLong}\nALICE`,
    ["Bad\u0000Name"],
  );

  assert.equal(result.lines.length, 4);
  assert.equal(result.lines[1].lineNumber, 2);
  assert.equal(result.lines[1].error, "CONTROL_CHARACTER");
  assert.equal(result.lines[1].isDuplicateExisting, false);
  assert.equal(result.lines[2].error, "TOO_LONG");
  assert.equal(result.lines[3].isDuplicateInInput, true);
  assert.equal(result.lines[3].error, null);
});

test("only the first 25 non-empty lines are inside the paste limit", () => {
  const firstBlock = Array.from({ length: 12 }, (_, index) => `Guest ${index + 1}`);
  const secondBlock = Array.from(
    { length: 16 },
    (_, index) => `Guest ${index + 13}`,
  );
  const raw = [...firstBlock, "   ", ...secondBlock].join("\r\n");
  const result = parseBulkGuestInput(raw);

  assert.equal(result.lines.length, 28);
  assert.equal(result.blankLineCount, 1);
  assert.equal(result.overflowCount, 3);
  assert.equal(result.lines[24].inputIndex, 24);
  assert.equal(result.lines[24].lineNumber, 26);
  assert.equal(result.lines[24].inPasteLimit, true);
  assert.equal(result.lines[25].inputIndex, 25);
  assert.equal(result.lines[25].lineNumber, 27);
  assert.equal(result.lines[25].inPasteLimit, false);
  assert.equal(result.lines[27].inPasteLimit, false);
  assert.equal(
    result.lines.filter((line) => line.inPasteLimit).length,
    MAX_BULK_PASTE_NAMES,
  );
});

test("an empty textarea has no parsed rows or synthetic blank line", () => {
  assert.deepEqual(parseBulkGuestInput(""), {
    lines: [],
    blankLineCount: 0,
    overflowCount: 0,
  });
});

test("retained bulk input preserves an oversized rejected line verbatim", () => {
  const oversized = "A".repeat(401);
  const parsed = parseBulkGuestInput(`${oversized}\n  Bob  `);

  assert.equal(parsed.lines[0].error, "TOO_LONG");
  assert.equal(parsed.lines[0].name, "");
  assert.equal(toRetainedBulkGuestLineText(parsed.lines[0]), oversized);
  assert.equal(toRetainedBulkGuestLineText(parsed.lines[1]), "Bob");
});
