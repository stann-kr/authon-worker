import assert from "node:assert/strict";
import test from "node:test";

import {
  filterExternalDjSuggestions,
  getExternalDjContributorId,
  getExternalDjMappedAuditId,
  planExternalDjContributorBackfill,
  toSafeExternalDjBackfillReport,
} from "./external-dj.ts";

test("DJ suggestions prefer exact and prefix matches before recent partial matches", () => {
  const suggestions = [
    {
      contributorId: "late",
      displayName: "THE STANN PROJECT",
      linkCount: 10,
      lastUsedDate: "2026-08-15",
    },
    {
      contributorId: "exact",
      displayName: "DJ STANN",
      linkCount: 2,
      lastUsedDate: "2026-08-01",
    },
    {
      contributorId: "prefix",
      displayName: "DJ STANN B2B NOVA",
      linkCount: 3,
      lastUsedDate: "2026-08-10",
    },
  ];

  assert.deepEqual(
    filterExternalDjSuggestions(suggestions, "dj stann").map(
      (suggestion) => suggestion.contributorId,
    ),
    ["exact", "prefix"],
  );
  assert.deepEqual(
    filterExternalDjSuggestions(suggestions, "stann").map(
      (suggestion) => suggestion.contributorId,
    ),
    ["late", "prefix", "exact"],
  );
});

test("external DJ contributor IDs are stable per venue and normalized name", async () => {
  const first = await getExternalDjContributorId("venue-a", "DJ STANN");
  const second = await getExternalDjContributorId("venue-a", "DJ STANN");
  const otherVenue = await getExternalDjContributorId("venue-b", "DJ STANN");
  assert.equal(first, second);
  assert.notEqual(first, otherVenue);
  assert.match(first, /^dj_[a-f0-9]{64}$/);
  const mappingAudit = await getExternalDjMappedAuditId(first, "link-a");
  assert.equal(
    mappingAudit,
    await getExternalDjMappedAuditId(first, "link-a"),
  );
  assert.match(mappingAudit, /^audit_map_[a-f0-9]{64}$/);
});

test("backfill groups same-name contributor links per venue and includes archives", async () => {
  const plan = await planExternalDjContributorBackfill({
    contributors: [],
    links: [
      {
        id: "link-new",
        venueId: "venue-a",
        djName: "DJ STANN",
        contributorId: null,
        kind: "contributor",
        deletedAt: null,
        createdAt: "2026-08-15T00:00:00.000Z",
      },
      {
        id: "link-old",
        venueId: "venue-a",
        djName: "  dj   stann ",
        contributorId: null,
        kind: "contributor",
        deletedAt: "2026-08-14T00:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "link-other-venue",
        venueId: "venue-b",
        djName: "DJ STANN",
        contributorId: null,
        kind: "contributor",
        deletedAt: null,
        createdAt: "2026-08-15T00:00:00.000Z",
      },
      {
        id: "self-rsvp",
        venueId: "venue-a",
        djName: "DJ STANN",
        contributorId: null,
        kind: "self_rsvp",
        deletedAt: null,
        createdAt: "2026-08-15T00:00:00.000Z",
      },
    ],
  });

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.groups.length, 2);
  const venueA = plan.groups.find((group) => group.venueId === "venue-a");
  const venueB = plan.groups.find((group) => group.venueId === "venue-b");
  assert.deepEqual(venueA?.sourceIdsToMap, ["link-new", "link-old"]);
  assert.deepEqual(venueA?.archivedSourceIdsToMap, ["link-old"]);
  assert.equal(venueA?.displayName, "DJ STANN");
  assert.notEqual(venueA?.contributorId, venueB?.contributorId);
  assert.deepEqual(toSafeExternalDjBackfillReport(plan).totals, {
    groups: 2,
    contributorsToCreate: 2,
    sources: 3,
    sourcesToMap: 3,
    archivedSourcesToMap: 1,
    contributorNameKeysToSet: 0,
    conflicts: 0,
  });
});

test("backfill fills legacy directory keys without exposing contributor names", async () => {
  const plan = await planExternalDjContributorBackfill({
    contributors: [
      {
        id: "contributor-a",
        venueId: "venue-a",
        displayName: " DJ  STANN ",
        nameKey: null,
        active: true,
      },
    ],
    links: [
      {
        id: "link-a",
        venueId: "venue-a",
        djName: "DJ STANN",
        contributorId: "contributor-a",
        kind: "contributor",
        deletedAt: null,
        createdAt: null,
      },
    ],
  });

  assert.deepEqual(plan.contributorNameKeyUpdates, [
    {
      contributorId: "contributor-a",
      venueId: "venue-a",
      nameKey: "DJ STANN",
    },
  ]);
  assert.equal(
    toSafeExternalDjBackfillReport(plan).totals.contributorNameKeysToSet,
    1,
  );
  assert.equal(
    JSON.stringify(toSafeExternalDjBackfillReport(plan)).includes("STANN"),
    false,
  );
});

test("backfill does not reuse an internal-only Contributor with the same name", async () => {
  const plan = await planExternalDjContributorBackfill({
    contributors: [
      {
        id: "internal-contributor",
        venueId: "venue-a",
        displayName: "DJ STANN",
        nameKey: null,
        active: true,
      },
    ],
    links: [
      {
        id: "external-link",
        venueId: "venue-a",
        djName: "DJ STANN",
        contributorId: null,
        kind: "contributor",
        deletedAt: null,
        createdAt: null,
      },
    ],
  });

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.contributorNameKeyUpdates.length, 0);
  assert.equal(plan.groups[0]?.shouldCreateContributor, true);
  assert.notEqual(plan.groups[0]?.contributorId, "internal-contributor");
});

test("backfill refuses conflicting canonical mappings instead of guessing", async () => {
  const plan = await planExternalDjContributorBackfill({
    contributors: [
      {
        id: "contributor-a",
        venueId: "venue-a",
        displayName: "DJ SAME",
        nameKey: "DJ SAME",
        active: true,
      },
      {
        id: "contributor-b",
        venueId: "venue-a",
        displayName: "DJ SAME",
        nameKey: "DJ SAME",
        active: true,
      },
    ],
    links: [
      {
        id: "link-a",
        venueId: "venue-a",
        djName: "DJ SAME",
        contributorId: "contributor-a",
        kind: "contributor",
        deletedAt: null,
        createdAt: null,
      },
    ],
  });

  assert.equal(plan.groups.length, 0);
  assert.equal(plan.conflicts[0]?.reason, "multiple_directory_entries");
  const serialized = JSON.stringify(toSafeExternalDjBackfillReport(plan));
  assert.equal(serialized.includes("DJ SAME"), false);
  assert.equal(serialized.includes("link-a"), false);
});
