import type { D1Database } from "@cloudflare/workers-types";

import type { Guest } from "../guests/types.ts";
import type { Venue } from "../venues/types.ts";
import {
  buildExternalGuestReservationSql,
  DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL,
  DECREMENT_SELF_RSVP_FOR_PENDING_GUEST_SQL,
  EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL,
  INSERT_SELF_RSVP_OWNER_AFTER_GUEST_SQL,
  RESERVE_SELF_RSVP_SLOT_SQL,
  SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL,
  UPDATE_SELF_RSVP_GUEST_SQL,
} from "../guests/atomic-sql.ts";
import { prepareGuestActivityAfterChange } from "../guests/activity-ledger.ts";

export interface ExternalLinkPublicRecord {
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

/**
 * This deliberately mirrors the current Drizzle row returned by the public
 * Server Action. A public allowlist DTO is a separate security change.
 */
export interface ExternalLinkPublicGuestRecord extends Guest {
  terminalRequestId: string | null;
  source: string;
}

export type ExternalLinkPublicVenueRecord = Venue;

export interface ExternalLinkPublicBulkGuestWrite {
  id: string;
  name: string;
  activityId: string;
  requestId: string;
}

export interface ExternalLinkPublicPersistence {
  loadLinkByToken(token: string): Promise<ExternalLinkPublicRecord | null>;
  loadLinkKindByToken(token: string): Promise<string | null>;
  loadLinkById(linkId: string): Promise<ExternalLinkPublicRecord | null>;
  loadVenue(venueId: string): Promise<ExternalLinkPublicVenueRecord | null>;
  isVenueActive(venueId: string): Promise<boolean>;
  listActiveGuestsForLink(
    linkId: string,
  ): Promise<ExternalLinkPublicGuestRecord[]>;
  findOwnedGuest(input: {
    linkId: string;
    ownerKeyHash: string;
  }): Promise<ExternalLinkPublicGuestRecord | null>;
  loadGuestForLink(input: {
    guestId: string;
    linkId: string;
  }): Promise<ExternalLinkPublicGuestRecord | null>;
  loadGuestCandidate(
    guestId: string,
  ): Promise<Pick<Guest, "id" | "externalLinkId" | "status"> | null>;
  listActiveGuestNames(linkId: string): Promise<string[]>;
  listMatchingActiveGuestNames(input: {
    linkId: string;
    names: string[];
  }): Promise<string[]>;
  loadGuestsByIds(ids: string[]): Promise<ExternalLinkPublicGuestRecord[]>;
  reserveBulkGuests(input: {
    linkId: string;
    venueId: string;
    eventId: string;
    date: string;
    occurredAt: string;
    guardedNames: string[];
    guests: ExternalLinkPublicBulkGuestWrite[];
  }): Promise<{
    reserved: boolean;
    insertedGuestIds: string[];
    recordedActivityIds: string[];
  }>;
  reserveSelfRsvpGuest(input: {
    link: ExternalLinkPublicRecord;
    ownerKeyHash: string;
    guestId: string;
    guestName: string;
    eventId: string;
    activityId: string;
    requestId: string;
    occurredAt: string;
  }): Promise<{
    reserved: boolean;
    guestInserted: boolean;
    ownerInserted: boolean;
    activityRecorded: boolean;
  }>;
  updateSelfRsvpGuest(input: {
    link: ExternalLinkPublicRecord;
    guest: ExternalLinkPublicGuestRecord;
    ownerKeyHash: string;
    guestName: string;
    activityId: string;
    requestId: string;
    occurredAt: string;
  }): Promise<boolean>;
  deletePendingGuest(input: {
    link: ExternalLinkPublicRecord;
    guest: Pick<Guest, "id" | "status">;
    ownerKeyHash: string | null;
    activityId: string;
    requestId: string;
    occurredAt: string;
  }): Promise<boolean>;
}

const PUBLIC_LINK_COLUMNS_SQL = `
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
`;

const PUBLIC_GUEST_COLUMNS_SQL = `
  guest.id AS id,
  guest.venue_id AS venueId,
  guest.name,
  guest.email,
  guest.instagram,
  guest.external_link_id AS externalLinkId,
  guest.created_by_user_id AS createdByUserId,
  guest.registered_by_name AS registeredByName,
  guest.terminal_request_id AS terminalRequestId,
  guest.event_id AS eventId,
  guest.source,
  guest.status,
  guest.check_in_time AS checkInTime,
  guest.date,
  guest.created_at AS createdAt,
  guest.updated_at AS updatedAt
`;

const SELECT_PUBLIC_LINK_BY_TOKEN_SQL = `
  SELECT ${PUBLIC_LINK_COLUMNS_SQL}
  FROM external_dj_links
  WHERE token = ?
  LIMIT 1
`;

const SELECT_PUBLIC_LINK_KIND_BY_TOKEN_SQL = `
  SELECT kind
  FROM external_dj_links
  WHERE token = ?
  LIMIT 1
`;

const SELECT_PUBLIC_LINK_BY_ID_SQL = `
  SELECT ${PUBLIC_LINK_COLUMNS_SQL}
  FROM external_dj_links
  WHERE id = ?
  LIMIT 1
`;

const SELECT_PUBLIC_VENUE_SQL = `
  SELECT
    id,
    name,
    type,
    address,
    description,
    brand_name AS brandName,
    brand_tagline AS brandTagline,
    brand_description AS brandDescription,
    brand_footer AS brandFooter,
    timezone,
    opening_time AS openingTime,
    closing_time AS closingTime,
    active
  FROM venues
  WHERE id = ?
  LIMIT 1
`;

const SELECT_ACTIVE_PUBLIC_VENUE_SQL = `
  SELECT id
  FROM venues
  WHERE id = ? AND active = 1
  LIMIT 1
`;

const SELECT_ACTIVE_GUESTS_FOR_LINK_SQL = `
  SELECT ${PUBLIC_GUEST_COLUMNS_SQL}
  FROM guests AS guest
  WHERE guest.external_link_id = ? AND guest.status != 'deleted'
`;

const SELECT_OWNED_GUEST_SQL = `
  SELECT ${PUBLIC_GUEST_COLUMNS_SQL}
  FROM guests AS guest
  INNER JOIN external_guest_owners AS owner
    ON owner.guest_id = guest.id
  WHERE
    guest.external_link_id = ?
    AND guest.status != 'deleted'
    AND owner.external_link_id = ?
    AND owner.owner_key_hash = ?
    AND owner.released_at IS NULL
  LIMIT 1
`;

const SELECT_GUEST_FOR_LINK_SQL = `
  SELECT ${PUBLIC_GUEST_COLUMNS_SQL}
  FROM guests AS guest
  WHERE guest.id = ? AND guest.external_link_id = ?
  LIMIT 1
`;

const SELECT_GUEST_CANDIDATE_SQL = `
  SELECT
    id,
    external_link_id AS externalLinkId,
    status
  FROM guests
  WHERE id = ?
  LIMIT 1
`;

const SELECT_ACTIVE_GUEST_NAMES_SQL = `
  SELECT name
  FROM guests
  WHERE external_link_id = ? AND status != 'deleted'
`;

function placeholders(count: number): string {
  if (!Number.isInteger(count) || count < 1 || count > 25) {
    throw new Error("Invalid public external link query size");
  }
  return Array.from({ length: count }, () => "?").join(", ");
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

function toPublicLink(
  row: Omit<ExternalLinkPublicRecord, "active"> & { active: unknown },
): ExternalLinkPublicRecord {
  return { ...row, active: toBoolean(row.active) };
}

function toPublicVenue(
  row: Omit<ExternalLinkPublicVenueRecord, "active"> & { active: unknown },
): ExternalLinkPublicVenueRecord {
  return { ...row, active: toBoolean(row.active) };
}

function toPublicGuest(
  row: Omit<ExternalLinkPublicGuestRecord, "status"> & { status: string },
): ExternalLinkPublicGuestRecord {
  return { ...row, status: row.status as Guest["status"] };
}

export function createExternalLinkPublicPersistence(
  database: D1Database,
): ExternalLinkPublicPersistence {
  return {
    async loadLinkByToken(token) {
      const row = await database
        .prepare(SELECT_PUBLIC_LINK_BY_TOKEN_SQL)
        .bind(token)
        .first<Omit<ExternalLinkPublicRecord, "active"> & { active: unknown }>();
      return row ? toPublicLink(row) : null;
    },

    async loadLinkKindByToken(token) {
      const row = await database
        .prepare(SELECT_PUBLIC_LINK_KIND_BY_TOKEN_SQL)
        .bind(token)
        .first<{ kind: string }>();
      return row?.kind ?? null;
    },

    async loadLinkById(linkId) {
      const row = await database
        .prepare(SELECT_PUBLIC_LINK_BY_ID_SQL)
        .bind(linkId)
        .first<Omit<ExternalLinkPublicRecord, "active"> & { active: unknown }>();
      return row ? toPublicLink(row) : null;
    },

    async loadVenue(venueId) {
      const row = await database
        .prepare(SELECT_PUBLIC_VENUE_SQL)
        .bind(venueId)
        .first<Omit<ExternalLinkPublicVenueRecord, "active"> & { active: unknown }>();
      return row ? toPublicVenue(row) : null;
    },

    async isVenueActive(venueId) {
      const venue = await database
        .prepare(SELECT_ACTIVE_PUBLIC_VENUE_SQL)
        .bind(venueId)
        .first<{ id: string }>();
      return Boolean(venue);
    },

    async listActiveGuestsForLink(linkId) {
      const result = await database
        .prepare(SELECT_ACTIVE_GUESTS_FOR_LINK_SQL)
        .bind(linkId)
        .all<Omit<ExternalLinkPublicGuestRecord, "status"> & { status: string }>();
      return result.results.map(toPublicGuest);
    },

    async findOwnedGuest({ linkId, ownerKeyHash }) {
      const row = await database
        .prepare(SELECT_OWNED_GUEST_SQL)
        .bind(linkId, linkId, ownerKeyHash)
        .first<Omit<ExternalLinkPublicGuestRecord, "status"> & { status: string }>();
      return row ? toPublicGuest(row) : null;
    },

    async loadGuestForLink({ guestId, linkId }) {
      const row = await database
        .prepare(SELECT_GUEST_FOR_LINK_SQL)
        .bind(guestId, linkId)
        .first<Omit<ExternalLinkPublicGuestRecord, "status"> & { status: string }>();
      return row ? toPublicGuest(row) : null;
    },

    async loadGuestCandidate(guestId) {
      const row = await database
        .prepare(SELECT_GUEST_CANDIDATE_SQL)
        .bind(guestId)
        .first<{ id: string; externalLinkId: string | null; status: string }>();
      return row
        ? { ...row, status: row.status as Guest["status"] }
        : null;
    },

    async listActiveGuestNames(linkId) {
      const result = await database
        .prepare(SELECT_ACTIVE_GUEST_NAMES_SQL)
        .bind(linkId)
        .all<{ name: string }>();
      return result.results.map((row) => row.name);
    },

    async listMatchingActiveGuestNames({ linkId, names }) {
      if (names.length === 0) return [];
      const result = await database
        .prepare(`
          SELECT name
          FROM guests
          WHERE external_link_id = ?
            AND status != 'deleted'
            AND name IN (${placeholders(names.length)})
        `)
        .bind(linkId, ...names)
        .all<{ name: string }>();
      return result.results.map((row) => row.name);
    },

    async loadGuestsByIds(ids) {
      if (ids.length === 0) return [];
      const result = await database
        .prepare(`
          SELECT ${PUBLIC_GUEST_COLUMNS_SQL}
          FROM guests AS guest
          WHERE guest.id IN (${placeholders(ids.length)})
        `)
        .bind(...ids)
        .all<Omit<ExternalLinkPublicGuestRecord, "status"> & { status: string }>();
      return result.results.map(toPublicGuest);
    },

    async reserveBulkGuests({
      linkId,
      venueId,
      eventId,
      date,
      occurredAt,
      guardedNames,
      guests,
    }) {
      const reservation = database
        .prepare(buildExternalGuestReservationSql(guardedNames.length))
        .bind(
          guests.length,
          linkId,
          occurredAt,
          date,
          guests.length,
          ...guardedNames.flatMap((name) => [linkId, name]),
        );
      const inserts = guests.flatMap((guest) => [
        database.prepare(EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL).bind(
          guest.id,
          venueId,
          guest.name,
          linkId,
          eventId,
          date,
          occurredAt,
          occurredAt,
        ),
        prepareGuestActivityAfterChange(database, {
          activityId: guest.activityId,
          venueId,
          eventId,
          guestId: guest.id,
          action: "add",
          actorUserId: null,
          actorType: "external_link",
          channel: "external_link",
          requestId: guest.requestId,
          previousStatus: null,
          nextStatus: "pending",
          occurredAt,
        }),
      ]);
      const results = await database.batch<{ id?: string }>([
        reservation,
        ...inserts,
      ]);
      return {
        reserved: results[0]?.results[0]?.id === linkId,
        insertedGuestIds: guests.flatMap((guest, index) =>
          results[index * 2 + 1]?.results[0]?.id === guest.id
            ? [guest.id]
            : [],
        ),
        recordedActivityIds: guests.flatMap((guest, index) =>
          results[index * 2 + 2]?.results[0]?.id === guest.activityId
            ? [guest.activityId]
            : [],
        ),
      };
    },

    async reserveSelfRsvpGuest({
      link,
      ownerKeyHash,
      guestId,
      guestName,
      eventId,
      activityId,
      requestId,
      occurredAt,
    }) {
      const results = await database.batch<{ id?: string; guestId?: string }>([
        database.prepare(RESERVE_SELF_RSVP_SLOT_SQL).bind(
          link.id,
          link.token,
          link.venueId,
          occurredAt,
          link.date,
          ownerKeyHash,
        ),
        database.prepare(EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL).bind(
          guestId,
          link.venueId,
          guestName,
          link.id,
          eventId,
          link.date,
          occurredAt,
          occurredAt,
        ),
        database.prepare(INSERT_SELF_RSVP_OWNER_AFTER_GUEST_SQL).bind(
          guestId,
          link.id,
          ownerKeyHash,
          occurredAt,
        ),
        prepareGuestActivityAfterChange(database, {
          activityId,
          venueId: link.venueId,
          eventId,
          guestId,
          action: "add",
          actorUserId: null,
          actorType: "external_link",
          channel: "external_link",
          requestId,
          previousStatus: null,
          nextStatus: "pending",
          occurredAt,
        }),
      ]);
      return {
        reserved: results[0]?.results[0]?.id === link.id,
        guestInserted: results[1]?.results[0]?.id === guestId,
        ownerInserted: results[2]?.results[0]?.guestId === guestId,
        activityRecorded: results[3]?.results[0]?.id === activityId,
      };
    },

    async updateSelfRsvpGuest({
      link,
      guest,
      ownerKeyHash,
      guestName,
      activityId,
      requestId,
      occurredAt,
    }) {
      const results = await database.batch<{ id?: string }>([
        database.prepare(UPDATE_SELF_RSVP_GUEST_SQL).bind(
          guestName,
          occurredAt,
          guest.id,
          link.id,
          link.venueId,
          link.date,
          ownerKeyHash,
          link.token,
          occurredAt,
        ),
        prepareGuestActivityAfterChange(database, {
          activityId,
          venueId: link.venueId,
          eventId: guest.eventId ?? link.eventId,
          guestId: guest.id,
          action: "update",
          actorUserId: null,
          actorType: "external_link",
          channel: "external_link",
          requestId,
          previousStatus: guest.status,
          nextStatus: guest.status,
          occurredAt,
        }),
      ]);
      return (
        results[0]?.results[0]?.id === guest.id &&
        results[1]?.results[0]?.id === activityId
      );
    },

    async deletePendingGuest({
      link,
      guest,
      ownerKeyHash,
      activityId,
      requestId,
      occurredAt,
    }) {
      const decrement = link.kind === "self_rsvp"
        ? database.prepare(DECREMENT_SELF_RSVP_FOR_PENDING_GUEST_SQL).bind(
            link.id,
            link.token,
            link.venueId,
            occurredAt,
            link.date,
            guest.id,
            link.id,
            link.venueId,
            link.date,
            ownerKeyHash,
          )
        : database.prepare(DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL).bind(
            link.id,
            link.token,
            link.venueId,
            occurredAt,
            link.date,
            guest.id,
            link.id,
            link.venueId,
            link.date,
          );
      const results = await database.batch<{ id?: string }>([
        decrement,
        database.prepare(SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL).bind(
          occurredAt,
          guest.id,
          link.id,
          link.venueId,
          link.date,
        ),
        prepareGuestActivityAfterChange(database, {
          activityId,
          venueId: link.venueId,
          eventId: link.eventId,
          guestId: guest.id,
          action: "delete",
          actorUserId: null,
          actorType: "external_link",
          channel: "external_link",
          requestId,
          previousStatus: guest.status,
          nextStatus: "deleted",
          occurredAt,
        }),
      ]);
      return (
        results[0]?.results[0]?.id === link.id &&
        results[1]?.results[0]?.id === guest.id &&
        results[2]?.results[0]?.id === activityId
      );
    },
  };
}
