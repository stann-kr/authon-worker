"use server";

import { cookies } from "next/headers";

import { reportServerError } from "@/lib/observability/structured-log";
import { requireAccess, requireAuth, requireRole, type SessionUser } from "@/lib/auth/server";
import {
  eventIncludesLegacyDateRows,
  findCompatibilityEvent,
  loadEventForRosterReadById,
  resolveEventForRosterRead,
  resolveEventForRosterWrite,
} from "@/lib/events/server";
import { getOrCreateEventContributorGuestLimit } from "@/lib/guest-limits/server";
import { hashOpaqueIdentifier } from "@/lib/guests/activity-ledger";
import { createGuestPersistence } from "@/lib/guests/persistence";
import {
  createGuestBatch,
  deleteManagedGuest,
  listAllGuests,
  listGuestsByDate,
  permanentlyDeleteManagedGuest,
  restoreManagedGuest,
  updateManagedGuest,
  updateManagedGuestStatus,
  type GuestServiceActor,
  type GuestServiceDependencies,
} from "@/lib/guests/service";
import type {
  BulkGuestCreateInput,
  BulkGuestCreateResult,
  Guest,
} from "@/lib/guests/types";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import type { ApiResponse } from "./response";

function toGuestServiceActor(user: SessionUser): GuestServiceActor {
  return {
    id: user.id,
    role: user.role,
    venueId: user.venueId,
    guestLimit: user.guestLimit,
    accountKind: user.accountKind,
    doorAccessEnabled: user.doorAccessEnabled,
  };
}

function getGuestServiceDependencies(): GuestServiceDependencies {
  return {
    persistence: createGuestPersistence(),
    requireActiveVenueId,
    loadEventForRosterReadById,
    findCompatibilityEvent,
    resolveEventForRosterRead,
    resolveEventForRosterWrite,
    eventIncludesLegacyDateRows,
    getOrCreateEventContributorGuestLimit,
  };
}

async function getCurrentSessionKeyHash(): Promise<string | null> {
  const sessionId = (await cookies()).get("sessionId")?.value;
  return sessionId ? hashOpaqueIdentifier(sessionId) : null;
}

export async function fetchGuestsByDate(
  date: string,
  venueId?: string,
  eventId?: string | null,
): Promise<ApiResponse<Guest[]>> {
  try {
    const actor = await requireAccess("door");
    return {
      data: await listGuestsByDate(
        {
          actor: toGuestServiceActor(actor),
          date,
          requestedVenueId: venueId,
          eventId,
        },
        getGuestServiceDependencies(),
      ),
      error: null,
    };
  } catch (error) {
    await reportServerError("guest.list_by_date", error);
    return { data: null, error: "Unable to load guests right now." };
  }
}

export async function fetchAllGuests(
  venueId?: string,
): Promise<ApiResponse<Guest[]>> {
  try {
    const actor = await requireAccess("admin");
    return {
      data: await listAllGuests(
        { actor: toGuestServiceActor(actor), requestedVenueId: venueId },
        getGuestServiceDependencies(),
      ),
      error: null,
    };
  } catch (error) {
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

export async function createGuests(params: {
  venueId: string;
  date: string;
  eventId?: string | null;
  registeredByName?: string | null;
  items: BulkGuestCreateInput[];
}): Promise<ApiResponse<BulkGuestCreateResult>> {
  try {
    const actor = await requireAccess("guest");
    return await createGuestBatch(
      { actor: toGuestServiceActor(actor), ...params },
      getGuestServiceDependencies(),
    );
  } catch (error) {
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
    const actor = await requireAccess("door");
    return await updateManagedGuestStatus(
      {
        actor: toGuestServiceActor(actor),
        guestId,
        status,
        idempotencyKey,
        sessionKeyHash: await getCurrentSessionKeyHash(),
      },
      getGuestServiceDependencies(),
    );
  } catch (error) {
    await reportServerError("guest.status_update", error);
    return { data: null, error: "Unable to update guest status right now." };
  }
}

export async function deleteGuest(
  guestId: string,
): Promise<ApiResponse<Guest>> {
  try {
    const actor = await requireAuth();
    return {
      data: await deleteManagedGuest(
        {
          actor: toGuestServiceActor(actor),
          guestId,
          sessionKeyHash: await getCurrentSessionKeyHash(),
        },
        getGuestServiceDependencies(),
      ),
      error: null,
    };
  } catch (error) {
    await reportServerError("guest.delete", error);
    return { data: null, error: "Unable to delete guest right now." };
  }
}

export async function permanentlyDeleteGuest(
  guestId: string,
): Promise<{ error: string | null }> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    await permanentlyDeleteManagedGuest(
      {
        actor: toGuestServiceActor(actor),
        guestId,
        sessionKeyHash: await getCurrentSessionKeyHash(),
      },
      getGuestServiceDependencies(),
    );
    return { error: null };
  } catch (error) {
    await reportServerError("guest.delete_permanent", error);
    return { error: "Unable to permanently delete guest right now." };
  }
}

export async function updateGuest(
  guestId: string,
  updates: { name?: string; date?: string; venueId?: string },
): Promise<ApiResponse<Guest>> {
  try {
    const actor = await requireAuth();
    return await updateManagedGuest(
      {
        actor: toGuestServiceActor(actor),
        guestId,
        updates,
        sessionKeyHash: await getCurrentSessionKeyHash(),
      },
      getGuestServiceDependencies(),
    );
  } catch (error) {
    await reportServerError("guest.update", error);
    return { data: null, error: "Unable to update guest right now." };
  }
}

export async function restoreGuest(
  guestId: string,
): Promise<ApiResponse<Guest>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    return await restoreManagedGuest(
      {
        actor: toGuestServiceActor(actor),
        guestId,
        sessionKeyHash: await getCurrentSessionKeyHash(),
      },
      getGuestServiceDependencies(),
    );
  } catch (error) {
    await reportServerError("guest.restore", error);
    return { data: null, error: "Unable to restore guest right now." };
  }
}
