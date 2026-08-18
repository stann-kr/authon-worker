export const OFFLINE_DOOR_ROSTER_TTL_MS = 8 * 60 * 60 * 1_000;
export const OFFLINE_DOOR_QUEUE_TTL_MS = 12 * 60 * 60 * 1_000;
export const MAX_OFFLINE_DOOR_MUTATIONS = 100;

export type OfflineDoorAction = "check_in" | "cancel_check_in" | "re_entry";
export type OfflineDoorMutationState =
  | "queued"
  | "confirmed"
  | "conflict"
  | "rejected"
  | "scope_closed";

export interface OfflineDoorScope {
  venueId: string;
  eventId: string;
  businessDate: string;
}

export interface OfflineDoorGuest {
  id: string;
  name: string;
  status: "pending" | "checked";
  checkInTime: string | null;
}

export interface OfflineDoorRosterSnapshot {
  scope: OfflineDoorScope;
  guests: OfflineDoorGuest[];
  cachedAt: string;
  expiresAt: string;
}

export interface OfflineDoorMutation {
  idempotencyKey: string;
  deviceId: string;
  sequence: number;
  scope: OfflineDoorScope;
  guestId: string;
  action: OfflineDoorAction;
  queuedAt: string;
  expiresAt: string;
  state: OfflineDoorMutationState;
  resolution?: "applied" | "replayed" | "already_applied" | null;
}

function isBoundedOpaqueId(value: string): boolean {
  return value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9:_-]+$/.test(value);
}

export function buildDoorGuestCode(guestId: string): string {
  if (!isBoundedOpaqueId(guestId)) throw new Error("INVALID_DOOR_GUEST_ID");
  return `AUTHON:${guestId}`;
}

export function parseDoorGuestCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized.startsWith("AUTHON:")) return null;
  const guestId = normalized.slice("AUTHON:".length);
  return isBoundedOpaqueId(guestId) ? guestId : null;
}

function validScope(scope: OfflineDoorScope): boolean {
  return (
    isBoundedOpaqueId(scope.venueId) &&
    isBoundedOpaqueId(scope.eventId) &&
    /^\d{4}-\d{2}-\d{2}$/.test(scope.businessDate)
  );
}

export function createOfflineDoorMutation(params: {
  scope: OfflineDoorScope;
  deviceId: string;
  sequence: number;
  guestId: string;
  action: OfflineDoorAction;
  now?: Date;
}): OfflineDoorMutation {
  if (
    !validScope(params.scope) ||
    !isBoundedOpaqueId(params.deviceId) ||
    !isBoundedOpaqueId(params.guestId) ||
    !Number.isSafeInteger(params.sequence) ||
    params.sequence < 1 ||
    params.sequence > Number.MAX_SAFE_INTEGER ||
    !["check_in", "cancel_check_in", "re_entry"].includes(params.action)
  ) {
    throw new Error("INVALID_OFFLINE_DOOR_MUTATION");
  }
  const now = params.now ?? new Date();
  const queuedAt = now.toISOString();
  return {
    idempotencyKey: `offline:${params.deviceId}:${params.sequence}`,
    deviceId: params.deviceId,
    sequence: params.sequence,
    scope: { ...params.scope },
    guestId: params.guestId,
    action: params.action,
    queuedAt,
    expiresAt: new Date(now.getTime() + OFFLINE_DOOR_QUEUE_TTL_MS).toISOString(),
    state: "queued",
    resolution: null,
  };
}

export function transitionOfflineDoorMutation(
  mutation: OfflineDoorMutation,
  state: Exclude<OfflineDoorMutationState, "queued">,
  resolution: OfflineDoorMutation["resolution"] = null,
): OfflineDoorMutation {
  if (mutation.state !== "queued") {
    if (mutation.state === state) return mutation;
    throw new Error("OFFLINE_DOOR_MUTATION_FINAL");
  }
  return { ...mutation, state, resolution };
}

export function createOfflineDoorRosterSnapshot(params: {
  scope: OfflineDoorScope;
  guests: ReadonlyArray<{
    id: string;
    name: string;
    status: string;
    checkInTime?: string | null;
  }>;
  now?: Date;
}): OfflineDoorRosterSnapshot {
  if (!validScope(params.scope)) throw new Error("INVALID_OFFLINE_DOOR_SCOPE");
  const now = params.now ?? new Date();
  return {
    scope: { ...params.scope },
    guests: params.guests.flatMap((guest) => {
      if (
        !isBoundedOpaqueId(guest.id) ||
        typeof guest.name !== "string" ||
        guest.name.length === 0 ||
        guest.name.length > 100 ||
        (guest.status !== "pending" && guest.status !== "checked")
      ) {
        return [];
      }
      return [{
        id: guest.id,
        name: guest.name,
        status: guest.status,
        checkInTime: guest.checkInTime ?? null,
      }];
    }),
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OFFLINE_DOOR_ROSTER_TTL_MS).toISOString(),
  };
}

export function isOfflineDoorScopeEqual(
  left: OfflineDoorScope,
  right: OfflineDoorScope,
): boolean {
  return (
    left.venueId === right.venueId &&
    left.eventId === right.eventId &&
    left.businessDate === right.businessDate
  );
}

export function retainCurrentOfflineDoorData(params: {
  scope: OfflineDoorScope;
  snapshots: readonly OfflineDoorRosterSnapshot[];
  mutations: readonly OfflineDoorMutation[];
  now?: Date;
}) {
  const now = (params.now ?? new Date()).getTime();
  return {
    snapshots: params.snapshots.filter(
      (snapshot) =>
        isOfflineDoorScopeEqual(snapshot.scope, params.scope) &&
        new Date(snapshot.expiresAt).getTime() > now,
    ),
    mutations: params.mutations.filter(
      (mutation) =>
        isOfflineDoorScopeEqual(mutation.scope, params.scope) &&
        new Date(mutation.expiresAt).getTime() > now,
    ),
  };
}

export function applyQueuedDoorMutation(
  guests: readonly OfflineDoorGuest[],
  mutation: Pick<OfflineDoorMutation, "guestId" | "action" | "queuedAt">,
): OfflineDoorGuest[] {
  return guests.map((guest) => {
    if (guest.id !== mutation.guestId) return guest;
    if (mutation.action === "cancel_check_in") {
      return { ...guest, status: "pending", checkInTime: null };
    }
    return { ...guest, status: "checked", checkInTime: mutation.queuedAt };
  });
}
