import {
  MAX_OFFLINE_DOOR_MUTATIONS,
  OFFLINE_DOOR_QUEUE_TTL_MS,
  type OfflineDoorAction,
} from "./offline-domain.ts";

export interface PreparedOfflineDoorSyncItem {
  idempotencyKey: string;
  sequence: number;
  guestId: string;
  action: OfflineDoorAction;
  queuedAt: string;
  expired: boolean;
}

export interface OfflineDoorSyncResult {
  idempotencyKey: string;
  guestId: string;
  state: "confirmed" | "conflict" | "rejected";
  resolution: "applied" | "replayed" | "already_applied" | null;
  status: "pending" | "checked" | null;
  checkInTime: string | null;
}

export function groupOfflineDoorMutationsByDevice<T extends {
  deviceId: string;
  sequence: number;
}>(mutations: readonly T[]): Array<{ deviceId: string; mutations: T[] }> {
  const groups = new Map<string, T[]>();
  for (const mutation of mutations) {
    groups.set(mutation.deviceId, [
      ...(groups.get(mutation.deviceId) ?? []),
      mutation,
    ]);
  }
  return [...groups.entries()].map(([deviceId, deviceMutations]) => ({
    deviceId,
    mutations: deviceMutations.sort((left, right) => left.sequence - right.sequence),
  }));
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[A-Za-z0-9:_-]+$/.test(value)
  );
}

export function prepareOfflineDoorSyncBatch(params: {
  deviceId: unknown;
  items: unknown;
  now?: Date;
}): { deviceId: string; items: PreparedOfflineDoorSyncItem[] } {
  if (!isOpaqueId(params.deviceId) || !Array.isArray(params.items)) {
    throw new Error("INVALID_OFFLINE_SYNC_BATCH");
  }
  if (params.items.length < 1 || params.items.length > MAX_OFFLINE_DOOR_MUTATIONS) {
    throw new Error("INVALID_OFFLINE_SYNC_BATCH");
  }
  const now = (params.now ?? new Date()).getTime();
  const seenSequences = new Set<number>();
  const items = params.items.map((raw): PreparedOfflineDoorSyncItem => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("INVALID_OFFLINE_SYNC_ITEM");
    }
    const item = raw as Record<string, unknown>;
    const sequence = item.sequence;
    const action = item.action;
    if (
      !Number.isSafeInteger(sequence) ||
      Number(sequence) < 1 ||
      seenSequences.has(Number(sequence)) ||
      !isOpaqueId(item.guestId) ||
      (action !== "check_in" && action !== "cancel_check_in" && action !== "re_entry") ||
      typeof item.queuedAt !== "string"
    ) {
      throw new Error("INVALID_OFFLINE_SYNC_ITEM");
    }
    const idempotencyKey = `offline:${params.deviceId}:${sequence}`;
    if (item.idempotencyKey !== idempotencyKey) {
      throw new Error("INVALID_OFFLINE_SYNC_KEY");
    }
    const queuedTime = new Date(item.queuedAt).getTime();
    if (!Number.isFinite(queuedTime) || queuedTime > now + 5 * 60 * 1_000) {
      throw new Error("INVALID_OFFLINE_SYNC_TIME");
    }
    seenSequences.add(Number(sequence));
    return {
      idempotencyKey,
      sequence: Number(sequence),
      guestId: item.guestId,
      action,
      queuedAt: new Date(queuedTime).toISOString(),
      expired: now - queuedTime > OFFLINE_DOOR_QUEUE_TTL_MS,
    };
  });
  return {
    deviceId: params.deviceId,
    items: items.sort((left, right) => left.sequence - right.sequence),
  };
}

export function desiredOfflineDoorStatus(
  action: OfflineDoorAction,
): "pending" | "checked" {
  return action === "cancel_check_in" ? "pending" : "checked";
}

export function resolveOfflineDoorSyncOutcome(params: {
  idempotencyKey: string;
  guestId: string;
  persistenceOutcome: "applied" | "replayed" | "conflict" | "rejected";
  persistedStatus: "pending" | "checked" | null;
  persistedCheckInTime: string | null;
  currentStatus: "pending" | "checked" | "deleted" | null;
  currentCheckInTime: string | null;
  desiredStatus: "pending" | "checked";
}): OfflineDoorSyncResult {
  if (params.persistenceOutcome === "conflict") {
    return {
      idempotencyKey: params.idempotencyKey,
      guestId: params.guestId,
      state: "conflict",
      resolution: null,
      status: params.currentStatus === "pending" || params.currentStatus === "checked"
        ? params.currentStatus
        : null,
      checkInTime: params.currentCheckInTime,
    };
  }
  if (
    params.persistenceOutcome === "applied" ||
    params.persistenceOutcome === "replayed"
  ) {
    return {
      idempotencyKey: params.idempotencyKey,
      guestId: params.guestId,
      state: "confirmed",
      resolution: params.persistenceOutcome,
      status: params.persistedStatus,
      checkInTime: params.persistedCheckInTime,
    };
  }
  if (params.currentStatus === params.desiredStatus) {
    return {
      idempotencyKey: params.idempotencyKey,
      guestId: params.guestId,
      state: "confirmed",
      resolution: "already_applied",
      status: params.currentStatus,
      checkInTime: params.currentCheckInTime,
    };
  }
  return {
    idempotencyKey: params.idempotencyKey,
    guestId: params.guestId,
    state: "rejected",
    resolution: null,
    status: params.currentStatus === "pending" || params.currentStatus === "checked"
      ? params.currentStatus
      : null,
    checkInTime: params.currentCheckInTime,
  };
}
