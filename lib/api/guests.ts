"use server";

import { reportServerError } from "@/lib/observability/structured-log";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { eq, and, ne, desc, inArray, isNull, or } from "drizzle-orm";
import {
  eventContributorLimits,
  guestActivityLedger,
  guests,
} from "../db/schema";
import {
  type ApiResponse,
  type BulkGuestCreateInput,
  type BulkGuestCreateItemResult,
  type BulkGuestCreateResult,
  type Guest,
} from "./types";
import { requireAccess, requireAuth, requireRole, type SessionUser } from "../auth/server";
import { getDb } from "../db/client";
import { requireActiveVenueId } from "../tenant/active-server";
import { hasAccess } from "@/lib/users/policy";
import {
  MAX_BULK_WRITE_NAMES,
  prepareGuestName,
  toStoredGuestName,
} from "@/lib/guests/bulk-entry";
import {
  DECREMENT_EXTERNAL_LINK_AFTER_CHANGE_SQL,
  DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL,
  INTERNAL_BULK_GUEST_INSERT_SQL,
  PERMANENT_DELETE_GUEST_SQL,
  SOFT_DELETE_GUEST_SQL,
  RESTORE_DELETED_GUEST_SQL,
  UPDATE_GUEST_DETAILS_SQL,
} from "@/lib/guests/atomic-sql";
import {
  eventIncludesLegacyDateRows,
  findCompatibilityEvent,
  loadEventById,
  resolveEventForRosterWrite,
} from "@/lib/events/server";
import {
  hashOpaqueIdentifier,
  persistGuestStatusActivity,
  prepareGuestActivityAfterChange,
} from "@/lib/guests/activity-ledger";

type Db = ReturnType<typeof getDb>;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getCurrentSessionKeyHash(): Promise<string | null> {
  const sessionId = (await cookies()).get("sessionId")?.value;
  return sessionId ? hashOpaqueIdentifier(sessionId) : null;
}

function parseBulkGuestCreateInput(value: unknown): {
  name: string;
  allowDuplicate: boolean;
} | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { name?: unknown; allowDuplicate?: unknown };
  if (typeof candidate.name !== "string") return null;
  if (
    candidate.allowDuplicate !== undefined &&
    typeof candidate.allowDuplicate !== "boolean"
  ) {
    return null;
  }
  return {
    name: candidate.name,
    allowDuplicate: candidate.allowDuplicate === true,
  };
}

async function scopedVenueId(
  user: SessionUser,
  requestedVenueId?: string | null,
): Promise<string | undefined> {
  const venueId = user.role === "super_admin" ? requestedVenueId ?? undefined : user.venueId;
  if (user.role !== "super_admin" && (!venueId || (requestedVenueId && requestedVenueId !== venueId))) {
    throw new Error("Forbidden");
  }
  return venueId ? requireActiveVenueId(venueId) : undefined;
}

async function getAccessibleGuest(db: Db, user: SessionUser, guestId: string) {
  const rows = await db
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
  const guest = rows[0];
  if (!guest) throw new Error("Guest not found");
  if (user.role !== "super_admin" && guest.venueId !== user.venueId) throw new Error("Forbidden");
  await requireActiveVenueId(guest.venueId);
  return guest;
}

export async function fetchGuestsByDate(
  date: string,
  venueId?: string,
  eventId?: string | null,
): Promise<ApiResponse<Guest[]>> {
  try {
    const user = await requireAccess("door");
    const db = getDb();
    let effectiveVenueId = await scopedVenueId(user, venueId);
    const conditions = [eq(guests.date, date), ne(guests.status, "deleted")];
    if (eventId) {
      const event = await loadEventById(db, eventId);
      if (
        !event ||
        event.businessDate !== date ||
        (effectiveVenueId && event.venueId !== effectiveVenueId)
      ) {
        throw new Error("EVENT_NOT_FOUND");
      }
      await requireActiveVenueId(event.venueId);
      effectiveVenueId = event.venueId;
      conditions.push(eq(guests.eventId, event.id));
    } else if (effectiveVenueId) {
      const compatibilityEvent = await findCompatibilityEvent(
        effectiveVenueId,
        date,
      );
      conditions.push(
        compatibilityEvent
          ? or(
              eq(guests.eventId, compatibilityEvent.id),
              isNull(guests.eventId),
            )!
          : isNull(guests.eventId),
      );
    } else {
      conditions.push(isNull(guests.eventId));
    }
    if (effectiveVenueId) conditions.push(eq(guests.venueId, effectiveVenueId));

    const result = await db.select().from(guests)
      .where(and(...conditions))
      .orderBy(desc(guests.createdAt));

    return { data: result.map((g) => ({ ...g, status: g.status as Guest["status"] })), error: null };
  } catch (error: unknown) {
    await reportServerError("guest.list_by_date", error);
    return { data: null, error: "Unable to load guests right now." };
  }
}

export async function fetchAllGuests(venueId?: string): Promise<ApiResponse<Guest[]>> {
  try {
    const user = await requireAccess("admin");
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, venueId);
    const baseQuery = db.select().from(guests);
    const result = await (
      effectiveVenueId ? baseQuery.where(eq(guests.venueId, effectiveVenueId)) : baseQuery
    ).orderBy(desc(guests.date), desc(guests.createdAt));

    return { data: result.map((g) => ({ ...g, status: g.status as Guest["status"] })), error: null };
  } catch (error: unknown) {
    await reportServerError("guest.list_all", error);
    return { data: null, error: "Unable to load guests right now." };
  }
}

export async function createGuest(guest: {
  venueId: string;
  name: string;
  registeredByName?: string | null;
  date: string;
  eventId?: string | null;
}): Promise<ApiResponse<Guest>> {
  const response = await createGuests({
    venueId: guest.venueId,
    date: guest.date,
    eventId: guest.eventId,
    registeredByName: guest.registeredByName,
    items: [{ name: guest.name, allowDuplicate: false }],
  });
  if (response.error || !response.data) {
    return { data: null, error: response.error };
  }

  const [result] = response.data.items;
  if (result?.status === "created" && result.guest) {
    return { data: result.guest, error: null };
  }
  if (result?.status === "duplicate_requires_confirmation") {
    return { data: null, error: "DUPLICATE_REQUIRES_CONFIRMATION" };
  }
  if (result?.status === "limit_reached") {
    return { data: null, error: "GUEST_LIMIT_REACHED" };
  }
  if (result?.status === "invalid_name") {
    return { data: null, error: "INVALID_GUEST_NAME" };
  }
  return { data: null, error: "Unable to create guest right now." };
}

interface PendingBulkGuest {
  index: number;
  id: string;
  name: string;
  key: string;
  allowDuplicate: boolean;
}

export async function createGuests(params: {
  venueId: string;
  date: string;
  eventId?: string | null;
  registeredByName?: string | null;
  items: BulkGuestCreateInput[];
}): Promise<ApiResponse<BulkGuestCreateResult>> {
  try {
    const user = await requireAccess("guest");
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, params.venueId);
    if (!effectiveVenueId) throw new Error("Venue is required");
    if (!isValidDate(params.date)) return { data: null, error: "INVALID_DATE" };
    if (!Array.isArray(params.items) || params.items.length > MAX_BULK_WRITE_NAMES) {
      return { data: null, error: "BULK_LIMIT_EXCEEDED" };
    }
    const event = await resolveEventForRosterWrite({
      venueId: effectiveVenueId,
      businessDate: params.date,
      eventId: params.eventId,
      actorUserId: user.id,
      purpose: "register",
    });
    await db
      .insert(eventContributorLimits)
      .values({
        eventId: event.id,
        venueId: effectiveVenueId,
        userId: user.id,
        guestLimit: user.guestLimit,
        sourceEventId: event.templateSourceEventId,
        createdByUserId: user.id,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    const includeLegacyRows = eventIncludesLegacyDateRows(event);
    const eventScope = includeLegacyRows
      ? or(
          eq(guests.eventId, event.id),
          and(isNull(guests.eventId), eq(guests.date, params.date)),
        )
      : eq(guests.eventId, event.id);
    const [configuredLimit] = await db
      .select({ guestLimit: eventContributorLimits.guestLimit })
      .from(eventContributorLimits)
      .where(
        and(
          eq(eventContributorLimits.eventId, event.id),
          eq(eventContributorLimits.userId, user.id),
          eq(eventContributorLimits.venueId, effectiveVenueId),
        ),
      )
      .limit(1);
    const baseGuestLimit = configuredLimit
      ? configuredLimit.guestLimit
      : user.guestLimit;

    const preparedRegisteredByName = prepareGuestName(params.registeredByName);
    const registeredByName =
      preparedRegisteredByName.error === null &&
      preparedRegisteredByName.name.length <= 80
        ? preparedRegisteredByName.name
        : null;
    if (
      user.accountKind === "shared" &&
      (!registeredByName || registeredByName.length > 80)
    ) {
      return { data: null, error: "REGISTERED_BY_REQUIRED" };
    }

    const existingNames = await db
      .select({ name: guests.name })
      .from(guests)
      .where(
        and(
          eq(guests.venueId, effectiveVenueId),
          eventScope,
          eq(guests.createdByUserId, user.id),
          ne(guests.status, "deleted"),
        ),
      );
    const seenKeys = new Set<string>();
    for (const existing of existingNames) {
      const prepared = prepareGuestName(existing.name);
      if (prepared.error === null) seenKeys.add(prepared.key);
    }

    const itemResults: BulkGuestCreateItemResult[] = params.items.map((_, index) => ({
      index,
      status: "invalid_name",
      guest: null,
    }));
    const pendingGuests: PendingBulkGuest[] = [];

    for (let index = 0; index < params.items.length; index += 1) {
      const input = parseBulkGuestCreateInput(params.items[index]);
      if (!input) continue;
      const prepared = prepareGuestName(input.name);
      if (prepared.error !== null) continue;

      if (seenKeys.has(prepared.key) && !input.allowDuplicate) {
        itemResults[index] = {
          index,
          status: "duplicate_requires_confirmation",
          guest: null,
        };
        continue;
      }

      seenKeys.add(prepared.key);
      pendingGuests.push({
        index,
        id: crypto.randomUUID(),
        name: toStoredGuestName(prepared.name),
        key: prepared.key,
        allowDuplicate: input.allowDuplicate,
      });
    }

    if (pendingGuests.length === 0) {
      return { data: { items: itemResults }, error: null };
    }

    const now = new Date().toISOString();
    const { env } = getCloudflareContext();
    const activityIds = pendingGuests.map(() => crypto.randomUUID());
    const statements = pendingGuests.flatMap((pending, index) => [
      env.DB.prepare(INTERNAL_BULK_GUEST_INSERT_SQL).bind(
        pending.id,
        effectiveVenueId,
        pending.name,
        user.id,
        user.accountKind === "shared" ? registeredByName : null,
        event.id,
        params.date,
        now,
        now,
        effectiveVenueId,
        pending.allowDuplicate ? 1 : 0,
        effectiveVenueId,
        user.id,
        event.id,
        includeLegacyRows ? 1 : 0,
        params.date,
        pending.name,
        baseGuestLimit,
        user.id,
        event.id,
        includeLegacyRows ? 1 : 0,
        params.date,
        baseGuestLimit ?? 0,
        user.id,
        event.id,
        includeLegacyRows ? 1 : 0,
        params.date,
      ),
      prepareGuestActivityAfterChange(env.DB, {
        activityId: activityIds[index],
        venueId: effectiveVenueId,
        eventId: event.id,
        guestId: pending.id,
        action: "add",
        actorUserId: user.id,
        actorType: "user",
        channel: hasAccess(user, ["admin"]) ? "admin" : "guest",
        requestId: crypto.randomUUID(),
        previousStatus: null,
        nextStatus: "pending",
        occurredAt: now,
      }),
    ]);
    const writeResults = await env.DB.batch<{ id: string }>(statements);
    const insertResults = pendingGuests.map((_, index) => writeResults[index * 2]);
    const activityResults = pendingGuests.map((_, index) => writeResults[index * 2 + 1]);
    for (let index = 0; index < pendingGuests.length; index += 1) {
      const guestCreated = insertResults[index]?.results[0]?.id === pendingGuests[index].id;
      const activityCreated = activityResults[index]?.results[0]?.id === activityIds[index];
      if (guestCreated !== activityCreated) {
        throw new Error("Guest and activity ledger result diverged");
      }
    }
    const createdIds = pendingGuests
      .filter((pending, index) => insertResults[index]?.results[0]?.id === pending.id)
      .map((pending) => pending.id);
    const createdRows = createdIds.length > 0
      ? await db.select().from(guests).where(inArray(guests.id, createdIds))
      : [];
    const createdById = new Map(createdRows.map((row) => [row.id, row]));
    const failedUnconfirmedNames = Array.from(
      new Set(
        pendingGuests
          .filter(
            (pending, index) =>
              !pending.allowDuplicate &&
              insertResults[index]?.results[0]?.id !== pending.id,
          )
          .map((pending) => pending.name),
      ),
    );
    const concurrentDuplicateRows = failedUnconfirmedNames.length > 0
      ? await db
        .select({ name: guests.name })
        .from(guests)
        .where(
          and(
            eq(guests.venueId, effectiveVenueId),
            eventScope,
            eq(guests.createdByUserId, user.id),
            ne(guests.status, "deleted"),
            inArray(guests.name, failedUnconfirmedNames),
          ),
        )
      : [];
    const concurrentDuplicateKeys = new Set(
      concurrentDuplicateRows.flatMap((row) => {
        const prepared = prepareGuestName(row.name);
        return prepared.error === null ? [prepared.key] : [];
      }),
    );

    for (let pendingIndex = 0; pendingIndex < pendingGuests.length; pendingIndex += 1) {
      const pending = pendingGuests[pendingIndex];
      const wasCreated = insertResults[pendingIndex]?.results[0]?.id === pending.id;
      const row = wasCreated ? createdById.get(pending.id) : undefined;
      if (wasCreated && !row) throw new Error("Bulk guest insert could not be read back");
      if (wasCreated && row) {
        itemResults[pending.index] = {
          index: pending.index,
          status: "created",
          guest: { ...row, status: row.status as Guest["status"] },
        };
      } else {
        itemResults[pending.index] = {
          index: pending.index,
          status:
            !pending.allowDuplicate && concurrentDuplicateKeys.has(pending.key)
              ? "duplicate_requires_confirmation"
              : "limit_reached",
          guest: null,
        };
      }
    }

    return { data: { items: itemResults }, error: null };
  } catch (error: unknown) {
    await reportServerError("guest.create", error);
    return { data: null, error: "Unable to create guests right now." };
  }
}

export async function updateGuestStatus(
  guestId: string,
  status: "pending" | "checked",
  idempotencyKey: string,
): Promise<ApiResponse<Guest>> {
  try {
    if (status !== "pending" && status !== "checked") {
      return { data: null, error: "INVALID_GUEST_STATUS" };
    }
    const user = await requireAccess("door");
    const db = getDb();
    const current = await getAccessibleGuest(db, user, guestId);
    const now = new Date().toISOString();
    const event = await resolveEventForRosterWrite({
      venueId: current.venueId,
      businessDate: current.date,
      eventId: current.eventId,
      actorUserId: user.id,
      purpose: "check_in",
    });
    let action: "check_in" | "cancel_check_in" | "re_entry" =
      status === "pending" ? "cancel_check_in" : "check_in";
    if (status === "checked") {
      const [previousEntry] = await db
        .select({ id: guestActivityLedger.id })
        .from(guestActivityLedger)
        .where(
          and(
            eq(guestActivityLedger.venueId, current.venueId),
            eq(guestActivityLedger.guestId, guestId),
            eq(guestActivityLedger.outcome, "applied"),
            inArray(guestActivityLedger.action, ["check_in", "re_entry"]),
          ),
        )
        .limit(1);
      if (previousEntry) action = "re_entry";
    }
    const sessionKeyHash = await getCurrentSessionKeyHash();
    const { env } = getCloudflareContext();
    const mutation = await persistGuestStatusActivity(env.DB, {
      venueId: current.venueId,
      eventId: event.id,
      includeLegacyDateRows: eventIncludesLegacyDateRows(event),
      businessDate: current.date,
      guestId,
      action,
      actorUserId: user.id,
      channel: hasAccess(user, ["admin"]) ? "admin" : "door",
      idempotencyKey,
      occurredAt: now,
      sessionKeyHash,
    });
    if (mutation.outcome === "conflict") {
      return { data: null, error: "IDEMPOTENCY_CONFLICT" };
    }
    if (mutation.outcome === "rejected") {
      return { data: null, error: "GUEST_ACTIVITY_REJECTED" };
    }
    if (mutation.outcome === "unavailable") {
      throw new Error("Guest activity unavailable");
    }
    if (mutation.status === null) {
      throw new Error("Guest activity result unavailable");
    }

    const result = await db
      .select()
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.venueId, current.venueId)))
      .limit(1);
    if (!result[0]) throw new Error("Guest is no longer accessible");
    return {
      data: {
        ...result[0],
        status: mutation.status,
        checkInTime: mutation.checkInTime,
      },
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("guest.status_update", error);
    return { data: null, error: "Unable to update guest status right now." };
  }
}

export async function deleteGuest(guestId: string): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireAuth();
    const db = getDb();
    const { env } = getCloudflareContext();

    const current = await getAccessibleGuest(db, user, guestId);
    const canDeleteVenueWide = hasAccess(user, ["door"]);
    if (!canDeleteVenueWide && current.createdByUserId !== user.id) {
      throw new Error("Forbidden");
    }
    const event = await resolveEventForRosterWrite({
      venueId: current.venueId,
      businessDate: current.date,
      eventId: current.eventId,
      actorUserId: user.id,
      purpose: "register",
    });
    const now = new Date().toISOString();
    const activityId = crypto.randomUUID();
    const statements = [
      env.DB.prepare(SOFT_DELETE_GUEST_SQL).bind(
        now,
        event.id,
        guestId,
        current.venueId,
        event.id,
        eventIncludesLegacyDateRows(event) ? 1 : 0,
        current.date,
        event.id,
        canDeleteVenueWide ? 1 : 0,
        user.id,
      ),
      prepareGuestActivityAfterChange(env.DB, {
        activityId,
        venueId: current.venueId,
        eventId: event.id,
        guestId,
        action: "delete",
        actorUserId: user.id,
        actorType: "user",
        channel: hasAccess(user, ["admin"]) ? "admin" : hasAccess(user, ["door"]) ? "door" : "guest",
        requestId: crypto.randomUUID(),
        previousStatus: current.status,
        nextStatus: "deleted",
        sessionKeyHash: await getCurrentSessionKeyHash(),
        occurredAt: now,
      }),
    ];
    if (current.externalLinkId) {
      statements.push(
        env.DB.prepare(DECREMENT_EXTERNAL_LINK_AFTER_CHANGE_SQL).bind(
          current.externalLinkId,
        ),
      );
    }
    const deleteResults = await env.DB.batch<{ id: string }>(statements);
    if (deleteResults[0]?.results[0]?.id !== guestId) {
      throw new Error("Guest is deleted or no longer accessible");
    }
    if (deleteResults[1]?.results[0]?.id !== activityId) {
      throw new Error("Guest delete activity was not recorded");
    }

    const updatedRows = await db
      .select()
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.venueId, current.venueId)))
      .limit(1);
    const updated = updatedRows[0];
    if (!updated) throw new Error("Guest is no longer accessible");

    return { data: updated ? { ...updated, status: updated.status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    await reportServerError("guest.delete", error);
    return { data: null, error: "Unable to delete guest right now." };
  }
}

export async function permanentlyDeleteGuest(guestId: string): Promise<{ error: string | null }> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const { env } = getCloudflareContext();
    const current = await getAccessibleGuest(db, user, guestId);
    const deleteStatement = env.DB.prepare(PERMANENT_DELETE_GUEST_SQL).bind(
      guestId,
      current.venueId,
    );
    const activityId = crypto.randomUUID();
    const now = new Date().toISOString();
    const activityStatement = prepareGuestActivityAfterChange(env.DB, {
      activityId,
      venueId: current.venueId,
      eventId: current.eventId,
      guestId,
      action: "permanent_delete",
      actorUserId: user.id,
      actorType: "user",
      channel: "admin",
      requestId: crypto.randomUUID(),
      previousStatus: current.status,
      nextStatus: null,
      sessionKeyHash: await getCurrentSessionKeyHash(),
      occurredAt: now,
    });
    const statements = current.externalLinkId
      ? [
        env.DB.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).bind(
          current.externalLinkId,
          guestId,
          current.externalLinkId,
          current.venueId,
        ),
        deleteStatement,
        activityStatement,
      ]
      : [deleteStatement, activityStatement];
    const deleteResults = await env.DB.batch<{ id: string }>(statements);
    const deleteResultIndex = current.externalLinkId ? 1 : 0;
    if (deleteResults[deleteResultIndex]?.results[0]?.id !== guestId) {
      throw new Error("Guest is no longer accessible");
    }
    if (deleteResults[deleteResults.length - 1]?.results[0]?.id !== activityId) {
      throw new Error("Permanent delete activity was not recorded");
    }
    return { error: null };
  } catch (error: unknown) {
    await reportServerError("guest.delete_permanent", error);
    return { error: "Unable to permanently delete guest right now." };
  }
}

export async function updateGuest(
  guestId: string,
  updates: {
    name?: string;
    date?: string;
    venueId?: string;
  },
): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireAuth();
    const db = getDb();
    const current = await getAccessibleGuest(db, user, guestId);
    const canAdministerGuests = hasAccess(user, ["admin"]);
    if (!canAdministerGuests && current.createdByUserId !== user.id) {
      throw new Error("Forbidden");
    }
    if (!canAdministerGuests && (updates.date !== undefined || updates.venueId !== undefined)) {
      throw new Error("Forbidden");
    }
    if (
      current.externalLinkId &&
      (updates.date !== undefined || updates.venueId !== undefined)
    ) {
      return { data: null, error: "EXTERNAL_GUEST_SCOPE_LOCKED" };
    }

    let nextName = current.name;

    if (updates.name !== undefined) {
      const preparedName = prepareGuestName(updates.name);
      if (preparedName.error !== null) {
        return { data: null, error: "INVALID_GUEST_NAME" };
      }
      nextName = toStoredGuestName(preparedName.name);
    }
    let nextDate = current.date;
    if (updates.date !== undefined) {
      if (!isValidDate(updates.date)) {
        return { data: null, error: "INVALID_DATE" };
      }
      nextDate = updates.date;
    }
    let nextVenueId = current.venueId;
    if (updates.venueId !== undefined) {
      const effectiveVenueId = await scopedVenueId(user, updates.venueId);
      if (!effectiveVenueId) throw new Error("Venue is required");
      nextVenueId = effectiveVenueId;
    }
    const event = await resolveEventForRosterWrite({
      venueId: nextVenueId,
      businessDate: nextDate,
      eventId:
        nextVenueId === current.venueId && nextDate === current.date
          ? current.eventId
          : null,
      actorUserId: user.id,
      purpose: "register",
    });
    const now = new Date().toISOString();
    const activityId = crypto.randomUUID();
    const { env } = getCloudflareContext();
    const writeResults = await env.DB.batch<{ id: string }>([
      env.DB.prepare(UPDATE_GUEST_DETAILS_SQL).bind(
        nextVenueId,
        nextName,
        nextDate,
        event.id,
        now,
        guestId,
        current.venueId,
        nextVenueId,
        event.id,
        nextVenueId,
        nextDate,
        canAdministerGuests ? 1 : 0,
        user.id,
      ),
      prepareGuestActivityAfterChange(env.DB, {
        activityId,
        venueId: nextVenueId,
        eventId: event.id,
        guestId,
        action: "update",
        actorUserId: user.id,
        actorType: "user",
        channel: canAdministerGuests ? "admin" : "guest",
        requestId: crypto.randomUUID(),
        previousStatus: current.status,
        nextStatus: current.status,
        sessionKeyHash: await getCurrentSessionKeyHash(),
        occurredAt: now,
      }),
    ]);
    if (
      writeResults[0]?.results[0]?.id !== guestId ||
      writeResults[1]?.results[0]?.id !== activityId
    ) {
      throw new Error("Guest update and activity ledger diverged");
    }
    const [updated] = await db
      .select()
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.venueId, nextVenueId)))
      .limit(1);
    if (!updated) throw new Error("Guest is no longer accessible");
    return { data: { ...updated, status: updated.status as Guest["status"] }, error: null };
  } catch (error: unknown) {
    await reportServerError("guest.update", error);
    return { data: null, error: "Unable to update guest right now." };
  }
}

export async function restoreGuest(guestId: string): Promise<ApiResponse<Guest>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const current = await getAccessibleGuest(db, user, guestId);
    if (current.externalLinkId) {
      return { data: null, error: "EXTERNAL_GUEST_RESTORE_UNSUPPORTED" };
    }
    const event = await resolveEventForRosterWrite({
      venueId: current.venueId,
      businessDate: current.date,
      eventId: current.eventId,
      actorUserId: user.id,
      purpose: "register",
    });
    const now = new Date().toISOString();
    const activityId = crypto.randomUUID();
    const { env } = getCloudflareContext();
    const results = await env.DB.batch<{ id: string }>([
      env.DB.prepare(RESTORE_DELETED_GUEST_SQL).bind(
        now,
        event.id,
        guestId,
        current.venueId,
        event.id,
        eventIncludesLegacyDateRows(event) ? 1 : 0,
        current.date,
        event.id,
      ),
      prepareGuestActivityAfterChange(env.DB, {
        activityId,
        venueId: current.venueId,
        eventId: event.id,
        guestId,
        action: "restore",
        actorUserId: user.id,
        actorType: "user",
        channel: "admin",
        requestId: crypto.randomUUID(),
        previousStatus: "deleted",
        nextStatus: "pending",
        sessionKeyHash: await getCurrentSessionKeyHash(),
        occurredAt: now,
      }),
    ]);
    if (
      results[0]?.results[0]?.id !== guestId ||
      results[1]?.results[0]?.id !== activityId
    ) {
      return { data: null, error: "GUEST_RESTORE_REJECTED" };
    }
    const [restored] = await db
      .select()
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.venueId, current.venueId)))
      .limit(1);
    return restored
      ? { data: { ...restored, status: restored.status as Guest["status"] }, error: null }
      : { data: null, error: "GUEST_RESTORE_REJECTED" };
  } catch (error: unknown) {
    await reportServerError("guest.restore", error);
    return { data: null, error: "Unable to restore guest right now." };
  }
}
