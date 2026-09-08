import type { D1Database } from "@cloudflare/workers-types";
import { getD1Database } from "@/lib/db/client";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { getDb } from "../db/client";
import {
  guestActivityLedger,
  guestActivityRequests,
  guests,
} from "../db/schema";
import {
  DECREMENT_EXTERNAL_LINK_AFTER_CHANGE_SQL,
  DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL,
  INTERNAL_BULK_GUEST_INSERT_SQL,
  PERMANENT_DELETE_GUEST_SQL,
  RESTORE_DELETED_GUEST_SQL,
  SOFT_DELETE_GUEST_SQL,
  UPDATE_GUEST_DETAILS_SQL,
} from "./atomic-sql";
import {
  persistGuestStatusActivity,
  prepareGuestActivityAfterChange,
  type GuestActivityMutationResult,
} from "./activity-ledger";
import type { GuestWriteActor } from "./actor";
import { prepareGuestName } from "./bulk-entry";
import type { Guest } from "./types";

export interface AccessibleGuestRecord {
  id: string;
  venueId: string;
  name: string;
  externalLinkId: string | null;
  createdByUserId: string | null;
  eventId: string | null;
  date: string;
  status: Guest["status"];
}

export interface PendingBulkGuestWrite {
  id: string;
  name: string;
  key: string;
  allowDuplicate: boolean;
  activityId: string;
  requestId: string;
}

export interface BulkGuestWriteOutcome {
  id: string;
  guest: Guest | null;
  concurrentDuplicate: boolean;
}

export interface GuestPersistence {
  listByDate(input: {
    date: string;
    venueId?: string;
    eventId: string | null;
    includeLegacyDateRows: boolean;
  }): Promise<Guest[]>;
  listAll(venueId?: string): Promise<Guest[]>;
  loadGuest(guestId: string): Promise<AccessibleGuestRecord | null>;
  readGuest(guestId: string, venueId: string): Promise<Guest | null>;
  listExistingNames(input: {
    venueId: string;
    eventId: string;
    date: string;
    includeLegacyDateRows: boolean;
    createdByUserId: string;
  }): Promise<string[]>;
  createBulk(input: {
    pending: PendingBulkGuestWrite[];
    actor: GuestWriteActor;
    venueId: string;
    eventId: string;
    date: string;
    includeLegacyDateRows: boolean;
    actorUserId: string;
    registeredByName: string | null;
    baseGuestLimit: number | null;
    channel: "admin" | "guest";
    occurredAt: string;
  }): Promise<BulkGuestWriteOutcome[]>;
  findStatusRequest(input: {
    venueId: string;
    idempotencyKey: string;
  }): Promise<{ guestId: string; action: string } | null>;
  hasPreviousEntry(input: { venueId: string; guestId: string }): Promise<boolean>;
  persistStatusActivity(
    input: Parameters<typeof persistGuestStatusActivity>[1],
  ): Promise<GuestActivityMutationResult>;
  softDelete(input: {
    current: AccessibleGuestRecord;
    actor: GuestWriteActor;
    eventId: string;
    includeLegacyDateRows: boolean;
    canDeleteVenueWide: boolean;
    actorUserId: string;
    channel: "admin" | "door" | "guest";
    sessionKeyHash: string | null;
    occurredAt: string;
    activityId: string;
    requestId: string;
  }): Promise<Guest>;
  permanentlyDelete(input: {
    current: AccessibleGuestRecord;
    actor: GuestWriteActor;
    actorUserId: string;
    sessionKeyHash: string | null;
    occurredAt: string;
    activityId: string;
    requestId: string;
  }): Promise<void>;
  updateDetails(input: {
    current: AccessibleGuestRecord;
    actor: GuestWriteActor;
    nextVenueId: string;
    nextName: string;
    nextDate: string;
    eventId: string;
    canAdministerGuests: boolean;
    actorUserId: string;
    channel: "admin" | "guest";
    sessionKeyHash: string | null;
    occurredAt: string;
    activityId: string;
    requestId: string;
  }): Promise<Guest>;
  restore(input: {
    current: AccessibleGuestRecord;
    actor: GuestWriteActor;
    eventId: string;
    includeLegacyDateRows: boolean;
    actorUserId: string;
    sessionKeyHash: string | null;
    occurredAt: string;
    activityId: string;
    requestId: string;
  }): Promise<Guest | null>;
}

function guestActorBindings(actor: GuestWriteActor, includeGuestLimit = true) {
  const bindings = [
    actor.id,
    actor.role,
    actor.accountKind,
    actor.doorAccessEnabled ? 1 : 0,
    actor.venueId,
  ];
  if (includeGuestLimit) bindings.push(actor.guestLimit);
  bindings.push(actor.sessionVersion);
  return bindings;
}

function toGuest(row: typeof guests.$inferSelect): Guest {
  return { ...row, status: row.status as Guest["status"] };
}

function eventScope(input: {
  eventId: string;
  date: string;
  includeLegacyDateRows: boolean;
}) {
  return input.includeLegacyDateRows
    ? or(
        eq(guests.eventId, input.eventId),
        and(isNull(guests.eventId), eq(guests.date, input.date)),
      )!
    : eq(guests.eventId, input.eventId);
}

export function createGuestPersistence(): GuestPersistence {
  const db = getDb();
  const d1 = getD1Database() as D1Database;

  return {
    async listByDate({
      date,
      venueId,
      eventId,
      includeLegacyDateRows,
    }) {
      const conditions = [eq(guests.date, date), ne(guests.status, "deleted")];
      if (eventId) {
        conditions.push(
          includeLegacyDateRows
            ? or(
                eq(guests.eventId, eventId),
                isNull(guests.eventId),
              )!
            : eq(guests.eventId, eventId),
        );
      } else {
        conditions.push(isNull(guests.eventId));
      }
      if (venueId) conditions.push(eq(guests.venueId, venueId));

      const rows = await db
        .select()
        .from(guests)
        .where(and(...conditions))
        .orderBy(desc(guests.createdAt));
      return rows.map(toGuest);
    },

    async listAll(venueId) {
      const baseQuery = db.select().from(guests);
      const rows = await (
        venueId
          ? baseQuery.where(eq(guests.venueId, venueId))
          : baseQuery
      ).orderBy(desc(guests.date), desc(guests.createdAt));
      return rows.map(toGuest);
    },

    async loadGuest(guestId) {
      const [row] = await db
        .select({
          id: guests.id,
          venueId: guests.venueId,
          name: guests.name,
          externalLinkId: guests.externalLinkId,
          createdByUserId: guests.createdByUserId,
          eventId: guests.eventId,
          date: guests.date,
          status: guests.status,
        })
        .from(guests)
        .where(eq(guests.id, guestId))
        .limit(1);
      return row
        ? { ...row, status: row.status as AccessibleGuestRecord["status"] }
        : null;
    },

    async readGuest(guestId, venueId) {
      const [row] = await db
        .select()
        .from(guests)
        .where(and(eq(guests.id, guestId), eq(guests.venueId, venueId)))
        .limit(1);
      return row ? toGuest(row) : null;
    },

    async listExistingNames({
      venueId,
      eventId,
      date,
      includeLegacyDateRows,
      createdByUserId,
    }) {
      const rows = await db
        .select({ name: guests.name })
        .from(guests)
        .where(
          and(
            eq(guests.venueId, venueId),
            eventScope({ eventId, date, includeLegacyDateRows }),
            eq(guests.createdByUserId, createdByUserId),
            ne(guests.status, "deleted"),
          ),
        );
      return rows.map((row) => row.name);
    },

    async createBulk({
      pending,
      actor,
      venueId,
      eventId,
      date,
      includeLegacyDateRows,
      actorUserId,
      registeredByName,
      baseGuestLimit,
      channel,
      occurredAt,
    }) {
      const statements = pending.flatMap((guest) => [
        d1.prepare(INTERNAL_BULK_GUEST_INSERT_SQL).bind(
          guest.id,
          venueId,
          guest.name,
          actorUserId,
          registeredByName,
          eventId,
          date,
          occurredAt,
          occurredAt,
          venueId,
          eventId,
          venueId,
          date,
          guest.allowDuplicate ? 1 : 0,
          venueId,
          actorUserId,
          eventId,
          includeLegacyDateRows ? 1 : 0,
          date,
          guest.name,
          baseGuestLimit,
          venueId,
          actorUserId,
          eventId,
          includeLegacyDateRows ? 1 : 0,
          date,
          baseGuestLimit ?? 0,
          venueId,
          actorUserId,
          eventId,
          includeLegacyDateRows ? 1 : 0,
          date,
          eventId,
          venueId,
          actorUserId,
          baseGuestLimit,
          ...guestActorBindings(actor, false),
          venueId,
        ),
        prepareGuestActivityAfterChange(d1, {
          activityId: guest.activityId,
          venueId,
          eventId,
          guestId: guest.id,
          action: "add",
          actorUserId,
          actorType: "user",
          channel,
          requestId: guest.requestId,
          previousStatus: null,
          nextStatus: "pending",
          occurredAt,
          finalActor: actor,
          finalAccess: "guest",
          verifyGuestLimit: false,
        }),
      ]);
      const results = await d1.batch<{ id: string }>(statements);
      const inserts = pending.map((_, index) => results[index * 2]);
      const activities = pending.map((_, index) => results[index * 2 + 1]);
      for (let index = 0; index < pending.length; index += 1) {
        const guestCreated =
          inserts[index]?.results[0]?.id === pending[index].id;
        const activityCreated =
          activities[index]?.results[0]?.id === pending[index].activityId;
        if (guestCreated !== activityCreated) {
          throw new Error("Guest and activity ledger result diverged");
        }
      }

      const createdIds = pending
        .filter((guest, index) => inserts[index]?.results[0]?.id === guest.id)
        .map((guest) => guest.id);
      const createdRows =
        createdIds.length > 0
          ? await db
              .select()
              .from(guests)
              .where(inArray(guests.id, createdIds))
          : [];
      const createdById = new Map(
        createdRows.map((row) => [row.id, toGuest(row)]),
      );
      const failedUnconfirmedNames = Array.from(
        new Set(
          pending
            .filter(
              (guest, index) =>
                !guest.allowDuplicate &&
                inserts[index]?.results[0]?.id !== guest.id,
            )
            .map((guest) => guest.name),
        ),
      );
      const duplicateRows =
        failedUnconfirmedNames.length > 0
          ? await db
              .select({ name: guests.name })
              .from(guests)
              .where(
                and(
                  eq(guests.venueId, venueId),
                  eventScope({ eventId, date, includeLegacyDateRows }),
                  eq(guests.createdByUserId, actorUserId),
                  ne(guests.status, "deleted"),
                  inArray(guests.name, failedUnconfirmedNames),
                ),
              )
          : [];
      const duplicateKeys = new Set(
        duplicateRows.flatMap((row) => {
          const prepared = prepareGuestName(row.name);
          return prepared.error === null ? [prepared.key] : [];
        }),
      );

      return pending.map((guest, index) => {
        const created = inserts[index]?.results[0]?.id === guest.id;
        const row = created ? createdById.get(guest.id) ?? null : null;
        if (created && !row) {
          throw new Error("Bulk guest insert could not be read back");
        }
        return {
          id: guest.id,
          guest: row,
          concurrentDuplicate:
            !created &&
            !guest.allowDuplicate &&
            duplicateKeys.has(guest.key),
        };
      });
    },

    async findStatusRequest({ venueId, idempotencyKey }) {
      const [row] = await db
        .select({
          guestId: guestActivityRequests.guestId,
          action: guestActivityRequests.action,
        })
        .from(guestActivityRequests)
        .where(
          and(
            eq(guestActivityRequests.venueId, venueId),
            eq(guestActivityRequests.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async hasPreviousEntry({ venueId, guestId }) {
      const [row] = await db
        .select({ id: guestActivityLedger.id })
        .from(guestActivityLedger)
        .where(
          and(
            eq(guestActivityLedger.venueId, venueId),
            eq(guestActivityLedger.guestId, guestId),
            eq(guestActivityLedger.outcome, "applied"),
            inArray(guestActivityLedger.action, ["check_in", "re_entry"]),
          ),
        )
        .limit(1);
      return Boolean(row);
    },

    async persistStatusActivity(input) {
      return persistGuestStatusActivity(d1, input);
    },

    async softDelete({
      current,
      actor,
      eventId,
      includeLegacyDateRows,
      canDeleteVenueWide,
      actorUserId,
      channel,
      sessionKeyHash,
      occurredAt,
      activityId,
      requestId,
    }) {
      const statements = [
        d1.prepare(SOFT_DELETE_GUEST_SQL).bind(
          occurredAt,
          eventId,
          current.id,
          current.venueId,
          eventId,
          includeLegacyDateRows ? 1 : 0,
          current.date,
          eventId,
          canDeleteVenueWide ? 1 : 0,
          actorUserId,
          ...guestActorBindings(actor),
        ),
        prepareGuestActivityAfterChange(d1, {
          activityId,
          venueId: current.venueId,
          eventId,
          guestId: current.id,
          action: "delete",
          actorUserId,
          actorType: "user",
          channel,
          requestId,
          previousStatus: current.status,
          nextStatus: "deleted",
          sessionKeyHash,
          occurredAt,
          finalActor: actor,
          finalAccess: "guest",
        }),
      ];
      if (current.externalLinkId) {
        statements.push(
          d1
            .prepare(DECREMENT_EXTERNAL_LINK_AFTER_CHANGE_SQL)
            .bind(current.externalLinkId),
        );
      }
      const results = await d1.batch<{ id: string }>(statements);
      if (results[0]?.results[0]?.id !== current.id) {
        throw new Error("Guest is deleted or no longer accessible");
      }
      if (results[1]?.results[0]?.id !== activityId) {
        throw new Error("Guest delete activity was not recorded");
      }
      const updated = await this.readGuest(current.id, current.venueId);
      if (!updated) throw new Error("Guest is no longer accessible");
      return updated;
    },

    async permanentlyDelete({
      current,
      actor,
      actorUserId,
      sessionKeyHash,
      occurredAt,
      activityId,
      requestId,
    }) {
      const deleteStatement = d1
        .prepare(PERMANENT_DELETE_GUEST_SQL)
        .bind(current.id, current.venueId, ...guestActorBindings(actor));
      const activityStatement = prepareGuestActivityAfterChange(d1, {
        activityId,
        venueId: current.venueId,
        eventId: current.eventId,
        guestId: current.id,
        action: "permanent_delete",
        actorUserId,
        actorType: "user",
        channel: "admin",
        requestId,
        previousStatus: current.status,
        nextStatus: null,
        sessionKeyHash,
        occurredAt,
        finalActor: actor,
        finalAccess: "admin",
      });
      const statements = current.externalLinkId
        ? [
            d1
              .prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL)
              .bind(
                current.externalLinkId,
                current.id,
                current.externalLinkId,
                current.venueId,
                ...guestActorBindings(actor),
              ),
            deleteStatement,
            activityStatement,
          ]
        : [deleteStatement, activityStatement];
      const results = await d1.batch<{ id: string }>(statements);
      const deleteIndex = current.externalLinkId ? 1 : 0;
      if (results[deleteIndex]?.results[0]?.id !== current.id) {
        throw new Error("Guest is no longer accessible");
      }
      if (results[results.length - 1]?.results[0]?.id !== activityId) {
        throw new Error("Permanent delete activity was not recorded");
      }
    },

    async updateDetails({
      current,
      actor,
      nextVenueId,
      nextName,
      nextDate,
      eventId,
      canAdministerGuests,
      actorUserId,
      channel,
      sessionKeyHash,
      occurredAt,
      activityId,
      requestId,
    }) {
      const results = await d1.batch<{ id: string }>([
        d1.prepare(UPDATE_GUEST_DETAILS_SQL).bind(
          nextVenueId,
          nextName,
          nextDate,
          eventId,
          occurredAt,
          current.id,
          current.venueId,
          nextVenueId,
          eventId,
          nextVenueId,
          nextDate,
          canAdministerGuests ? 1 : 0,
          actorUserId,
          ...guestActorBindings(actor),
        ),
        prepareGuestActivityAfterChange(d1, {
          activityId,
          venueId: nextVenueId,
          eventId,
          guestId: current.id,
          action: "update",
          actorUserId,
          actorType: "user",
          channel,
          requestId,
          previousStatus: current.status,
          nextStatus: current.status,
          sessionKeyHash,
          occurredAt,
          finalActor: actor,
          finalAccess: "guest",
        }),
      ]);
      if (
        results[0]?.results[0]?.id !== current.id ||
        results[1]?.results[0]?.id !== activityId
      ) {
        throw new Error("Guest update and activity ledger diverged");
      }
      const updated = await this.readGuest(current.id, nextVenueId);
      if (!updated) throw new Error("Guest is no longer accessible");
      return updated;
    },

    async restore({
      current,
      actor,
      eventId,
      includeLegacyDateRows,
      actorUserId,
      sessionKeyHash,
      occurredAt,
      activityId,
      requestId,
    }) {
      const results = await d1.batch<{ id: string }>([
        d1.prepare(RESTORE_DELETED_GUEST_SQL).bind(
          occurredAt,
          eventId,
          current.id,
          current.venueId,
          eventId,
          includeLegacyDateRows ? 1 : 0,
          current.date,
          eventId,
          ...guestActorBindings(actor),
        ),
        prepareGuestActivityAfterChange(d1, {
          activityId,
          venueId: current.venueId,
          eventId,
          guestId: current.id,
          action: "restore",
          actorUserId,
          actorType: "user",
          channel: "admin",
          requestId,
          previousStatus: "deleted",
          nextStatus: "pending",
          sessionKeyHash,
          occurredAt,
          finalActor: actor,
          finalAccess: "admin",
        }),
      ]);
      if (
        results[0]?.results[0]?.id !== current.id ||
        results[1]?.results[0]?.id !== activityId
      ) {
        return null;
      }
      return this.readGuest(current.id, current.venueId);
    },
  };
}
