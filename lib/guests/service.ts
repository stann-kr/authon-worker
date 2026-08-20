import type { Event } from "../events/types.ts";
import { hasAccess, type AccountKind, type Role } from "../users/policy.ts";
import {
  MAX_BULK_WRITE_NAMES,
  prepareGuestName,
  toStoredGuestName,
} from "./bulk-entry.ts";
import type {
  AccessibleGuestRecord,
  GuestPersistence,
  PendingBulkGuestWrite,
} from "./persistence.ts";
import type {
  BulkGuestCreateInput,
  BulkGuestCreateItemResult,
  BulkGuestCreateResult,
  Guest,
} from "./types.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface GuestServiceActor {
  id: string;
  role: Role;
  venueId: string | null;
  guestLimit: number | null;
  accountKind: AccountKind;
  doorAccessEnabled: boolean;
}

export interface GuestServiceDependencies {
  persistence: GuestPersistence;
  requireActiveVenueId(venueId: string): Promise<string>;
  loadEventForRosterReadById(input: {
    eventId: string;
    businessDate: string;
    venueId?: string | null;
  }): Promise<Event>;
  findCompatibilityEvent(
    venueId: string,
    businessDate: string,
  ): Promise<Event | null>;
  resolveEventForRosterRead(input: {
    venueId: string;
    businessDate: string;
    eventId?: string | null;
  }): Promise<Event | null>;
  resolveEventForRosterWrite(input: {
    venueId: string;
    businessDate: string;
    eventId?: string | null;
    actorUserId?: string | null;
    purpose: "register" | "check_in";
  }): Promise<Event>;
  eventIncludesLegacyDateRows(event: Event): boolean;
  getOrCreateEventContributorGuestLimit(input: {
    event: Event;
    venueId: string;
    userId: string;
    fallbackGuestLimit: number | null;
    createdByUserId: string;
    createdAt: string;
  }): Promise<number | null>;
  now?: () => Date;
  createId?: () => string;
}

export interface GuestServiceResult<T> {
  data: T | null;
  error: string | null;
}

export function isValidGuestDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
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
  actor: GuestServiceActor,
  requestedVenueId: string | null | undefined,
  requireActiveVenueId: GuestServiceDependencies["requireActiveVenueId"],
): Promise<string | undefined> {
  const venueId =
    actor.role === "super_admin"
      ? requestedVenueId ?? undefined
      : actor.venueId ?? undefined;
  if (
    actor.role !== "super_admin" &&
    (!venueId || (requestedVenueId && requestedVenueId !== venueId))
  ) {
    throw new Error("Forbidden");
  }
  return venueId ? requireActiveVenueId(venueId) : undefined;
}

async function requireAccessibleGuest(
  actor: GuestServiceActor,
  guestId: string,
  dependencies: Pick<
    GuestServiceDependencies,
    "persistence" | "requireActiveVenueId"
  >,
): Promise<AccessibleGuestRecord> {
  const guest = await dependencies.persistence.loadGuest(guestId);
  if (!guest) throw new Error("Guest not found");
  if (actor.role !== "super_admin" && guest.venueId !== actor.venueId) {
    throw new Error("Forbidden");
  }
  await dependencies.requireActiveVenueId(guest.venueId);
  return guest;
}

function createId(dependencies: GuestServiceDependencies): string {
  return (dependencies.createId ?? (() => crypto.randomUUID()))();
}

function nowIso(dependencies: GuestServiceDependencies): string {
  return (dependencies.now?.() ?? new Date()).toISOString();
}

export async function listGuestsByDate(
  input: {
    actor: GuestServiceActor;
    date: string;
    requestedVenueId?: string;
    eventId?: string | null;
  },
  dependencies: GuestServiceDependencies,
): Promise<Guest[]> {
  let venueId = await scopedVenueId(
    input.actor,
    input.requestedVenueId,
    dependencies.requireActiveVenueId,
  );
  let event: Event | null = null;
  let includeLegacyDateRows = false;
  if (input.eventId) {
    event = await dependencies.loadEventForRosterReadById({
      eventId: input.eventId,
      businessDate: input.date,
      venueId,
    });
    venueId = event.venueId;
  } else if (venueId) {
    event = await dependencies.findCompatibilityEvent(venueId, input.date);
    includeLegacyDateRows = event
      ? dependencies.eventIncludesLegacyDateRows(event)
      : false;
  }
  return dependencies.persistence.listByDate({
    date: input.date,
    venueId,
    eventId: event?.id ?? null,
    includeLegacyDateRows,
  });
}

export async function listAllGuests(
  input: { actor: GuestServiceActor; requestedVenueId?: string },
  dependencies: Pick<
    GuestServiceDependencies,
    "persistence" | "requireActiveVenueId"
  >,
): Promise<Guest[]> {
  const venueId = await scopedVenueId(
    input.actor,
    input.requestedVenueId,
    dependencies.requireActiveVenueId,
  );
  return dependencies.persistence.listAll(venueId);
}

export async function createGuestBatch(
  input: {
    actor: GuestServiceActor;
    venueId: string;
    date: string;
    eventId?: string | null;
    registeredByName?: string | null;
    items: BulkGuestCreateInput[];
  },
  dependencies: GuestServiceDependencies,
): Promise<GuestServiceResult<BulkGuestCreateResult>> {
  const venueId = await scopedVenueId(
    input.actor,
    input.venueId,
    dependencies.requireActiveVenueId,
  );
  if (!venueId) throw new Error("Venue is required");
  if (!isValidGuestDate(input.date)) {
    return { data: null, error: "INVALID_DATE" };
  }
  if (!Array.isArray(input.items) || input.items.length > MAX_BULK_WRITE_NAMES) {
    return { data: null, error: "BULK_LIMIT_EXCEEDED" };
  }

  const event = await dependencies.resolveEventForRosterWrite({
    venueId,
    businessDate: input.date,
    eventId: input.eventId,
    actorUserId: input.actor.id,
    purpose: "register",
  });
  const occurredAt = nowIso(dependencies);
  const baseGuestLimit =
    await dependencies.getOrCreateEventContributorGuestLimit({
      event,
      venueId,
      userId: input.actor.id,
      fallbackGuestLimit: input.actor.guestLimit,
      createdByUserId: input.actor.id,
      createdAt: occurredAt,
    });
  const includeLegacyDateRows =
    dependencies.eventIncludesLegacyDateRows(event);

  const preparedRegisteredByName = prepareGuestName(input.registeredByName);
  const registeredByName =
    preparedRegisteredByName.error === null &&
    preparedRegisteredByName.name.length <= 80
      ? preparedRegisteredByName.name
      : null;
  if (
    input.actor.accountKind === "shared" &&
    (!registeredByName || registeredByName.length > 80)
  ) {
    return { data: null, error: "REGISTERED_BY_REQUIRED" };
  }

  const existingNames = await dependencies.persistence.listExistingNames({
    venueId,
    eventId: event.id,
    date: input.date,
    includeLegacyDateRows,
    createdByUserId: input.actor.id,
  });
  const seenKeys = new Set<string>();
  for (const name of existingNames) {
    const prepared = prepareGuestName(name);
    if (prepared.error === null) seenKeys.add(prepared.key);
  }

  const itemResults: BulkGuestCreateItemResult[] = input.items.map(
    (_, index) => ({ index, status: "invalid_name", guest: null }),
  );
  const pending: Array<PendingBulkGuestWrite & { index: number }> = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const parsed = parseBulkGuestCreateInput(input.items[index]);
    if (!parsed) continue;
    const prepared = prepareGuestName(parsed.name);
    if (prepared.error !== null) continue;
    if (seenKeys.has(prepared.key) && !parsed.allowDuplicate) {
      itemResults[index] = {
        index,
        status: "duplicate_requires_confirmation",
        guest: null,
      };
      continue;
    }

    seenKeys.add(prepared.key);
    pending.push({
      index,
      id: createId(dependencies),
      name: toStoredGuestName(prepared.name),
      key: prepared.key,
      allowDuplicate: parsed.allowDuplicate,
      activityId: createId(dependencies),
      requestId: createId(dependencies),
    });
  }
  if (pending.length === 0) {
    return { data: { items: itemResults }, error: null };
  }

  const outcomes = await dependencies.persistence.createBulk({
    pending,
    venueId,
    eventId: event.id,
    date: input.date,
    includeLegacyDateRows,
    actorUserId: input.actor.id,
    registeredByName:
      input.actor.accountKind === "shared" ? registeredByName : null,
    baseGuestLimit,
    channel: hasAccess(input.actor, ["admin"]) ? "admin" : "guest",
    occurredAt,
  });
  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
    const candidate = pending[pendingIndex];
    const outcome = outcomes[pendingIndex];
    if (!outcome || outcome.id !== candidate.id) {
      throw new Error("Bulk guest write result diverged");
    }
    itemResults[candidate.index] = outcome.guest
      ? { index: candidate.index, status: "created", guest: outcome.guest }
      : {
          index: candidate.index,
          status: outcome.concurrentDuplicate
            ? "duplicate_requires_confirmation"
            : "limit_reached",
          guest: null,
        };
  }
  return { data: { items: itemResults }, error: null };
}

export async function updateManagedGuestStatus(
  input: {
    actor: GuestServiceActor;
    guestId: string;
    status: "pending" | "checked";
    idempotencyKey: string;
    sessionKeyHash: string | null;
  },
  dependencies: GuestServiceDependencies,
): Promise<GuestServiceResult<Guest>> {
  if (input.status !== "pending" && input.status !== "checked") {
    return { data: null, error: "INVALID_GUEST_STATUS" };
  }
  const current = await requireAccessibleGuest(
    input.actor,
    input.guestId,
    dependencies,
  );
  const existingRequest = await dependencies.persistence.findStatusRequest({
    venueId: current.venueId,
    idempotencyKey: input.idempotencyKey,
  });
  const readableEvent = await dependencies.resolveEventForRosterRead({
    venueId: current.venueId,
    businessDate: current.date,
    eventId: current.eventId,
  });
  const event = existingRequest
    ? readableEvent
    : await dependencies.resolveEventForRosterWrite({
        venueId: current.venueId,
        businessDate: current.date,
        eventId: current.eventId,
        actorUserId: input.actor.id,
        purpose: "check_in",
      });
  if (!event) throw new Error("EVENT_NOT_FOUND");

  let action: "check_in" | "cancel_check_in" | "re_entry" =
    input.status === "pending" ? "cancel_check_in" : "check_in";
  if (input.status === "checked") {
    if (
      existingRequest?.guestId === input.guestId &&
      (existingRequest.action === "check_in" ||
        existingRequest.action === "re_entry")
    ) {
      action = existingRequest.action;
    } else if (
      await dependencies.persistence.hasPreviousEntry({
        venueId: current.venueId,
        guestId: input.guestId,
      })
    ) {
      action = "re_entry";
    }
  }

  const mutation = await dependencies.persistence.persistStatusActivity({
    venueId: current.venueId,
    eventId: event.id,
    attendanceScopeEventId: dependencies.eventIncludesLegacyDateRows(event)
      ? null
      : event.id,
    includeLegacyDateRows: dependencies.eventIncludesLegacyDateRows(event),
    businessDate: current.date,
    guestId: input.guestId,
    action,
    actorUserId: input.actor.id,
    channel: hasAccess(input.actor, ["admin"]) ? "admin" : "door",
    idempotencyKey: input.idempotencyKey,
    occurredAt: nowIso(dependencies),
    sessionKeyHash: input.sessionKeyHash,
  });
  if (mutation.outcome === "conflict") {
    return { data: null, error: "IDEMPOTENCY_CONFLICT" };
  }
  if (mutation.outcome === "rejected") {
    return { data: null, error: "GUEST_ACTIVITY_REJECTED" };
  }
  if (mutation.outcome === "scope_closed") {
    return { data: null, error: "ATTENDANCE_SCOPE_CLOSED" };
  }
  if (mutation.outcome === "unavailable") {
    throw new Error("Guest activity unavailable");
  }
  if (mutation.status === null) {
    throw new Error("Guest activity result unavailable");
  }

  const updated = await dependencies.persistence.readGuest(
    input.guestId,
    current.venueId,
  );
  if (!updated) throw new Error("Guest is no longer accessible");
  return {
    data: {
      ...updated,
      status: mutation.status,
      checkInTime: mutation.checkInTime,
    },
    error: null,
  };
}

export async function deleteManagedGuest(
  input: {
    actor: GuestServiceActor;
    guestId: string;
    sessionKeyHash: string | null;
  },
  dependencies: GuestServiceDependencies,
): Promise<Guest> {
  const current = await requireAccessibleGuest(
    input.actor,
    input.guestId,
    dependencies,
  );
  const canDeleteVenueWide = hasAccess(input.actor, ["door"]);
  if (!canDeleteVenueWide && current.createdByUserId !== input.actor.id) {
    throw new Error("Forbidden");
  }
  const event = await dependencies.resolveEventForRosterWrite({
    venueId: current.venueId,
    businessDate: current.date,
    eventId: current.eventId,
    actorUserId: input.actor.id,
    purpose: "register",
  });
  return dependencies.persistence.softDelete({
    current,
    eventId: event.id,
    includeLegacyDateRows: dependencies.eventIncludesLegacyDateRows(event),
    canDeleteVenueWide,
    actorUserId: input.actor.id,
    channel: hasAccess(input.actor, ["admin"])
      ? "admin"
      : hasAccess(input.actor, ["door"])
        ? "door"
        : "guest",
    sessionKeyHash: input.sessionKeyHash,
    occurredAt: nowIso(dependencies),
    activityId: createId(dependencies),
    requestId: createId(dependencies),
  });
}

export async function permanentlyDeleteManagedGuest(
  input: {
    actor: GuestServiceActor;
    guestId: string;
    sessionKeyHash: string | null;
  },
  dependencies: GuestServiceDependencies,
): Promise<void> {
  if (input.actor.role !== "super_admin" && input.actor.role !== "venue_admin") {
    throw new Error("Forbidden");
  }
  const current = await requireAccessibleGuest(
    input.actor,
    input.guestId,
    dependencies,
  );
  await dependencies.persistence.permanentlyDelete({
    current,
    actorUserId: input.actor.id,
    sessionKeyHash: input.sessionKeyHash,
    occurredAt: nowIso(dependencies),
    activityId: createId(dependencies),
    requestId: createId(dependencies),
  });
}

export async function updateManagedGuest(
  input: {
    actor: GuestServiceActor;
    guestId: string;
    updates: { name?: string; date?: string; venueId?: string };
    sessionKeyHash: string | null;
  },
  dependencies: GuestServiceDependencies,
): Promise<GuestServiceResult<Guest>> {
  const current = await requireAccessibleGuest(
    input.actor,
    input.guestId,
    dependencies,
  );
  const canAdministerGuests = hasAccess(input.actor, ["admin"]);
  if (!canAdministerGuests && current.createdByUserId !== input.actor.id) {
    throw new Error("Forbidden");
  }
  if (
    !canAdministerGuests &&
    (input.updates.date !== undefined || input.updates.venueId !== undefined)
  ) {
    throw new Error("Forbidden");
  }
  if (
    current.externalLinkId &&
    (input.updates.date !== undefined || input.updates.venueId !== undefined)
  ) {
    return { data: null, error: "EXTERNAL_GUEST_SCOPE_LOCKED" };
  }

  let nextName = current.name;
  if (input.updates.name !== undefined) {
    const prepared = prepareGuestName(input.updates.name);
    if (prepared.error !== null) {
      return { data: null, error: "INVALID_GUEST_NAME" };
    }
    nextName = toStoredGuestName(prepared.name);
  }
  let nextDate = current.date;
  if (input.updates.date !== undefined) {
    if (!isValidGuestDate(input.updates.date)) {
      return { data: null, error: "INVALID_DATE" };
    }
    nextDate = input.updates.date;
  }
  let nextVenueId = current.venueId;
  if (input.updates.venueId !== undefined) {
    const venueId = await scopedVenueId(
      input.actor,
      input.updates.venueId,
      dependencies.requireActiveVenueId,
    );
    if (!venueId) throw new Error("Venue is required");
    nextVenueId = venueId;
  }
  const event = await dependencies.resolveEventForRosterWrite({
    venueId: nextVenueId,
    businessDate: nextDate,
    eventId:
      nextVenueId === current.venueId && nextDate === current.date
        ? current.eventId
        : null,
    actorUserId: input.actor.id,
    purpose: "register",
  });
  const updated = await dependencies.persistence.updateDetails({
    current,
    nextVenueId,
    nextName,
    nextDate,
    eventId: event.id,
    canAdministerGuests,
    actorUserId: input.actor.id,
    channel: canAdministerGuests ? "admin" : "guest",
    sessionKeyHash: input.sessionKeyHash,
    occurredAt: nowIso(dependencies),
    activityId: createId(dependencies),
    requestId: createId(dependencies),
  });
  return { data: updated, error: null };
}

export async function restoreManagedGuest(
  input: {
    actor: GuestServiceActor;
    guestId: string;
    sessionKeyHash: string | null;
  },
  dependencies: GuestServiceDependencies,
): Promise<GuestServiceResult<Guest>> {
  if (input.actor.role !== "super_admin" && input.actor.role !== "venue_admin") {
    throw new Error("Forbidden");
  }
  const current = await requireAccessibleGuest(
    input.actor,
    input.guestId,
    dependencies,
  );
  if (current.externalLinkId) {
    return { data: null, error: "EXTERNAL_GUEST_RESTORE_UNSUPPORTED" };
  }
  const event = await dependencies.resolveEventForRosterWrite({
    venueId: current.venueId,
    businessDate: current.date,
    eventId: current.eventId,
    actorUserId: input.actor.id,
    purpose: "register",
  });
  const restored = await dependencies.persistence.restore({
    current,
    eventId: event.id,
    includeLegacyDateRows: dependencies.eventIncludesLegacyDateRows(event),
    actorUserId: input.actor.id,
    sessionKeyHash: input.sessionKeyHash,
    occurredAt: nowIso(dependencies),
    activityId: createId(dependencies),
    requestId: createId(dependencies),
  });
  return restored
    ? { data: restored, error: null }
    : { data: null, error: "GUEST_RESTORE_REJECTED" };
}
