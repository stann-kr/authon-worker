import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const sourcePath = join(process.cwd(), "app/admin/components/linkStatus.ts");
const source = await readFile(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  },
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
const {
  deriveLinkStatus,
  filterLinksByManageFilter,
  formatRelativeExpiry,
} = await import(moduleUrl);

const now = Date.parse("2026-06-29T12:00:00.000Z");
const links = [
  {
    id: "active",
    active: true,
    expiresAt: "2026-06-30T13:00:00.000Z",
    usedGuests: 1,
    maxGuests: 3,
  },
  {
    id: "soon",
    active: true,
    expiresAt: "2026-06-29T13:30:00.000Z",
    usedGuests: 2,
    maxGuests: 3,
  },
  {
    id: "expired-active",
    active: true,
    expiresAt: "2026-06-29T11:59:00.000Z",
    usedGuests: 0,
    maxGuests: 3,
  },
  {
    id: "inactive",
    active: false,
    expiresAt: "2026-06-30T13:00:00.000Z",
    usedGuests: 0,
    maxGuests: 3,
  },
  {
    id: "full",
    active: true,
    expiresAt: "2026-06-30T13:00:00.000Z",
    usedGuests: 3,
    maxGuests: 3,
  },
];

assert.deepEqual(
  filterLinksByManageFilter(links, "active", now).map((link) => link.id),
  ["active", "soon", "full"],
);
assert.deepEqual(
  filterLinksByManageFilter(links, "inactive", now).map((link) => link.id),
  ["inactive"],
);
assert.deepEqual(
  filterLinksByManageFilter(links, "expired", now).map((link) => link.id),
  ["expired-active"],
);
assert.deepEqual(
  filterLinksByManageFilter(links, "expiring-soon", now).map((link) => link.id),
  ["soon"],
);
assert.deepEqual(
  filterLinksByManageFilter(links, "full", now).map((link) => link.id),
  ["full"],
);

assert.equal(formatRelativeExpiry("2026-06-29T13:30:00.000Z", now), "EXPIRES IN 1H 30M");
assert.equal(formatRelativeExpiry("2026-06-29T11:59:00.000Z", now), "EXPIRED 1M AGO");
assert.equal(formatRelativeExpiry("not-a-date", now), "INVALID EXPIRY");

assert.deepEqual(deriveLinkStatus(links[1], now), {
  expired: false,
  expiringSoon: true,
  full: false,
  active: true,
  inactive: false,
  usagePercent: 66.66666666666666,
});

assert.deepEqual(deriveLinkStatus(links[2], now), {
  expired: true,
  expiringSoon: false,
  full: false,
  active: false,
  inactive: false,
  usagePercent: 0,
});

console.log("link status verification passed");
