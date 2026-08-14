"use server";

import { and, eq, inArray } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAccess } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import {
  guestActivityLedger,
  guestActivityRequests,
  guests,
} from "@/lib/db/schema";
import { loadEventById } from "@/lib/events/server";
import {
  hashOpaqueIdentifier,
  persistGuestStatusActivity,
} from "@/lib/guests/activity-ledger";
import {
  desiredOfflineDoorStatus,
  prepareOfflineDoorSyncBatch,
  resolveOfflineDoorSyncOutcome,
  type OfflineDoorSyncResult,
} from "@/lib/door/offline-sync";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import { reportServerError } from "@/lib/observability/structured-log";
import type { ApiResponse } from "@/lib/api/types";
import {
  parseDoorGuestCode,
  type OfflineDoorGuest,
} from "@/lib/door/offline-domain";

export async function findDoorGuestByCode(params: {
  venueId: string;
  eventId: string;
  businessDate: string;
  code: string;
}): Promise<ApiResponse<OfflineDoorGuest>> {
  try {
    const guestId = parseDoorGuestCode(params.code);
    if (!guestId) return { data: null, error: "INVALID_DOOR_GUEST_CODE" };
    const actor = await requireAccess("door");
    const venueId = actor.role === "super_admin" ? params.venueId : actor.venueId;
    if (!venueId || venueId !== params.venueId) {
      return { data: null, error: "DOOR_GUEST_CODE_FORBIDDEN" };
    }
    await requireActiveVenueId(venueId);
    const db = getDb();
    const event = await loadEventById(db, params.eventId);
    if (
      !event ||
      event.venueId !== venueId ||
      event.businessDate !== params.businessDate ||
      event.compatibilityKey !== null ||
      event.state !== "open"
    ) {
      return { data: null, error: "DOOR_GUEST_CODE_EVENT_UNAVAILABLE" };
    }
    const [guest] = await db
      .select({
        id: guests.id,
        name: guests.name,
        status: guests.status,
        checkInTime: guests.checkInTime,
      })
      .from(guests)
      .where(
        and(
          eq(guests.id, guestId),
          eq(guests.venueId, venueId),
          eq(guests.eventId, event.id),
        ),
      )
      .limit(1);
    return guest && (guest.status === "pending" || guest.status === "checked")
      ? { data: { ...guest, status: guest.status }, error: null }
      : { data: null, error: "DOOR_GUEST_CODE_NOT_FOUND" };
  } catch (error: unknown) {
    await reportServerError("door.guest_code_lookup", error);
    return { data: null, error: "DOOR_GUEST_CODE_LOOKUP_FAILED" };
  }
}

export async function fetchOfflineDoorRoster(params: {
  venueId: string;
  eventId: string;
  businessDate: string;
}): Promise<ApiResponse<OfflineDoorGuest[]>> {
  try {
    const actor = await requireAccess("door");
    const venueId = actor.role === "super_admin" ? params.venueId : actor.venueId;
    if (!venueId || venueId !== params.venueId) {
      return { data: null, error: "OFFLINE_DOOR_FORBIDDEN" };
    }
    await requireActiveVenueId(venueId);
    const db = getDb();
    const event = await loadEventById(db, params.eventId);
    if (
      !event ||
      event.venueId !== venueId ||
      event.businessDate !== params.businessDate ||
      event.compatibilityKey !== null ||
      event.state !== "open"
    ) {
      return { data: null, error: "OFFLINE_DOOR_EVENT_UNAVAILABLE" };
    }
    const rows = await db
      .select({
        id: guests.id,
        name: guests.name,
        status: guests.status,
        checkInTime: guests.checkInTime,
      })
      .from(guests)
      .where(
        and(
          eq(guests.venueId, venueId),
          eq(guests.eventId, event.id),
        ),
      );
    return {
      data: rows.flatMap((row) =>
        row.status === "pending" || row.status === "checked"
          ? [{ ...row, status: row.status }]
          : [],
      ),
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("door.offline_roster", error);
    return { data: null, error: "OFFLINE_DOOR_ROSTER_FAILED" };
  }
}

export async function syncOfflineDoorMutations(params: {
  venueId: string;
  eventId: string;
  businessDate: string;
  deviceId: string;
  items: unknown[];
}): Promise<ApiResponse<OfflineDoorSyncResult[]>> {
  try {
    const actor = await requireAccess("door");
    const venueId = actor.role === "super_admin" ? params.venueId : actor.venueId;
    if (!venueId || venueId !== params.venueId) {
      return { data: null, error: "OFFLINE_DOOR_FORBIDDEN" };
    }
    await requireActiveVenueId(venueId);
    const batch = prepareOfflineDoorSyncBatch({
      deviceId: params.deviceId,
      items: params.items,
    });
    const db = getDb();
    const event = await loadEventById(db, params.eventId);
    if (
      !event ||
      event.venueId !== venueId ||
      event.businessDate !== params.businessDate ||
      event.compatibilityKey !== null
    ) {
      return { data: null, error: "OFFLINE_DOOR_EVENT_UNAVAILABLE" };
    }
    if (event.state !== "open") {
      return {
        data: batch.items.map((item) => ({
          idempotencyKey: item.idempotencyKey,
          guestId: item.guestId,
          state: "rejected" as const,
          resolution: null,
          status: null,
          checkInTime: null,
        })),
        error: null,
      };
    }

    const deviceKeyHash = await hashOpaqueIdentifier(batch.deviceId);
    const { env } = getCloudflareContext();
    const results: OfflineDoorSyncResult[] = [];
    for (const item of batch.items) {
      const desiredStatus = desiredOfflineDoorStatus(item.action);
      if (item.expired) {
        results.push({
          idempotencyKey: item.idempotencyKey,
          guestId: item.guestId,
          state: "rejected",
          resolution: null,
          status: null,
          checkInTime: null,
        });
        continue;
      }
      let action = item.action;
      if (desiredStatus === "checked") {
        const [existingRequest] = await db
          .select({
            guestId: guestActivityRequests.guestId,
            action: guestActivityRequests.action,
          })
          .from(guestActivityRequests)
          .where(
            and(
              eq(guestActivityRequests.venueId, venueId),
              eq(guestActivityRequests.idempotencyKey, item.idempotencyKey),
            ),
          )
          .limit(1);
        if (
          existingRequest?.guestId === item.guestId &&
          (existingRequest.action === "check_in" ||
            existingRequest.action === "re_entry")
        ) {
          action = existingRequest.action;
        } else {
          const [previousEntry] = await db
            .select({ id: guestActivityLedger.id })
            .from(guestActivityLedger)
            .where(
              and(
                eq(guestActivityLedger.venueId, venueId),
                eq(guestActivityLedger.eventId, event.id),
                eq(guestActivityLedger.guestId, item.guestId),
                eq(guestActivityLedger.outcome, "applied"),
                inArray(guestActivityLedger.action, ["check_in", "re_entry"]),
              ),
            )
            .limit(1);
          action = previousEntry ? "re_entry" : "check_in";
        }
      }
      const persistence = await persistGuestStatusActivity(env.DB, {
        venueId,
        eventId: event.id,
        includeLegacyDateRows: false,
        businessDate: event.businessDate,
        guestId: item.guestId,
        action,
        actorUserId: actor.id,
        channel: "door",
        idempotencyKey: item.idempotencyKey,
        occurredAt: item.queuedAt,
        deviceKeyHash,
      });
      if (persistence.outcome === "unavailable") {
        throw new Error("OFFLINE_DOOR_SYNC_UNAVAILABLE");
      }
      const [current] = await db
        .select({
          status: guests.status,
          checkInTime: guests.checkInTime,
        })
        .from(guests)
        .where(
          and(
            eq(guests.id, item.guestId),
            eq(guests.venueId, venueId),
            eq(guests.eventId, event.id),
          ),
        )
        .limit(1);
      results.push(resolveOfflineDoorSyncOutcome({
        idempotencyKey: item.idempotencyKey,
        guestId: item.guestId,
        persistenceOutcome: persistence.outcome,
        persistedStatus: persistence.status,
        persistedCheckInTime: persistence.checkInTime,
        currentStatus:
          current?.status === "pending" ||
          current?.status === "checked" ||
          current?.status === "deleted"
            ? current.status
            : null,
        currentCheckInTime: current?.checkInTime ?? null,
        desiredStatus,
      }));
    }
    return { data: results, error: null };
  } catch (error: unknown) {
    await reportServerError("door.offline_sync", error);
    return { data: null, error: "OFFLINE_DOOR_SYNC_FAILED" };
  }
}
