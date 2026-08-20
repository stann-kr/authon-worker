import type { D1Database } from "@cloudflare/workers-types";

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
