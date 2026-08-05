"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq, and, ne, desc, inArray } from "drizzle-orm";
import { guests } from "../db/schema";
import {
  type ApiResponse,
  type BulkGuestCreateInput,
  type BulkGuestCreateItemResult,
  type BulkGuestCreateResult,
  type Guest,
} from "./types";
import { requireAccess, requireAuth, requireRole, type SessionUser } from "../auth/server";
import { getDb } from "../db/client";
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
  UPDATE_ACTIVE_GUEST_STATUS_SQL,
} from "@/lib/guests/atomic-sql";

type Db = ReturnType<typeof getDb>;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

function scopedVenueId(user: SessionUser, requestedVenueId?: string | null): string | undefined {
  if (user.role === "super_admin") return requestedVenueId ?? undefined;
  if (!user.venueId) throw new Error("Forbidden");
  if (requestedVenueId && requestedVenueId !== user.venueId) throw new Error("Forbidden");
  return user.venueId;
}

async function getAccessibleGuest(db: Db, user: SessionUser, guestId: string) {
  const rows = await db
    .select({
      id: guests.id,
      venueId: guests.venueId,
      externalLinkId: guests.externalLinkId,
      createdByUserId: guests.createdByUserId,
      status: guests.status,
    })
    .from(guests)
    .where(eq(guests.id, guestId))
    .limit(1);
  const guest = rows[0];
  if (!guest) throw new Error("Guest not found");
  if (user.role !== "super_admin" && guest.venueId !== user.venueId) throw new Error("Forbidden");
  return guest;
}

export async function fetchGuestsByDate(date: string, venueId?: string): Promise<ApiResponse<Guest[]>> {
  try {
    const user = await requireAccess("door");
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, venueId);
    const conditions = [eq(guests.date, date), ne(guests.status, "deleted")];
    if (effectiveVenueId) conditions.push(eq(guests.venueId, effectiveVenueId));

    const result = await db.select().from(guests)
      .where(and(...conditions))
      .orderBy(desc(guests.createdAt));

    return { data: result.map((g) => ({ ...g, status: g.status as Guest["status"] })), error: null };
  } catch (error: unknown) {
    console.error("Failed to fetch guests by date:", error);
    return { data: null, error: "Unable to load guests right now." };
  }
}

export async function fetchAllGuests(venueId?: string): Promise<ApiResponse<Guest[]>> {
  try {
    const user = await requireAccess("admin");
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, venueId);
    const baseQuery = db.select().from(guests);
    const result = await (
      effectiveVenueId ? baseQuery.where(eq(guests.venueId, effectiveVenueId)) : baseQuery
    ).orderBy(desc(guests.date), desc(guests.createdAt));

    return { data: result.map((g) => ({ ...g, status: g.status as Guest["status"] })), error: null };
  } catch (error: unknown) {
    console.error("Failed to fetch all guests:", error);
    return { data: null, error: "Unable to load guests right now." };
  }
}

export async function createGuest(guest: {
  venueId: string;
  name: string;
  registeredByName?: string | null;
  date: string;
}): Promise<ApiResponse<Guest>> {
  const response = await createGuests({
    venueId: guest.venueId,
    date: guest.date,
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
  registeredByName?: string | null;
  items: BulkGuestCreateInput[];
}): Promise<ApiResponse<BulkGuestCreateResult>> {
  try {
    const user = await requireAccess("guest");
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, params.venueId);
    if (!effectiveVenueId) throw new Error("Venue is required");
    if (!isValidDate(params.date)) return { data: null, error: "INVALID_DATE" };
    if (!Array.isArray(params.items) || params.items.length > MAX_BULK_WRITE_NAMES) {
      return { data: null, error: "BULK_LIMIT_EXCEEDED" };
    }

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
          eq(guests.date, params.date),
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
    const statements = pendingGuests.map((pending) =>
      env.DB.prepare(INTERNAL_BULK_GUEST_INSERT_SQL).bind(
        pending.id,
        effectiveVenueId,
        pending.name,
        user.id,
        user.accountKind === "shared" ? registeredByName : null,
        params.date,
        now,
        now,
        pending.allowDuplicate ? 1 : 0,
        effectiveVenueId,
        user.id,
        params.date,
        pending.name,
        user.guestLimit,
        user.id,
        params.date,
        user.guestLimit ?? 0,
        user.id,
        params.date,
      ),
    );
    const insertResults = await env.DB.batch<{ id: string }>(statements);
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
            eq(guests.date, params.date),
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
    console.error("Failed to create guests:", error);
    return { data: null, error: "Unable to create guests right now." };
  }
}

export async function updateGuestStatus(
  guestId: string,
  status: "pending" | "checked",
): Promise<ApiResponse<Guest>> {
  try {
    if (status !== "pending" && status !== "checked") {
      return { data: null, error: "INVALID_GUEST_STATUS" };
    }
    const user = await requireAccess("door");
    const db = getDb();
    const current = await getAccessibleGuest(db, user, guestId);
    const now = new Date().toISOString();
    const checkInTime = status === "checked" ? now : null;
    const { env } = getCloudflareContext();
    const updated = await env.DB.prepare(UPDATE_ACTIVE_GUEST_STATUS_SQL)
      .bind(status, checkInTime, now, guestId, current.venueId, status)
      .first<{ id: string }>();
    if (!updated) throw new Error("Guest is deleted or no longer accessible");

    const result = await db
      .select()
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.venueId, current.venueId)))
      .limit(1);
    if (!result[0]) throw new Error("Guest is no longer accessible");
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to update guest status:", error);
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
    const now = new Date().toISOString();
    const statements = [
      env.DB.prepare(SOFT_DELETE_GUEST_SQL).bind(
        now,
        guestId,
        current.venueId,
        canDeleteVenueWide ? 1 : 0,
        user.id,
      ),
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

    const updatedRows = await db
      .select()
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.venueId, current.venueId)))
      .limit(1);
    const updated = updatedRows[0];
    if (!updated) throw new Error("Guest is no longer accessible");

    return { data: updated ? { ...updated, status: updated.status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to delete guest:", error);
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
    const statements = current.externalLinkId
      ? [
        env.DB.prepare(DECREMENT_EXTERNAL_LINK_FOR_ACTIVE_GUEST_SQL).bind(
          current.externalLinkId,
          guestId,
          current.externalLinkId,
          current.venueId,
        ),
        deleteStatement,
      ]
      : [deleteStatement];
    const deleteResults = await env.DB.batch<{ id: string }>(statements);
    const deleteResultIndex = current.externalLinkId ? 1 : 0;
    if (deleteResults[deleteResultIndex]?.results[0]?.id !== guestId) {
      throw new Error("Guest is no longer accessible");
    }
    return { error: null };
  } catch (error: unknown) {
    console.error("Failed to permanently delete guest:", error);
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
    const updateData: Partial<typeof guests.$inferInsert> = { updatedAt: new Date().toISOString() };

    if (updates.name !== undefined) {
      const preparedName = prepareGuestName(updates.name);
      if (preparedName.error !== null) {
        return { data: null, error: "INVALID_GUEST_NAME" };
      }
      updateData.name = toStoredGuestName(preparedName.name);
    }
    if (updates.date !== undefined) {
      if (!isValidDate(updates.date)) {
        return { data: null, error: "INVALID_DATE" };
      }
      updateData.date = updates.date;
    }
    if (updates.venueId !== undefined) {
      const effectiveVenueId = scopedVenueId(user, updates.venueId);
      if (!effectiveVenueId) throw new Error("Venue is required");
      updateData.venueId = effectiveVenueId;
    }

    const updateConditions = [
      eq(guests.id, guestId),
      eq(guests.venueId, current.venueId),
    ];
    if (!canAdministerGuests) {
      updateConditions.push(eq(guests.createdByUserId, user.id));
    }
    const result = await db
      .update(guests)
      .set(updateData)
      .where(and(...updateConditions))
      .returning();
    if (!result[0]) throw new Error("Guest is no longer accessible");
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to update guest:", error);
    return { data: null, error: "Unable to update guest right now." };
  }
}
