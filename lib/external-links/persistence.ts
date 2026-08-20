import type { D1Database } from "@cloudflare/workers-types";
import type { ExternalDjSuggestion } from "../contributors/types.ts";

export interface ExternalLinkLifecycleTarget {
  id: string;
  venueId: string;
  date: string | null;
  expiresAt: string | null;
}

export type ExternalLinkLifecycleVenueScope =
  | { kind: "global" }
  | { kind: "venue"; venueId: string };

export interface ExternalLinkLifecyclePersistence {
  loadUndeletedTarget(input: {
    linkId: string;
    venueScope: ExternalLinkLifecycleVenueScope;
  }): Promise<ExternalLinkLifecycleTarget | null>;
  isVenueActive(venueId: string): Promise<boolean>;
  deactivateUndeletedForDeletion(linkId: string): Promise<void>;
  hasGuestHistory(linkId: string): Promise<boolean>;
  archiveUndeleted(input: {
    linkId: string;
    deletedBy: string;
    deletedAt: string;
  }): Promise<void>;
  hardDeleteUndeleted(linkId: string): Promise<void>;
  setActiveById(linkId: string, active: boolean): Promise<void>;
}

export interface ExternalLinkAdminContributor {
  id: string;
  venueId: string;
  displayName: string;
  nameKey: string | null;
  active: boolean;
}

export interface ExternalLinkAdminRecord {
  id: string;
  venueId: string;
  token: string;
  djName: string;
  contributorId: string | null;
  event: string | null;
  date: string | null;
  eventId: string | null;
  maxGuests: number;
  usedGuests: number;
  active: boolean;
  expiresAt: string | null;
  createdBy: string | null;
  localeMode: string;
  kind: string;
  createdAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
}

export interface ExternalLinkAdminCreateWrite {
  link: {
    id: string;
    venueId: string;
    token: string;
    djName: string;
    contributorId: string | null;
    event: string;
    date: string;
    eventId: string;
    maxGuests: number;
    localeMode: string;
    kind: string;
    expiresAt: string;
    createdBy: string;
    createdAt: string;
  };
  contributor: {
    id: string;
    venueId: string;
    displayName: string;
    nameKey: string;
    shouldCreate: boolean;
  } | null;
  createdAuditId: string | null;
  mappingAuditId: string | null;
}

export interface ExternalLinkAdminPersistence {
  isVenueActive(venueId: string): Promise<boolean>;
  listContributorDirectory(
    venueId: string,
    limit: number,
  ): Promise<ExternalDjSuggestion[]>;
  loadContributor(input: {
    venueId: string;
    contributorId: string | null;
    nameKey: string;
  }): Promise<ExternalLinkAdminContributor | null>;
  createExternalLink(
    input: ExternalLinkAdminCreateWrite,
  ): Promise<ExternalLinkAdminRecord | null>;
}

const SELECT_GLOBAL_TARGET_SQL = `
  SELECT
    id,
    venue_id AS venueId,
    date,
    expires_at AS expiresAt
  FROM external_dj_links
  WHERE id = ? AND deleted_at IS NULL
  LIMIT 1
`;

const SELECT_VENUE_TARGET_SQL = `
  SELECT
    id,
    venue_id AS venueId,
    date,
    expires_at AS expiresAt
  FROM external_dj_links
  WHERE id = ? AND venue_id = ? AND deleted_at IS NULL
  LIMIT 1
`;

const SELECT_ACTIVE_VENUE_SQL = `
  SELECT id
  FROM venues
  WHERE id = ? AND active = 1
  LIMIT 1
`;

const DEACTIVATE_UNDELETED_FOR_DELETION_SQL = `
  UPDATE external_dj_links
  SET active = 0
  WHERE id = ? AND deleted_at IS NULL
`;

const SELECT_GUEST_HISTORY_SQL = `
  SELECT id
  FROM guests
  WHERE external_link_id = ?
  LIMIT 1
`;

const ARCHIVE_UNDELETED_SQL = `
  UPDATE external_dj_links
  SET active = 0, deleted_at = ?, deleted_by = ?
  WHERE id = ? AND deleted_at IS NULL
`;

const HARD_DELETE_UNDELETED_SQL = `
  DELETE FROM external_dj_links
  WHERE id = ? AND deleted_at IS NULL
`;

const SET_ACTIVE_BY_ID_SQL = `
  UPDATE external_dj_links
  SET active = ?
  WHERE id = ?
`;

const SELECT_CONTRIBUTOR_DIRECTORY_SQL = `
  SELECT
    contributor.id AS contributorId,
    contributor.display_name AS displayName,
    count(link.id) AS linkCount,
    max(link.date) AS lastUsedDate
  FROM venue_contributors AS contributor
  LEFT JOIN external_dj_links AS link
    ON link.contributor_id = contributor.id
    AND link.kind = 'contributor'
  WHERE
    contributor.venue_id = ?
    AND contributor.active = 1
    AND contributor.name_key IS NOT NULL
  GROUP BY contributor.id, contributor.display_name
  ORDER BY max(link.date) DESC, contributor.display_name ASC
  LIMIT ?
`;

const SELECT_CONTRIBUTOR_BY_ID_SQL = `
  SELECT
    id,
    venue_id AS venueId,
    display_name AS displayName,
    name_key AS nameKey,
    active
  FROM venue_contributors
  WHERE venue_id = ? AND id = ?
  LIMIT 1
`;

const SELECT_CONTRIBUTOR_BY_NAME_KEY_SQL = `
  SELECT
    id,
    venue_id AS venueId,
    display_name AS displayName,
    name_key AS nameKey,
    active
  FROM venue_contributors
  WHERE venue_id = ? AND name_key = ?
  LIMIT 1
`;

const INSERT_CONTRIBUTOR_SQL = `
  INSERT INTO venue_contributors (
    id, venue_id, display_name, name_key, kind, active, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'dj', 1, ?, ?)
  ON CONFLICT DO NOTHING
`;

const INSERT_CONTRIBUTOR_CREATED_AUDIT_SQL = `
  INSERT INTO contributor_audit_events (
    id, venue_id, contributor_id, actor_user_id, source_kind, source_id,
    action, details, created_at
  ) VALUES (?, ?, ?, ?, 'contributor', ?, 'created', ?, ?)
  ON CONFLICT DO NOTHING
`;

const INSERT_EXTERNAL_LINK_SQL = `
  INSERT INTO external_dj_links (
    id, venue_id, token, dj_name, contributor_id, event, date, event_id,
    max_guests, used_guests, active, expires_at, created_by, locale_mode,
    kind, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)
`;

const INSERT_CONTRIBUTOR_MAPPING_AUDIT_SQL = `
  INSERT INTO contributor_audit_events (
    id, venue_id, contributor_id, actor_user_id, source_kind, source_id,
    action, details, created_at
  ) VALUES (?, ?, ?, ?, 'external_link', ?, 'mapped', ?, ?)
`;

const SELECT_EXTERNAL_LINK_BY_ID_SQL = `
  SELECT
    id,
    venue_id AS venueId,
    token,
    dj_name AS djName,
    contributor_id AS contributorId,
    event,
    date,
    event_id AS eventId,
    max_guests AS maxGuests,
    used_guests AS usedGuests,
    active,
    expires_at AS expiresAt,
    created_by AS createdBy,
    locale_mode AS localeMode,
    kind,
    created_at AS createdAt,
    deleted_at AS deletedAt,
    deleted_by AS deletedBy
  FROM external_dj_links
  WHERE id = ?
  LIMIT 1
`;

function toBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

function toAdminContributor(
  row: Omit<ExternalLinkAdminContributor, "active"> & { active: unknown },
): ExternalLinkAdminContributor {
  return { ...row, active: toBoolean(row.active) };
}

function toAdminRecord(
  row: Omit<ExternalLinkAdminRecord, "active"> & { active: unknown },
): ExternalLinkAdminRecord {
  return { ...row, active: toBoolean(row.active) };
}

export function createExternalLinkLifecyclePersistence(
  database: D1Database,
): ExternalLinkLifecyclePersistence {
  return {
    async loadUndeletedTarget({ linkId, venueScope }) {
      const statement =
        venueScope.kind === "global"
          ? database.prepare(SELECT_GLOBAL_TARGET_SQL).bind(linkId)
          : database
              .prepare(SELECT_VENUE_TARGET_SQL)
              .bind(linkId, venueScope.venueId);
      return statement.first<ExternalLinkLifecycleTarget>();
    },

    async isVenueActive(venueId) {
      const venue = await database
        .prepare(SELECT_ACTIVE_VENUE_SQL)
        .bind(venueId)
        .first<{ id: string }>();
      return Boolean(venue);
    },

    async deactivateUndeletedForDeletion(linkId) {
      await database
        .prepare(DEACTIVATE_UNDELETED_FOR_DELETION_SQL)
        .bind(linkId)
        .run();
    },

    async hasGuestHistory(linkId) {
      const guest = await database
        .prepare(SELECT_GUEST_HISTORY_SQL)
        .bind(linkId)
        .first<{ id: string }>();
      return Boolean(guest);
    },

    async archiveUndeleted({ linkId, deletedBy, deletedAt }) {
      await database
        .prepare(ARCHIVE_UNDELETED_SQL)
        .bind(deletedAt, deletedBy, linkId)
        .run();
    },

    async hardDeleteUndeleted(linkId) {
      await database
        .prepare(HARD_DELETE_UNDELETED_SQL)
        .bind(linkId)
        .run();
    },

    async setActiveById(linkId, active) {
      // Preserve the legacy id-only final mutation until the integrity slice.
      await database
        .prepare(SET_ACTIVE_BY_ID_SQL)
        .bind(active ? 1 : 0, linkId)
        .run();
    },
  };
}

export function createExternalLinkAdminPersistence(
  database: D1Database,
): ExternalLinkAdminPersistence {
  return {
    async isVenueActive(venueId) {
      const venue = await database
        .prepare(SELECT_ACTIVE_VENUE_SQL)
        .bind(venueId)
        .first<{ id: string }>();
      return Boolean(venue);
    },

    async listContributorDirectory(venueId, limit) {
      const result = await database
        .prepare(SELECT_CONTRIBUTOR_DIRECTORY_SQL)
        .bind(venueId, limit)
        .all<ExternalDjSuggestion>();
      return result.results.map((row) => ({
        ...row,
        linkCount: Number(row.linkCount),
      }));
    },

    async loadContributor({ venueId, contributorId, nameKey }) {
      const statement = contributorId
        ? database
            .prepare(SELECT_CONTRIBUTOR_BY_ID_SQL)
            .bind(venueId, contributorId)
        : database
            .prepare(SELECT_CONTRIBUTOR_BY_NAME_KEY_SQL)
            .bind(venueId, nameKey);
      const row = await statement.first<
        Omit<ExternalLinkAdminContributor, "active"> & { active: unknown }
      >();
      return row ? toAdminContributor(row) : null;
    },

    async createExternalLink({
      link,
      contributor,
      createdAuditId,
      mappingAuditId,
    }) {
      const linkInsert = database
        .prepare(INSERT_EXTERNAL_LINK_SQL)
        .bind(
          link.id,
          link.venueId,
          link.token,
          link.djName,
          link.contributorId,
          link.event,
          link.date,
          link.eventId,
          link.maxGuests,
          link.expiresAt,
          link.createdBy,
          link.localeMode,
          link.kind,
          link.createdAt,
        );

      if (contributor) {
        if (!mappingAuditId) throw new Error("Missing contributor mapping audit ID");
        const mappingAudit = database
          .prepare(INSERT_CONTRIBUTOR_MAPPING_AUDIT_SQL)
          .bind(
            mappingAuditId,
            link.venueId,
            contributor.id,
            link.createdBy,
            link.id,
            JSON.stringify({ reason: "external_link_create" }),
            link.createdAt,
          );
        if (contributor.shouldCreate) {
          if (!createdAuditId) throw new Error("Missing contributor created audit ID");
          await database.batch([
            database
              .prepare(INSERT_CONTRIBUTOR_SQL)
              .bind(
                contributor.id,
                contributor.venueId,
                contributor.displayName,
                contributor.nameKey,
                link.createdAt,
                link.createdAt,
              ),
            database
              .prepare(INSERT_CONTRIBUTOR_CREATED_AUDIT_SQL)
              .bind(
                createdAuditId,
                link.venueId,
                contributor.id,
                link.createdBy,
                contributor.id,
                JSON.stringify({ kind: "dj", source: "external_link_create" }),
                link.createdAt,
              ),
            linkInsert,
            mappingAudit,
          ]);
        } else {
          await database.batch([linkInsert, mappingAudit]);
        }
      } else {
        await linkInsert.run();
      }

      const row = await database
        .prepare(SELECT_EXTERNAL_LINK_BY_ID_SQL)
        .bind(link.id)
        .first<Omit<ExternalLinkAdminRecord, "active"> & { active: unknown }>();
      return row ? toAdminRecord(row) : null;
    },
  };
}
