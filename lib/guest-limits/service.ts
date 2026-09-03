import { canRegisterForEvent, getCompatibilityEventKey } from "../events/domain.ts";
import type { Event } from "../events/types.ts";
import { canRequestGuestLimit } from "../users/policy.ts";
import type { GuestLimitMutationPersistence } from "./persistence.ts";
import {
  GuestLimitMutationError,
  type GuestLimitEventTarget,
  type GuestLimitMutationActor,
} from "./mutation-types.ts";
import type { GuestLimitRequest } from "./types.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

interface GuestLimitEventDependencies {
  requireActiveVenueId(venueId: string): Promise<string>;
  resolveEventForRosterWrite(input: {
    venueId: string;
    businessDate: string;
    eventId: string;
    actorUserId: string;
    purpose: "register";
  }): Promise<Event>;
  findCompatibilityEvent(
    venueId: string,
    businessDate: string,
  ): Promise<Event | null>;
}

export interface GuestLimitRequestServiceDependencies
  extends GuestLimitEventDependencies {
  persistence: GuestLimitMutationPersistence;
  loadEventById(eventId: string): Promise<Event | null>;
  createId?: () => string;
  now?: () => Date;
}

async function resolveCreateEvent(
  input: {
    actor: GuestLimitMutationActor & { venueId: string };
    date: string;
    eventId?: string | null;
  },
  dependencies: GuestLimitEventDependencies & { createId?: () => string },
): Promise<GuestLimitEventTarget> {
  const venueId = await dependencies.requireActiveVenueId(input.actor.venueId);
  if (input.eventId) {
    const event = await dependencies.resolveEventForRosterWrite({
      venueId,
      businessDate: input.date,
      eventId: input.eventId,
      actorUserId: input.actor.id,
      purpose: "register",
    });
    return {
      kind: "exact",
      eventId: event.id,
      venueId,
      businessDate: input.date,
    };
  }

  const compatibilityEvent = await dependencies.findCompatibilityEvent(
    venueId,
    input.date,
  );
  if (compatibilityEvent) {
    if (
      compatibilityEvent.venueId !== venueId ||
      compatibilityEvent.businessDate !== input.date ||
      !canRegisterForEvent(compatibilityEvent.state)
    ) {
      throw new GuestLimitMutationError("REQUEST_FAILED");
    }
    return {
      kind: "exact",
      eventId: compatibilityEvent.id,
      venueId,
      businessDate: input.date,
    };
  }

  return {
    kind: "compatibility",
    proposedEventId: (dependencies.createId ?? (() => crypto.randomUUID()))(),
    compatibilityKey: getCompatibilityEventKey(venueId, input.date),
    venueId,
    businessDate: input.date,
  };
}

export async function createGuestLimitRequestService(
  input: {
    actor: GuestLimitMutationActor;
    params: {
      date: string;
      eventId?: string | null;
      requestedExtra: number;
      reason?: string | null;
    };
  },
  dependencies: GuestLimitRequestServiceDependencies,
): Promise<GuestLimitRequest> {
  if (!canRequestGuestLimit(input.actor) || !input.actor.venueId) {
    throw new GuestLimitMutationError("REQUEST_NOT_ALLOWED");
  }
  if (!isValidDate(input.params.date)) {
    throw new GuestLimitMutationError("INVALID_DATE");
  }
  if (
    !Number.isInteger(input.params.requestedExtra) ||
    input.params.requestedExtra < 1 ||
    input.params.requestedExtra > 10
  ) {
    throw new GuestLimitMutationError("INVALID_EXTRA");
  }
  const reason = input.params.reason?.trim() || null;
  if (reason && reason.length > 200) {
    throw new GuestLimitMutationError("INVALID_REASON");
  }

  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const event = await resolveCreateEvent(
    {
      actor: input.actor as GuestLimitMutationActor & { venueId: string },
      date: input.params.date,
      eventId: input.params.eventId,
    },
    { ...dependencies, createId },
  );
  const createdAt = (dependencies.now?.() ?? new Date()).toISOString();
  if (event.kind === "compatibility" && input.actor.guestLimit === null) {
    throw new GuestLimitMutationError("REQUEST_NOT_ALLOWED");
  }
  const outcome = await dependencies.persistence.createRequest({
    actor: input.actor,
    event,
    request: {
      id: createId(),
      requestedExtra: input.params.requestedExtra,
      reason,
      createdAt,
    },
  });
  if (outcome.request) return outcome.request;
  if (!outcome.scopeValid) {
    throw new GuestLimitMutationError("REQUEST_FAILED");
  }
  if (!outcome.limitAvailable) {
    throw new GuestLimitMutationError("REQUEST_NOT_ALLOWED");
  }
  throw new GuestLimitMutationError("REQUEST_FAILED");
}

export async function decideGuestLimitRequestService(
  input: {
    actor: GuestLimitMutationActor;
    params: {
      requestId: string;
      decision: "approve" | "reject";
      approvedExtra?: number;
      decisionNote?: string | null;
    };
  },
  dependencies: Pick<
    GuestLimitRequestServiceDependencies,
    "persistence" | "requireActiveVenueId" | "loadEventById" | "now"
  >,
): Promise<GuestLimitRequest> {
  if (
    input.params.decision !== "approve" &&
    input.params.decision !== "reject"
  ) {
    throw new GuestLimitMutationError("INVALID_DECISION");
  }
  if (input.actor.role !== "super_admin" && input.actor.role !== "venue_admin") {
    throw new GuestLimitMutationError("FORBIDDEN");
  }
  const request = await dependencies.persistence.loadRequest(
    input.params.requestId,
  );
  if (
    !request ||
    (input.actor.role !== "super_admin" &&
      request.venueId !== input.actor.venueId)
  ) {
    throw new GuestLimitMutationError("FORBIDDEN");
  }
  await dependencies.requireActiveVenueId(request.venueId);
  if (request.status !== "pending") {
    throw new GuestLimitMutationError("REQUEST_ALREADY_DECIDED");
  }
  if (request.eventId) {
    const event = await dependencies.loadEventById(request.eventId);
    if (
      !event ||
      event.venueId !== request.venueId ||
      !canRegisterForEvent(event.state)
    ) {
      throw new GuestLimitMutationError("EVENT_NOT_ACTIVE");
    }
  }

  const approvedExtra = input.params.decision === "approve"
    ? input.params.approvedExtra
    : 0;
  if (
    input.params.decision === "approve" &&
    (!Number.isInteger(approvedExtra) ||
      approvedExtra === undefined ||
      approvedExtra < 1 ||
      approvedExtra > request.requestedExtra)
  ) {
    throw new GuestLimitMutationError("INVALID_APPROVED_EXTRA");
  }
  const decisionNote = input.params.decisionNote?.trim() || null;
  if (decisionNote && decisionNote.length > 200) {
    throw new GuestLimitMutationError("INVALID_DECISION_NOTE");
  }

  const updated = await dependencies.persistence.decideRequest({
    actor: input.actor,
    expected: request,
    nextStatus: input.params.decision === "approve" ? "approved" : "rejected",
    approvedExtra: approvedExtra ?? 0,
    decisionNote,
    decidedAt: (dependencies.now?.() ?? new Date()).toISOString(),
  });
  if (!updated) {
    throw new GuestLimitMutationError("REQUEST_ALREADY_DECIDED");
  }
  return updated;
}

export { GuestLimitMutationError } from "./mutation-types.ts";
