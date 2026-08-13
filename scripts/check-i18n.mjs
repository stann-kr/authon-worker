import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_PATTERN = /\{\s*([A-Za-z][\w.-]*)\s*(?:,|\})/gu;

export function flattenScalarMessages(value, prefix = "", output = new Map()) {
  if (typeof value === "string") {
    output.set(prefix, value);
    return output;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Message at ${prefix || "<root>"} must be an object or string`);
  }

  for (const [key, child] of Object.entries(value)) {
    const childKey = prefix ? `${prefix}.${key}` : key;
    flattenScalarMessages(child, childKey, output);
  }
  return output;
}

export function extractPlaceholders(message) {
  return new Set(
    [...message.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]),
  );
}

function difference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

export function inspectMessageParity(reference, candidate) {
  const referenceMessages = flattenScalarMessages(reference);
  const candidateMessages = flattenScalarMessages(candidate);
  const referenceKeys = new Set(referenceMessages.keys());
  const candidateKeys = new Set(candidateMessages.keys());
  const missingKeys = difference(referenceKeys, candidateKeys);
  const extraKeys = difference(candidateKeys, referenceKeys);
  const placeholderMismatches = [];

  for (const key of [...referenceKeys].sort()) {
    if (!candidateMessages.has(key)) continue;
    const expected = extractPlaceholders(referenceMessages.get(key));
    const actual = extractPlaceholders(candidateMessages.get(key));
    const missing = difference(expected, actual);
    const extra = difference(actual, expected);
    if (missing.length > 0 || extra.length > 0) {
      placeholderMismatches.push({ key, missing, extra });
    }
  }

  return {
    referenceCount: referenceMessages.size,
    candidateCount: candidateMessages.size,
    missingKeys,
    extraKeys,
    placeholderMismatches,
  };
}

export function formatMessageParityFailures(result) {
  const failures = [];
  if (result.missingKeys.length > 0) {
    failures.push(`Missing message keys: ${result.missingKeys.join(", ")}`);
  }
  if (result.extraKeys.length > 0) {
    failures.push(`Extra message keys: ${result.extraKeys.join(", ")}`);
  }
  for (const mismatch of result.placeholderMismatches) {
    failures.push(
      `Placeholder mismatch at ${mismatch.key}: missing=[${mismatch.missing.join(", ")}], extra=[${mismatch.extra.join(", ")}]`,
    );
  }
  return failures;
}

async function readMessages(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [english, korean] = await Promise.all([
    readMessages(path.join(root, "messages", "en.json")),
    readMessages(path.join(root, "messages", "ko.json")),
  ]);
  const result = inspectMessageParity(english, korean);
  const failures = formatMessageParityFailures(result);

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Message parity check passed: en=${result.referenceCount}, ko=${result.candidateCount}.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
