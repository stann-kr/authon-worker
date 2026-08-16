import {
  getContributorNameKey,
  normalizeContributorDisplayName,
} from "./domain.ts";

const EXTERNAL_DJ_ID_NAMESPACE = "authon:external-dj:v1";
const EXTERNAL_DJ_MAPPING_AUDIT_NAMESPACE =
  "authon:external-dj:mapping-audit:v1";
const DEFAULT_SUGGESTION_LIMIT = 8;

export interface ExternalDjSuggestionLike {
  contributorId: string;
  displayName: string;
  linkCount: number;
  lastUsedDate: string | null;
}

export interface ExternalDjBackfillContributor {
  id: string;
  venueId: string;
  displayName: string;
  nameKey: string | null;
  active: boolean;
}

export interface ExternalDjBackfillLink {
  id: string;
  venueId: string;
  djName: string;
  contributorId: string | null;
  kind: string;
  deletedAt: string | null;
  createdAt: string | null;
}

export interface ExternalDjBackfillGroup {
  venueId: string;
  nameKey: string;
  displayName: string;
  contributorId: string;
  shouldCreateContributor: boolean;
  sourceIdsToMap: string[];
  archivedSourceIdsToMap: string[];
  totalSourceCount: number;
}

export interface ExternalDjBackfillNameKeyUpdate {
  contributorId: string;
  venueId: string;
  nameKey: string;
}

export type ExternalDjBackfillConflictReason =
  | "invalid_contributor_name"
  | "contributor_name_key_mismatch"
  | "invalid_link_name"
  | "multiple_directory_entries"
  | "multiple_mapped_contributors"
  | "mapping_directory_mismatch";

export interface ExternalDjBackfillConflict {
  venueId: string;
  reason: ExternalDjBackfillConflictReason;
  sourceCount: number;
}

export interface ExternalDjBackfillPlan {
  groups: ExternalDjBackfillGroup[];
  contributorNameKeyUpdates: ExternalDjBackfillNameKeyUpdate[];
  conflicts: ExternalDjBackfillConflict[];
}

function compareSuggestionRecency(
  left: ExternalDjSuggestionLike,
  right: ExternalDjSuggestionLike,
): number {
  return (
    (right.lastUsedDate ?? "").localeCompare(left.lastUsedDate ?? "") ||
    right.linkCount - left.linkCount ||
    left.displayName.localeCompare(right.displayName)
  );
}

function suggestionMatchRank(displayName: string, queryKey: string): number {
  const nameKey = getContributorNameKey(displayName) ?? "";
  if (nameKey === queryKey) return 0;
  if (nameKey.startsWith(queryKey)) return 1;
  const parts = nameKey.split(" ");
  if (parts.some((part) => part === queryKey)) return 2;
  if (parts.some((part) => part.startsWith(queryKey))) return 3;
  if (nameKey.includes(queryKey)) return 4;
  return 5;
}

export function filterExternalDjSuggestions<T extends ExternalDjSuggestionLike>(
  suggestions: readonly T[],
  query: string,
  limit = DEFAULT_SUGGESTION_LIMIT,
): T[] {
  const queryKey = getContributorNameKey(query);
  const candidates = queryKey
    ? suggestions.filter(
        (suggestion) => suggestionMatchRank(suggestion.displayName, queryKey) < 5,
      )
    : [...suggestions];
  return candidates
    .sort((left, right) => {
      if (queryKey) {
        const rankDifference =
          suggestionMatchRank(left.displayName, queryKey) -
          suggestionMatchRank(right.displayName, queryKey);
        if (rankDifference !== 0) return rankDifference;
      }
      return compareSuggestionRecency(left, right);
    })
    .slice(0, Math.max(0, limit));
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getExternalDjContributorId(
  venueId: string,
  nameKey: string,
): Promise<string> {
  if (!venueId || !nameKey) throw new Error("INVALID_EXTERNAL_DJ_IDENTITY");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${EXTERNAL_DJ_ID_NAMESPACE}\u0000${venueId}\u0000${nameKey}`,
    ),
  );
  return `dj_${bytesToHex(digest)}`;
}

export async function getExternalDjMappedAuditId(
  contributorId: string,
  sourceId: string,
): Promise<string> {
  if (!contributorId || !sourceId) {
    throw new Error("INVALID_EXTERNAL_DJ_IDENTITY");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${EXTERNAL_DJ_MAPPING_AUDIT_NAMESPACE}\u0000${contributorId}\u0000${sourceId}`,
    ),
  );
  return `audit_map_${bytesToHex(digest)}`;
}

export function getExternalDjCreatedAuditId(contributorId: string): string {
  if (!contributorId) throw new Error("INVALID_EXTERNAL_DJ_IDENTITY");
  return `audit_created_${contributorId}`;
}

function groupKey(venueId: string, nameKey: string): string {
  return `${venueId}\u0000${nameKey}`;
}

function latestDisplayName(links: readonly ExternalDjBackfillLink[]): string {
  const latest = [...links].sort(
    (left, right) =>
      (right.createdAt ?? "").localeCompare(left.createdAt ?? "") ||
      right.id.localeCompare(left.id),
  )[0];
  return normalizeContributorDisplayName(latest?.djName) ?? "";
}

export async function planExternalDjContributorBackfill(params: {
  contributors: readonly ExternalDjBackfillContributor[];
  links: readonly ExternalDjBackfillLink[];
}): Promise<ExternalDjBackfillPlan> {
  const conflicts: ExternalDjBackfillConflict[] = [];
  const contributorsById = new Map(
    params.contributors.map((contributor) => [contributor.id, contributor]),
  );
  const linksByGroup = new Map<string, ExternalDjBackfillLink[]>();
  const externallyMappedContributorIds = new Set<string>();
  for (const link of params.links) {
    if (link.kind !== "contributor") continue;
    if (link.contributorId) {
      externallyMappedContributorIds.add(link.contributorId);
    }
    const nameKey = getContributorNameKey(link.djName);
    if (!nameKey) {
      conflicts.push({
        venueId: link.venueId,
        reason: "invalid_link_name",
        sourceCount: 1,
      });
      continue;
    }
    const key = groupKey(link.venueId, nameKey);
    linksByGroup.set(key, [...(linksByGroup.get(key) ?? []), link]);
  }

  const contributorsByGroup = new Map<string, ExternalDjBackfillContributor[]>();
  const contributorNameKeyUpdates: ExternalDjBackfillNameKeyUpdate[] = [];

  for (const contributor of params.contributors) {
    const isExternalDirectoryContributor =
      contributor.nameKey !== null ||
      externallyMappedContributorIds.has(contributor.id);
    if (!isExternalDirectoryContributor) continue;
    const nameKey = getContributorNameKey(contributor.displayName);
    if (!nameKey) {
      conflicts.push({
        venueId: contributor.venueId,
        reason: "invalid_contributor_name",
        sourceCount: 0,
      });
      continue;
    }
    if (contributor.nameKey !== null && contributor.nameKey !== nameKey) {
      conflicts.push({
        venueId: contributor.venueId,
        reason: "contributor_name_key_mismatch",
        sourceCount: 0,
      });
      continue;
    }
    if (contributor.nameKey === null) {
      contributorNameKeyUpdates.push({
        contributorId: contributor.id,
        venueId: contributor.venueId,
        nameKey,
      });
    }
    const key = groupKey(contributor.venueId, nameKey);
    contributorsByGroup.set(key, [
      ...(contributorsByGroup.get(key) ?? []),
      contributor,
    ]);
  }

  const duplicateDirectoryKeys = new Set<string>();
  for (const [key, directoryEntries] of contributorsByGroup) {
    if (directoryEntries.length < 2) continue;
    duplicateDirectoryKeys.add(key);
    conflicts.push({
      venueId: directoryEntries[0].venueId,
      reason: "multiple_directory_entries",
      sourceCount: linksByGroup.get(key)?.length ?? 0,
    });
  }

  const groups: ExternalDjBackfillGroup[] = [];
  for (const [key, links] of [...linksByGroup.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const separatorIndex = key.indexOf("\u0000");
    const venueId = key.slice(0, separatorIndex);
    const nameKey = key.slice(separatorIndex + 1);
    const directoryEntries = contributorsByGroup.get(key) ?? [];
    if (duplicateDirectoryKeys.has(key)) continue;

    const mappedContributorIds = new Set(
      links.flatMap((link) => (link.contributorId ? [link.contributorId] : [])),
    );
    if (mappedContributorIds.size > 1) {
      conflicts.push({
        venueId,
        reason: "multiple_mapped_contributors",
        sourceCount: links.length,
      });
      continue;
    }

    const mappedContributorId = [...mappedContributorIds][0] ?? null;
    const directoryContributorId = directoryEntries[0]?.id ?? null;
    if (
      mappedContributorId &&
      directoryContributorId &&
      mappedContributorId !== directoryContributorId
    ) {
      conflicts.push({
        venueId,
        reason: "mapping_directory_mismatch",
        sourceCount: links.length,
      });
      continue;
    }

    const contributorId =
      mappedContributorId ??
      directoryContributorId ??
      (await getExternalDjContributorId(venueId, nameKey));
    const contributor = contributorsById.get(contributorId);
    if (
      contributor &&
      (contributor.venueId !== venueId ||
        getContributorNameKey(contributor.displayName) !== nameKey)
    ) {
      conflicts.push({
        venueId,
        reason: "mapping_directory_mismatch",
        sourceCount: links.length,
      });
      continue;
    }
    const sourceIdsToMap = links
      .filter((link) => link.contributorId !== contributorId)
      .map((link) => link.id)
      .sort();
    groups.push({
      venueId,
      nameKey,
      displayName: directoryEntries[0]?.displayName ?? latestDisplayName(links),
      contributorId,
      shouldCreateContributor: !contributorsById.has(contributorId),
      sourceIdsToMap,
      archivedSourceIdsToMap: links
        .filter(
          (link) =>
            link.deletedAt !== null && link.contributorId !== contributorId,
        )
        .map((link) => link.id)
        .sort(),
      totalSourceCount: links.length,
    });
  }

  return {
    groups,
    contributorNameKeyUpdates: contributorNameKeyUpdates
      .filter((update) => {
        const key = groupKey(update.venueId, update.nameKey);
        return !duplicateDirectoryKeys.has(key);
      })
      .sort(
        (left, right) =>
          left.venueId.localeCompare(right.venueId) ||
          left.nameKey.localeCompare(right.nameKey) ||
          left.contributorId.localeCompare(right.contributorId),
      ),
    conflicts,
  };
}

export function toSafeExternalDjBackfillReport(plan: ExternalDjBackfillPlan) {
  return {
    mode: "read_only" as const,
    writesPerformed: 0,
    totals: {
      groups: plan.groups.length,
      contributorsToCreate: plan.groups.filter(
        (group) => group.shouldCreateContributor,
      ).length,
      sources: plan.groups.reduce(
        (total, group) => total + group.totalSourceCount,
        0,
      ),
      sourcesToMap: plan.groups.reduce(
        (total, group) => total + group.sourceIdsToMap.length,
        0,
      ),
      archivedSourcesToMap: plan.groups.reduce(
        (total, group) => total + group.archivedSourceIdsToMap.length,
        0,
      ),
      contributorNameKeysToSet: plan.contributorNameKeyUpdates.length,
      conflicts: plan.conflicts.length,
    },
    conflictsByReason: Object.fromEntries(
      [...new Set(plan.conflicts.map((conflict) => conflict.reason))]
        .sort()
        .map((reason) => [
          reason,
          plan.conflicts.filter((conflict) => conflict.reason === reason).length,
        ]),
    ),
  };
}
