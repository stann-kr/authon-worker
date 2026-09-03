import type { D1Database } from "@cloudflare/workers-types";
import type { ExternalDjSuggestion } from "../contributors/types.ts";
import type { AccountKind, Role } from "../users/policy.ts";

export interface ExternalLinkMutationActor {
  userId: string;
  role: Role;
  accountKind: AccountKind;
  venueId: string | null;
  sessionVersion: number;
}

export interface ExternalLinkLifecycleTarget {
  id: string;
  venueId: string;
  date: string | null;
  expiresAt: string | null;
  active: boolean;
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
  deleteManaged(input: {
    linkId: string;
    venueId: string;
    deletedAt: string;
    actor: ExternalLinkMutationActor;
  }): Promise<"archived" | "deleted" | null>;
  deactivateManaged(input: {
    linkId: string;
    venueId: string;
    expectedActive: boolean;
    actor: ExternalLinkMutationActor;
  }): Promise<boolean>;
  activateManaged(input: {
    linkId: string;
    venueId: string;
    expectedActive: boolean;
    date: string;
    expiresAt: string | null;
    now: string;
    actor: ExternalLinkMutationActor;
  }): Promise<boolean>;
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
  actor: ExternalLinkMutationActor;
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
    expires_at AS expiresAt,
    active
  FROM external_dj_links
  WHERE id = ? AND deleted_at IS NULL
  LIMIT 1
`;

const SELECT_VENUE_TARGET_SQL = `
  SELECT
    id,
    venue_id AS venueId,
    date,
    expires_at AS expiresAt,
    active
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

const ADMIN_ACTOR_SCOPE_SQL = `
  EXISTS (
    SELECT 1
    FROM users AS mutation_actor
    WHERE mutation_actor.id = ?
      AND mutation_actor.role = ?
      AND mutation_actor.account_kind = ?
      AND mutation_actor.venue_id IS ?
      AND mutation_actor.session_version = ?
      AND mutation_actor.active = 1
      AND mutation_actor.deleted_at IS NULL
      AND mutation_actor.role IN ('super_admin', 'venue_admin')
      AND (
        mutation_actor.role = 'super_admin'
        OR mutation_actor.venue_id = external_dj_links.venue_id
      )
  )
`;

const ARCHIVE_MANAGED_WITH_HISTORY_SQL = `
  UPDATE external_dj_links
  SET active = 0, deleted_at = ?, deleted_by = ?
  WHERE
    id = ?
    AND venue_id = ?
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM venues
      WHERE venues.id = external_dj_links.venue_id AND venues.active = 1
    )
    AND ${ADMIN_ACTOR_SCOPE_SQL}
    AND EXISTS (
      SELECT 1
      FROM guests
      WHERE guests.external_link_id = external_dj_links.id
    )
  RETURNING id
`;

const HARD_DELETE_MANAGED_WITHOUT_HISTORY_SQL = `
  DELETE FROM external_dj_links
  WHERE
    id = ?
    AND venue_id = ?
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM venues
      WHERE venues.id = external_dj_links.venue_id AND venues.active = 1
    )
    AND ${ADMIN_ACTOR_SCOPE_SQL}
    AND NOT EXISTS (
      SELECT 1
      FROM guests
      WHERE guests.external_link_id = external_dj_links.id
    )
  RETURNING id
`;

const DEACTIVATE_MANAGED_SQL = `
  UPDATE external_dj_links
  SET active = 0
  WHERE
    id = ?
    AND venue_id = ?
    AND deleted_at IS NULL
    AND active IN (?, 0)
    AND EXISTS (
      SELECT 1
      FROM venues
      WHERE venues.id = external_dj_links.venue_id AND venues.active = 1
    )
    AND ${ADMIN_ACTOR_SCOPE_SQL}
  RETURNING id
`;

const ACTIVATE_MANAGED_SQL = `
  UPDATE external_dj_links
  SET active = 1
  WHERE
    id = ?
    AND venue_id = ?
    AND deleted_at IS NULL
    AND active IN (?, 1)
    AND date IS ?
    AND expires_at IS ?
    AND (
      expires_at IS NULL
      OR julianday(expires_at) IS NULL
      OR julianday(expires_at) > julianday(?)
    )
    AND EXISTS (
      SELECT 1
      FROM venues
      WHERE venues.id = external_dj_links.venue_id AND venues.active = 1
    )
    AND ${ADMIN_ACTOR_SCOPE_SQL}
  RETURNING id
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

const ACTIVE_CREATE_SCOPE_SQL = `
  EXISTS (
    SELECT 1 FROM venues
    WHERE id = ? AND active = 1
  )
  AND EXISTS (
    SELECT 1 FROM events
    WHERE id = ?
      AND venue_id = ?
      AND business_date = ?
      AND state IN ('draft', 'open')
  )
  AND EXISTS (
    SELECT 1
    FROM users AS mutation_actor
    WHERE mutation_actor.id = ?
      AND mutation_actor.role = ?
      AND mutation_actor.account_kind = ?
      AND mutation_actor.venue_id IS ?
      AND mutation_actor.session_version = ?
      AND mutation_actor.active = 1
      AND mutation_actor.deleted_at IS NULL
      AND mutation_actor.role IN ('super_admin', 'venue_admin')
      AND (
        mutation_actor.role = 'super_admin'
        OR mutation_actor.venue_id = ?
      )
  )
`;

const EXACT_ACTIVE_CONTRIBUTOR_SQL = `
  EXISTS (
    SELECT 1 FROM venue_contributors
    WHERE id = ?
      AND venue_id = ?
      AND display_name = ?
      AND name_key = ?
      AND kind = 'dj'
      AND active = 1
  )
`;

const INSERT_CONTRIBUTOR_SQL = `
  INSERT INTO venue_contributors (
    id, venue_id, display_name, name_key, kind, active, created_at, updated_at
  )
  SELECT ?, ?, ?, ?, 'dj', 1, ?, ?
  WHERE ${ACTIVE_CREATE_SCOPE_SQL}
  ON CONFLICT DO NOTHING
`;

const INSERT_CONTRIBUTOR_CREATED_AUDIT_SQL = `
  INSERT INTO contributor_audit_events (
    id, venue_id, contributor_id, actor_user_id, source_kind, source_id,
    action, details, created_at
  )
  SELECT ?, ?, ?, ?, 'contributor', ?, 'created', ?, ?
  WHERE ${ACTIVE_CREATE_SCOPE_SQL}
    AND ${EXACT_ACTIVE_CONTRIBUTOR_SQL}
  ON CONFLICT DO NOTHING
`;

const INSERT_EXTERNAL_LINK_SQL = `
  INSERT INTO external_dj_links (
    id, venue_id, token, dj_name, contributor_id, event, date, event_id,
    max_guests, used_guests, active, expires_at, created_by, locale_mode,
    kind, created_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?
  WHERE ${ACTIVE_CREATE_SCOPE_SQL}
    AND (
      (? = 'self_rsvp' AND ? IS NULL)
      OR (
        ? = 'contributor'
        AND ? IS NOT NULL
        AND ${EXACT_ACTIVE_CONTRIBUTOR_SQL}
      )
    )
`;

const INSERT_CONTRIBUTOR_MAPPING_AUDIT_SQL = `
  INSERT INTO contributor_audit_events (
    id, venue_id, contributor_id, actor_user_id, source_kind, source_id,
    action, details, created_at
  )
  SELECT ?, ?, ?, ?, 'external_link', ?, 'mapped', ?, ?
  WHERE EXISTS (
    SELECT 1 FROM external_dj_links
    WHERE id = ?
      AND venue_id = ?
      AND contributor_id IS ?
      AND created_by IS ?
      AND created_at IS ?
  )
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
    AND venue_id = ?
    AND token = ?
    AND created_by IS ?
    AND created_at IS ?
  LIMIT 1
`;

function toBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

function actorBindings(actor: ExternalLinkMutationActor) {
  return [
    actor.userId,
    actor.role,
    actor.accountKind,
    actor.venueId,
    actor.sessionVersion,
  ] as const;
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
      const row = await statement.first<
        Omit<ExternalLinkLifecycleTarget, "active"> & { active: unknown }
      >();
      return row ? { ...row, active: toBoolean(row.active) } : null;
    },

    async isVenueActive(venueId) {
      const venue = await database
        .prepare(SELECT_ACTIVE_VENUE_SQL)
        .bind(venueId)
        .first<{ id: string }>();
      return Boolean(venue);
    },

    async deleteManaged({ linkId, venueId, deletedAt, actor }) {
      const results = await database.batch<{ id?: string }>([
        database
          .prepare(ARCHIVE_MANAGED_WITH_HISTORY_SQL)
          .bind(
            deletedAt,
            actor.userId,
            linkId,
            venueId,
            ...actorBindings(actor),
          ),
        database
          .prepare(HARD_DELETE_MANAGED_WITHOUT_HISTORY_SQL)
          .bind(linkId, venueId, ...actorBindings(actor)),
      ]);
      if (results[0]?.results[0]?.id) return "archived";
      if (results[1]?.results[0]?.id) return "deleted";
      return null;
    },

    async deactivateManaged({ linkId, venueId, expectedActive, actor }) {
      const updated = await database
        .prepare(DEACTIVATE_MANAGED_SQL)
        .bind(
          linkId,
          venueId,
          expectedActive ? 1 : 0,
          ...actorBindings(actor),
        )
        .first<{ id: string }>();
      return Boolean(updated);
    },

    async activateManaged({
      linkId,
      venueId,
      expectedActive,
      date,
      expiresAt,
      now,
      actor,
    }) {
      const updated = await database
        .prepare(ACTIVATE_MANAGED_SQL)
        .bind(
          linkId,
          venueId,
          expectedActive ? 1 : 0,
          date,
          expiresAt,
          now,
          ...actorBindings(actor),
        )
        .first<{ id: string }>();
      return Boolean(updated);
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
      actor,
      link,
      contributor,
      createdAuditId,
      mappingAuditId,
    }) {
      if (
        (link.kind === "contributor" &&
          (!contributor ||
            link.contributorId !== contributor.id ||
            link.venueId !== contributor.venueId)) ||
        (link.kind === "self_rsvp" &&
          (contributor !== null || link.contributorId !== null)) ||
        (link.kind !== "contributor" && link.kind !== "self_rsvp") ||
        link.createdBy !== actor.userId
      ) {
        throw new Error("Invalid external link contributor scope");
      }
      const activeCreateScopeBindings = [
        link.venueId,
        link.eventId,
        link.venueId,
        link.date,
        ...actorBindings(actor),
        link.venueId,
      ];
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
          ...activeCreateScopeBindings,
          link.kind,
          link.contributorId,
          link.kind,
          link.contributorId,
          link.contributorId,
          link.venueId,
          contributor?.displayName ?? "",
          contributor?.nameKey ?? "",
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
            link.id,
            link.venueId,
            contributor.id,
            link.createdBy,
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
                ...activeCreateScopeBindings,
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
                ...activeCreateScopeBindings,
                contributor.id,
                contributor.venueId,
                contributor.displayName,
                contributor.nameKey,
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
        .bind(
          link.id,
          link.venueId,
          link.token,
          link.createdBy,
          link.createdAt,
        )
        .first<Omit<ExternalLinkAdminRecord, "active"> & { active: unknown }>();
      return row ? toAdminRecord(row) : null;
    },
  };
}
