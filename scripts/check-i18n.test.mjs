import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPlaceholders,
  formatMessageParityFailures,
  inspectMessageParity,
} from "./check-i18n.mjs";

test("nested message keys and ICU placeholders match across locales", () => {
  const result = inspectMessageParity(
    { Common: { greeting: "Hello {name}", count: "{count, plural, one {# item} other {# items}}" } },
    { Common: { greeting: "안녕하세요 {name}", count: "{count}개" } },
  );

  assert.deepEqual(formatMessageParityFailures(result), []);
});

test("missing, extra and placeholder differences fail with key-only diagnostics", () => {
  const result = inspectMessageParity(
    { Common: { greeting: "Hello {name}", retained: "Retained" } },
    { Common: { greeting: "안녕하세요 {user}", extra: "Extra" } },
  );
  const failures = formatMessageParityFailures(result);

  assert.deepEqual(result.missingKeys, ["Common.retained"]);
  assert.deepEqual(result.extraKeys, ["Common.extra"]);
  assert.deepEqual(result.placeholderMismatches, [
    { key: "Common.greeting", missing: ["name"], extra: ["user"] },
  ]);
  assert.equal(failures.length, 3);
});

test("ICU selector bodies do not become placeholder names", () => {
  assert.deepEqual(
    [...extractPlaceholders("{count, plural, one {# name} other {# names}}")],
    ["count"],
  );
});
