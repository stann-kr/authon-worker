import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../api/external-links.ts", import.meta.url),
  "utf8",
);

test("external DJ directory entrypoint delegates to the Admin service boundary", () => {
  const start = source.indexOf("export async function fetchExternalDjDirectory");
  const end = source.indexOf("export async function createExternalLink", start);
  const directorySource = source.slice(start, end);

  assert.match(directorySource, /requireRole\(\["super_admin", "venue_admin"\]\)/);
  assert.match(directorySource, /fetchAdminExternalDjDirectory/);
  assert.match(directorySource, /getExternalLinkAdminPersistence/);
  assert.doesNotMatch(directorySource, /\.select\(|\.from\(|\.where\(/);
});

test("external link create entrypoint keeps parsing and response mapping only", () => {
  const start = source.indexOf("export async function createExternalLink");
  const end = source.indexOf("export async function deleteExternalLink", start);
  const createSource = source.slice(start, end);

  assert.match(createSource, /prepareExternalLinkCreateInput/);
  assert.match(createSource, /createAdminExternalLink/);
  assert.match(createSource, /resolveEventForRosterWrite/);
  assert.match(createSource, /addGuestUrls/);
  assert.ok(
    createSource.indexOf("scopedVenueId") <
      createSource.indexOf("prepareExternalLinkCreateInput"),
  );
  assert.doesNotMatch(createSource, /\.insert\(|\.select\(|\.batch\(/);
});

test("public entrypoints delegate token and guest behavior without raw persistence", () => {
  const start = source.indexOf("export async function validateExternalToken");
  const publicSource = source.slice(start);

  assert.match(publicSource, /validatePublicExternalToken/);
  assert.match(publicSource, /createPublicGuestsViaExternalLink/);
  assert.match(publicSource, /createPublicSelfRsvpGuest/);
  assert.match(publicSource, /updatePublicGuestViaExternalLink/);
  assert.match(publicSource, /deletePublicGuestViaExternalLink/);
  assert.doesNotMatch(
    publicSource,
    /\.select\(|\.insert\(|\.update\(|\.delete\(|\.batch\(|\.prepare\(/,
  );
});
