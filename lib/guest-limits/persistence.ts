import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

import type { GuestLimitRequest } from "./types.ts";
import type {
  GuestLimitEventTarget,
  GuestLimitMutationActor,
} from "./mutation-types.ts";
import {
  DECIDE_GUEST_LIMIT_REQUEST_SQL,
  INSERT_GUARDED_COMPATIBILITY_EVENT_SQL,
  INSERT_GUARDED_EVENT_CONTRIBUTOR_LIMIT_SQL,
  INSERT_GUARDED_GUEST_LIMIT_REQUEST_SQL,
  SELECT_GUEST_LIMIT_REQUEST_SQL,
  SELECT_USABLE_EVENT_CONTRIBUTOR_LIMIT_SQL,
} from "./mutation-sql.ts";

type GuestLimitRequestRow = Omit<GuestLimitRequest, "status"> & {
  status: string;
};

export interface GuestLimitRequestCreateWrite {
  actor: GuestLimitMutationActor;
  event: GuestLimitEventTarget;
  request: {
    id: string;
    requestedExtra: number;
    reason: string | null;
    createdAt: string;
  };
}

export interface GuestLimitRequestDecisionWrite {
  actor: GuestLimitMutationActor;
  expected: GuestLimitRequest;
  nextStatus: "approved" | "rejected";
  approvedExtra: number;
  decisionNote: string | null;
  decidedAt: string;
}

export interface GuestLimitMutationPersistence {
  createRequest(input: GuestLimitRequestCreateWrite): Promise<{
    request: GuestLimitRequest | null;
    scopeValid: boolean;
    limitAvailable: boolean;
  }>;
  loadRequest(requestId: string): Promise<GuestLimitRequest | null>;
  decideRequest(
    input: GuestLimitRequestDecisionWrite,
  ): Promise<GuestLimitRequest | null>;
}

function isGuestLimitRequestStatus(
  value: string,
): value is GuestLimitRequest["status"] {
  return ["pending", "approved", "rejected", "cancelled"].includes(value);
}

function toRequest(row: GuestLimitRequestRow): GuestLimitRequest {
  if (!isGuestLimitRequestStatus(row.status)) {
    throw new Error("Invalid guest limit request status");
  }
  return { ...row, status: row.status };
}

function eventSelectorBindings(
  event: GuestLimitEventTarget,
): [number, string, number, string] {
  return event.kind === "exact"
    ? [1, event.eventId, 1, ""]
    : [0, "", 0, event.compatibilityKey];
}

function actorBindings(actor: GuestLimitMutationActor) {
  return [
    actor.id,
    actor.role,
    actor.accountKind,
    actor.venueId,
    actor.sessionVersion,
  ] as const;
}

export function createGuestLimitMutationPersistence(
  database?: D1Database,
): GuestLimitMutationPersistence {
  const d1 = database ?? getCloudflareContext().env.DB;

  return {
    async createRequest({ actor, event, request }) {
      const selectorBindings = eventSelectorBindings(event);
      const proposedEventId = event.kind === "compatibility"
        ? event.proposedEventId
        : event.eventId;
      const compatibilityKey = event.kind === "compatibility"
        ? event.compatibilityKey
        : "";
      const shouldCreateCompatibilityEvent = event.kind === "compatibility" ? 1 : 0;

      const results = await d1.batch<Record<string, unknown>>([
        d1.prepare(INSERT_GUARDED_COMPATIBILITY_EVENT_SQL).bind(
          proposedEventId,
          event.venueId,
          event.businessDate,
          event.businessDate,
          compatibilityKey,
          request.createdAt,
          request.createdAt,
          request.createdAt,
          event.venueId,
          shouldCreateCompatibilityEvent,
          ...actorBindings(actor),
        ),
        d1.prepare(INSERT_GUARDED_EVENT_CONTRIBUTOR_LIMIT_SQL).bind(
          event.venueId,
          request.createdAt,
          event.venueId,
          ...actorBindings(actor),
          ...selectorBindings,
          event.venueId,
          event.businessDate,
          event.venueId,
        ),
        d1.prepare(INSERT_GUARDED_GUEST_LIMIT_REQUEST_SQL).bind(
          request.id,
          event.businessDate,
          request.requestedExtra,
          request.reason,
          request.createdAt,
          request.createdAt,
          event.venueId,
          ...actorBindings(actor),
          ...selectorBindings,
          event.venueId,
          event.businessDate,
        ),
        d1.prepare(SELECT_USABLE_EVENT_CONTRIBUTOR_LIMIT_SQL).bind(
          event.venueId,
          ...actorBindings(actor),
          ...selectorBindings,
          event.venueId,
          event.businessDate,
        ),
      ]);

      const created = results[2]?.results[0] as
        | GuestLimitRequestRow
        | undefined;
      const diagnostic = results[3]?.results[0] as
        | { scopeValid?: unknown; limitAvailable?: unknown }
        | undefined;
      return {
        request: created ? toRequest(created) : null,
        scopeValid:
          diagnostic?.scopeValid === true || diagnostic?.scopeValid === 1,
        limitAvailable:
          diagnostic?.limitAvailable === true ||
          diagnostic?.limitAvailable === 1,
      };
    },

    async loadRequest(requestId) {
      const row = await d1
        .prepare(SELECT_GUEST_LIMIT_REQUEST_SQL)
        .bind(requestId)
        .first<GuestLimitRequestRow>();
      return row ? toRequest(row) : null;
    },

    async decideRequest({
      actor,
      expected,
      nextStatus,
      approvedExtra,
      decisionNote,
      decidedAt,
    }) {
      const row = await d1
        .prepare(DECIDE_GUEST_LIMIT_REQUEST_SQL)
        .bind(
          nextStatus,
          approvedExtra,
          actor.id,
          decidedAt,
          decisionNote,
          decidedAt,
          expected.id,
          expected.venueId,
          expected.userId,
          expected.date,
          expected.eventId ?? null,
          expected.requestedExtra,
          expected.approvedExtra,
          expected.reason,
          expected.decidedByUserId,
          expected.decidedAt,
          expected.decisionNote,
          expected.createdAt,
          expected.updatedAt,
          ...actorBindings(actor),
        )
        .first<GuestLimitRequestRow>();
      return row ? toRequest(row) : null;
    },
  };
}
