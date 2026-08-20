import {
  getExternalLinkDeletionDisposition,
  isValidExternalLinkDate,
} from "./domain.ts";
import type {
  ExternalLinkLifecyclePersistence,
  ExternalLinkLifecycleTarget,
  ExternalLinkLifecycleVenueScope,
} from "./persistence.ts";

export interface ExternalLinkLifecycleActor {
  userId: string;
  role: string;
  venueId: string | null;
}

export type ExternalLinkLifecycleErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VENUE_UNAVAILABLE"
  | "CANNOT_ACTIVATE";

const ERROR_MESSAGES: Record<ExternalLinkLifecycleErrorCode, string> = {
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "External link not found",
  VENUE_UNAVAILABLE: "Venue unavailable",
  CANNOT_ACTIVATE: "Link cannot be activated",
};

export class ExternalLinkLifecycleError extends Error {
  readonly code: ExternalLinkLifecycleErrorCode;

  constructor(code: ExternalLinkLifecycleErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
    this.name = "ExternalLinkLifecycleError";
  }
}

export interface ExternalLinkLifecycleServiceDependencies {
  persistence: ExternalLinkLifecyclePersistence;
  now?: () => Date;
}

interface ExternalLinkLifecycleInput {
  linkId: string;
  actor: ExternalLinkLifecycleActor;
}

function resolveVenueScope(
  actor: ExternalLinkLifecycleActor,
): ExternalLinkLifecycleVenueScope {
  if (actor.role === "super_admin") return { kind: "global" };
  if (actor.role === "venue_admin" && actor.venueId) {
    return { kind: "venue", venueId: actor.venueId };
  }
  throw new ExternalLinkLifecycleError("FORBIDDEN");
}

async function requireManagedTarget(
  input: ExternalLinkLifecycleInput,
  persistence: ExternalLinkLifecyclePersistence,
): Promise<ExternalLinkLifecycleTarget> {
  const target = await persistence.loadUndeletedTarget({
    linkId: input.linkId,
    venueScope: resolveVenueScope(input.actor),
  });
  if (!target) throw new ExternalLinkLifecycleError("NOT_FOUND");
  if (
    input.actor.role !== "super_admin" &&
    target.venueId !== input.actor.venueId
  ) {
    throw new ExternalLinkLifecycleError("FORBIDDEN");
  }
  if (!(await persistence.isVenueActive(target.venueId))) {
    throw new ExternalLinkLifecycleError("VENUE_UNAVAILABLE");
  }
  return target;
}

function isExpired(expiresAt: string | null, getNow: () => Date): boolean {
  return Boolean(
    expiresAt && new Date(expiresAt).getTime() <= getNow().getTime(),
  );
}

export async function deleteAdminExternalLink(
  input: ExternalLinkLifecycleInput,
  dependencies: ExternalLinkLifecycleServiceDependencies,
): Promise<void> {
  await requireManagedTarget(input, dependencies.persistence);
  await dependencies.persistence.deactivateUndeletedForDeletion(input.linkId);
  const hasGuestHistory = await dependencies.persistence.hasGuestHistory(
    input.linkId,
  );
  const disposition = getExternalLinkDeletionDisposition(hasGuestHistory);

  if (disposition === "archive") {
    await dependencies.persistence.archiveUndeleted({
      linkId: input.linkId,
      deletedBy: input.actor.userId,
      deletedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    });
    return;
  }

  await dependencies.persistence.hardDeleteUndeleted(input.linkId);
}

export async function deactivateAdminExternalLink(
  input: ExternalLinkLifecycleInput,
  dependencies: ExternalLinkLifecycleServiceDependencies,
): Promise<void> {
  await requireManagedTarget(input, dependencies.persistence);
  await dependencies.persistence.setActiveById(input.linkId, false);
}

export async function activateAdminExternalLink(
  input: ExternalLinkLifecycleInput,
  dependencies: ExternalLinkLifecycleServiceDependencies,
): Promise<void> {
  const target = await requireManagedTarget(input, dependencies.persistence);
  const getNow = dependencies.now ?? (() => new Date());
  if (
    isExpired(target.expiresAt, getNow) ||
    !target.date ||
    !isValidExternalLinkDate(target.date)
  ) {
    throw new ExternalLinkLifecycleError("CANNOT_ACTIVATE");
  }
  await dependencies.persistence.setActiveById(input.linkId, true);
}
