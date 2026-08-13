import type { EventState } from "../api/types.ts";

export const EVENT_STATES = ["draft", "open", "closed", "archived"] as const;
export const MAX_EVENT_NAME_LENGTH = 120;
export const MAX_EVENT_CAPACITY = 100_000;

export interface EventDraftInput {
  businessDate: unknown;
  name: unknown;
  doorOpensAt?: unknown;
  guestCutoffAt?: unknown;
  capacity?: unknown;
  targetGuests?: unknown;
  templateSourceEventId?: unknown;
}

export interface PreparedEventDraft {
  businessDate: string;
  name: string;
  doorOpensAt: string | null;
  guestCutoffAt: string | null;
  capacity: number | null;
  targetGuests: number | null;
  templateSourceEventId: string | null;
}

export type EventDraftError =
  | "INVALID_BUSINESS_DATE"
  | "INVALID_EVENT_NAME"
  | "INVALID_DOOR_OPEN"
  | "INVALID_GUEST_CUTOFF"
  | "INVALID_EVENT_WINDOW"
  | "INVALID_CAPACITY"
  | "INVALID_TARGET"
  | "TARGET_EXCEEDS_CAPACITY"
  | "INVALID_TEMPLATE_SOURCE";

export function isEventState(value: unknown): value is EventState {
  return EVENT_STATES.some((state) => state === value);
}

export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 40) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function parseBoundedInteger(
  value: unknown,
  minimum: number,
): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (
    !Number.isInteger(value) ||
    Number(value) < minimum ||
    Number(value) > MAX_EVENT_CAPACITY
  ) {
    return undefined;
  }
  return Number(value);
}

export function prepareEventDraft(
  input: EventDraftInput,
): { draft: PreparedEventDraft; error: null } | { draft: null; error: EventDraftError } {
  if (!isBusinessDate(input.businessDate)) {
    return { draft: null, error: "INVALID_BUSINESS_DATE" };
  }
  if (typeof input.name !== "string") {
    return { draft: null, error: "INVALID_EVENT_NAME" };
  }
  const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_EVENT_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    return { draft: null, error: "INVALID_EVENT_NAME" };
  }

  const doorOpensAt = parseTimestamp(input.doorOpensAt);
  if (doorOpensAt === undefined) {
    return { draft: null, error: "INVALID_DOOR_OPEN" };
  }
  const guestCutoffAt = parseTimestamp(input.guestCutoffAt);
  if (guestCutoffAt === undefined) {
    return { draft: null, error: "INVALID_GUEST_CUTOFF" };
  }
  if (
    doorOpensAt &&
    guestCutoffAt &&
    new Date(guestCutoffAt).getTime() < new Date(doorOpensAt).getTime()
  ) {
    return { draft: null, error: "INVALID_EVENT_WINDOW" };
  }

  const capacity = parseBoundedInteger(input.capacity, 1);
  if (capacity === undefined) {
    return { draft: null, error: "INVALID_CAPACITY" };
  }
  const targetGuests = parseBoundedInteger(input.targetGuests, 0);
  if (targetGuests === undefined) {
    return { draft: null, error: "INVALID_TARGET" };
  }
  if (capacity !== null && targetGuests !== null && targetGuests > capacity) {
    return { draft: null, error: "TARGET_EXCEEDS_CAPACITY" };
  }

  const templateSourceEventId =
    input.templateSourceEventId === null ||
    input.templateSourceEventId === undefined ||
    input.templateSourceEventId === ""
      ? null
      : typeof input.templateSourceEventId === "string" &&
          input.templateSourceEventId.length <= 128
        ? input.templateSourceEventId
        : undefined;
  if (templateSourceEventId === undefined) {
    return { draft: null, error: "INVALID_TEMPLATE_SOURCE" };
  }

  return {
    draft: {
      businessDate: input.businessDate,
      name,
      doorOpensAt,
      guestCutoffAt,
      capacity,
      targetGuests,
      templateSourceEventId,
    },
    error: null,
  };
}

const EVENT_TRANSITIONS: Record<EventState, readonly EventState[]> = {
  draft: ["draft", "open", "archived"],
  open: ["open", "closed"],
  closed: ["closed", "archived"],
  archived: ["archived"],
};

export function canTransitionEventState(
  current: EventState,
  next: EventState,
): boolean {
  return EVENT_TRANSITIONS[current].includes(next);
}

export function canRegisterForEvent(state: EventState): boolean {
  return state === "draft" || state === "open";
}

export function canCheckInToEvent(state: EventState): boolean {
  return state === "open";
}

export function getCompatibilityEventKey(
  venueId: string,
  businessDate: string,
): string {
  if (!venueId || venueId.length > 128 || !isBusinessDate(businessDate)) {
    throw new Error("Invalid compatibility event scope");
  }
  return `legacy:${venueId}:${businessDate}`;
}
