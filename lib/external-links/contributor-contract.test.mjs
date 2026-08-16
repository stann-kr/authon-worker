import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../api/external-links.ts", import.meta.url),
  "utf8",
);

test("external DJ directory is role, tenant, and active-contributor scoped", () => {
  const start = source.indexOf("export async function fetchExternalDjDirectory");
  const end = source.indexOf("async function resolveExternalDjContributor", start);
  const directorySource = source.slice(start, end);

  assert.match(directorySource, /requireRole\(\["super_admin", "venue_admin"\]\)/);
  assert.match(directorySource, /scopedVenueId\(user, venueId\)/);
  assert.match(
    directorySource,
    /eq\(venueContributors\.venueId, effectiveVenueId\)/,
  );
  assert.match(directorySource, /eq\(venueContributors\.active, true\)/);
  assert.match(directorySource, /isNotNull\(venueContributors\.nameKey\)/);
  assert.match(directorySource, /MAX_EXTERNAL_DJ_DIRECTORY_ROWS \+ 1/);
});

test("external contributor links resolve canonical names and write mapping audits atomically", () => {
  const start = source.indexOf("export async function createExternalLink");
  const end = source.indexOf("export async function deleteExternalLink", start);
  const createSource = source.slice(start, end);

  assert.match(createSource, /resolveExternalDjContributor/);
  assert.match(createSource, /contributor\?\.displayName \?\? draft\.djName/);
  assert.match(createSource, /contributorId: contributor\?\.id \?\? null/);
  assert.match(createSource, /sourceKind: "external_link"/);
  assert.match(createSource, /action: "mapped"/);
  assert.match(createSource, /await db\.batch\(\[/);
  assert.match(createSource, /insert\(venueContributors\)/);
  assert.match(createSource, /insert\(contributorAuditEvents\)/);
});

test("public token validation omits the canonical Contributor identifier", () => {
  const start = source.indexOf("export async function validateExternalToken");
  const end = source.indexOf("interface PendingExternalBulkGuest", start);
  const validationSource = source.slice(start, end);

  assert.match(validationSource, /const publicLink = toExternalDJLink\(link\)/);
  assert.match(validationSource, /delete publicLink\.contributorId/);
  assert.match(validationSource, /link: \{\s*\.\.\.publicLink/);
});
