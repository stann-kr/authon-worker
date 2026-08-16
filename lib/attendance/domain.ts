import { isBusinessDate } from "../events/domain.ts";

export const MAX_ATTENDANCE_SYNC_BATCH = 100;
export const MAX_OFFLINE_ATTENDANCE_MUTATIONS = 5_000;
export const MAX_ATTENDANCE_ADJUSTMENT = 500;
export const MAX_ATTENDANCE_MUTATION_AGE_MS = 48 * 60 * 60 * 1_000;
export const MAX_ATTENDANCE_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export type DoorAttendanceAction = "walk_in" | "reversal";
export type OfflineAttendanceMutationState =
  | "queued"
  | "confirmed"
  | "conflict"
  | "rejected";

export interface AttendanceScope {
  venueId: string;
  businessDate: string;
  eventId: string | null;
}

export interface AttendanceEventWindow {
  state: "draft" | "open" | "closed" | "archived";
  openedAt: string | null;
  closedAt: string | null;
}

export interface OfflineAttendanceMutation {
  idempotencyKey: string;
  deviceId: string;
  sequence: number;
  scope: AttendanceScope;
  action: DoorAttendanceAction;
  reversesIdempotencyKey: string | null;
  queuedAt: string;
  state: OfflineAttendanceMutationState;
  resolution: "applied" | "replayed" | null;
}

export interface PreparedAttendanceMutation {
  idempotencyKey: string;
  sequence: number;
  action: DoorAttendanceAction;
  reversesIdempotencyKey: string | null;
  occurredAt: string;
  isExpired: boolean;
}

function isBoundedKey(value: unknown, maximum = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function isAttendanceScope(value: unknown): value is AttendanceScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<AttendanceScope>;
  return (
    isBoundedKey(scope.venueId, 128) &&
    isBusinessDate(scope.businessDate) &&
    (scope.eventId === null || isBoundedKey(scope.eventId, 128))
  );
}

export function isAttendanceScopeEqual(
  left: AttendanceScope,
  right: AttendanceScope,
): boolean {
  return (
    left.venueId === right.venueId &&
    left.businessDate === right.businessDate &&
    left.eventId === right.eventId
  );
}

export function canApplyAttendanceEventMutation(
  event: AttendanceEventWindow | null,
  occurredAt: string,
): boolean {
  if (!event) return true;
  const occurredTime = new Date(occurredAt).getTime();
  const openedTime = event.openedAt
    ? new Date(event.openedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(occurredTime) || !Number.isFinite(openedTime)) {
    return false;
  }
  if (event.state === "open") return occurredTime >= openedTime;
  if (
    (event.state === "closed" || event.state === "archived") &&
    event.closedAt
  ) {
    const closedTime = new Date(event.closedAt).getTime();
    return (
      Number.isFinite(closedTime) &&
      occurredTime >= openedTime &&
      occurredTime <= closedTime
    );
  }
  return false;
}

export function isAttendanceIdempotencyKey(value: unknown): value is string {
  return isBoundedKey(value);
}

export function createOfflineAttendanceMutation(params: {
  scope: AttendanceScope;
  deviceId: string;
  sequence: number;
  action: DoorAttendanceAction;
  reversesIdempotencyKey?: string | null;
  now?: Date;
}): OfflineAttendanceMutation {
  const reversesIdempotencyKey = params.reversesIdempotencyKey ?? null;
  if (
    !isAttendanceScope(params.scope) ||
    !isBoundedKey(params.deviceId, 128) ||
    !Number.isSafeInteger(params.sequence) ||
    params.sequence < 1 ||
    (params.action !== "walk_in" && params.action !== "reversal") ||
    (params.action === "walk_in" && reversesIdempotencyKey !== null) ||
    (params.action === "reversal" && !isBoundedKey(reversesIdempotencyKey))
  ) {
    throw new Error("INVALID_ATTENDANCE_MUTATION");
  }
  const idempotencyKey = `attendance:${crypto.randomUUID()}`;
  if (!isBoundedKey(idempotencyKey)) {
    throw new Error("INVALID_ATTENDANCE_MUTATION");
  }
  return {
    idempotencyKey,
    deviceId: params.deviceId,
    sequence: params.sequence,
    scope: { ...params.scope },
    action: params.action,
    reversesIdempotencyKey,
    queuedAt: (params.now ?? new Date()).toISOString(),
    state: "queued",
    resolution: null,
  };
}

export function transitionOfflineAttendanceMutation(
  mutation: OfflineAttendanceMutation,
  state: Exclude<OfflineAttendanceMutationState, "queued">,
  resolution: OfflineAttendanceMutation["resolution"] = null,
): OfflineAttendanceMutation {
  if (mutation.state !== "queued") {
    if (mutation.state === state) return mutation;
    throw new Error("ATTENDANCE_MUTATION_FINAL");
  }
  return { ...mutation, state, resolution };
}

export function pendingAttendanceDelta(
  mutations: readonly Pick<OfflineAttendanceMutation, "state" | "action">[],
): number {
  return mutations.reduce(
    (total, mutation) =>
      mutation.state !== "queued"
        ? total
        : total + (mutation.action === "walk_in" ? 1 : -1),
    0,
  );
}

export function findLatestUndoableAttendanceKey(
  mutations: readonly Pick<
    OfflineAttendanceMutation,
    "idempotencyKey" | "sequence" | "action" | "reversesIdempotencyKey" | "queuedAt" | "state"
  >[],
): string | null {
  const reversedKeys = new Set(
    mutations.flatMap((mutation) =>
      mutation.state === "queued" &&
      mutation.action === "reversal" &&
      mutation.reversesIdempotencyKey
        ? [mutation.reversesIdempotencyKey]
        : [],
    ),
  );
  return [...mutations]
    .filter(
      (mutation) =>
        mutation.state === "queued" &&
        mutation.action === "walk_in" &&
        !reversedKeys.has(mutation.idempotencyKey),
    )
    .sort(
      (left, right) =>
        right.queuedAt.localeCompare(left.queuedAt) ||
        right.sequence - left.sequence,
    )[0]
    ?.idempotencyKey ?? null;
}

export function prepareAttendanceSyncBatch(params: {
  deviceId: unknown;
  items: unknown;
  now?: Date;
}): PreparedAttendanceMutation[] {
  if (
    !isBoundedKey(params.deviceId, 128) ||
    !Array.isArray(params.items) ||
    params.items.length < 1 ||
    params.items.length > MAX_ATTENDANCE_SYNC_BATCH
  ) {
    throw new Error("INVALID_ATTENDANCE_BATCH");
  }
  const now = (params.now ?? new Date()).getTime();
  const idempotencyKeys = new Set<string>();
  const sequences = new Set<number>();
  const items = params.items.map((value): PreparedAttendanceMutation => {
    if (!value || typeof value !== "object") {
      throw new Error("INVALID_ATTENDANCE_BATCH");
    }
    const item = value as Record<string, unknown>;
    const idempotencyKey = item.idempotencyKey;
    const sequence = item.sequence;
    const action = item.action;
    const reversesIdempotencyKey = item.reversesIdempotencyKey ?? null;
    const occurredAt = item.occurredAt;
    const occurredTime =
      typeof occurredAt === "string" ? new Date(occurredAt).getTime() : Number.NaN;
    if (
      !isBoundedKey(idempotencyKey) ||
      idempotencyKeys.has(idempotencyKey) ||
      !Number.isSafeInteger(sequence) ||
      (sequence as number) < 1 ||
      sequences.has(sequence as number) ||
      (action !== "walk_in" && action !== "reversal") ||
      (action === "walk_in" && reversesIdempotencyKey !== null) ||
      (action === "reversal" && !isBoundedKey(reversesIdempotencyKey)) ||
      !Number.isFinite(occurredTime)
    ) {
      throw new Error("INVALID_ATTENDANCE_BATCH");
    }
    idempotencyKeys.add(idempotencyKey);
    sequences.add(sequence as number);
    return {
      idempotencyKey,
      sequence: sequence as number,
      action,
      reversesIdempotencyKey:
        action === "reversal" ? (reversesIdempotencyKey as string) : null,
      occurredAt: new Date(occurredTime).toISOString(),
      isExpired:
        occurredTime < now - MAX_ATTENDANCE_MUTATION_AGE_MS ||
        occurredTime > now + MAX_ATTENDANCE_FUTURE_SKEW_MS,
    };
  });
  return items.sort((left, right) => left.sequence - right.sequence);
}

export function prepareAttendanceReconciliation(params: {
  targetTotalAttendance: unknown;
  expectedCheckedInGuests: unknown;
  expectedWalkIns: unknown;
  reason: unknown;
}): {
  targetTotalAttendance: number;
  expectedCheckedInGuests: number;
  expectedWalkIns: number;
  delta: number;
  reason: string;
} {
  const reason = typeof params.reason === "string" ? params.reason.trim() : "";
  const targetTotalAttendance = params.targetTotalAttendance;
  const expectedCheckedInGuests = params.expectedCheckedInGuests;
  const expectedWalkIns = params.expectedWalkIns;
  const delta =
    typeof targetTotalAttendance === "number" &&
    typeof expectedCheckedInGuests === "number" &&
    typeof expectedWalkIns === "number"
      ? targetTotalAttendance - expectedCheckedInGuests - expectedWalkIns
      : Number.NaN;
  if (
    !Number.isSafeInteger(targetTotalAttendance) ||
    !Number.isSafeInteger(expectedCheckedInGuests) ||
    !Number.isSafeInteger(expectedWalkIns) ||
    (targetTotalAttendance as number) < 0 ||
    (expectedCheckedInGuests as number) < 0 ||
    (expectedWalkIns as number) < 0 ||
    (targetTotalAttendance as number) < (expectedCheckedInGuests as number) ||
    !Number.isSafeInteger(delta) ||
    Math.abs(delta) > MAX_ATTENDANCE_ADJUSTMENT ||
    reason.length < 1 ||
    reason.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(reason)
  ) {
    throw new Error("INVALID_ATTENDANCE_RECONCILIATION");
  }
  return {
    targetTotalAttendance: targetTotalAttendance as number,
    expectedCheckedInGuests: expectedCheckedInGuests as number,
    expectedWalkIns: expectedWalkIns as number,
    delta,
    reason,
  };
}
