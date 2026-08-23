import {
  isValidExternalLinkDate,
  type ExternalLinkCreateDraft,
} from "./domain.ts";
import { getContributorNameKey } from "../contributors/domain.ts";
import {
  getExternalDjContributorId,
  getExternalDjCreatedAuditId,
} from "../contributors/external-dj.ts";
import type { ExternalDjSuggestion } from "../contributors/types.ts";
import type {
  ExternalLinkAdminContributor,
  ExternalLinkAdminPersistence,
  ExternalLinkAdminRecord,
  ExternalLinkLifecyclePersistence,
  ExternalLinkLifecycleTarget,
  ExternalLinkLifecycleVenueScope,
  ExternalLinkMutationActor,
} from "./persistence.ts";

const DEFAULT_EXTERNAL_LINK_TTL_DAYS = 7;
const MAX_EXTERNAL_DJ_DIRECTORY_ROWS = 500;

export type ExternalLinkLifecycleActor = ExternalLinkMutationActor;

export type ExternalLinkAdminActor = ExternalLinkLifecycleActor;

export type ExternalLinkAdminErrorCode =
  | "FORBIDDEN"
  | "VENUE_UNAVAILABLE"
  | "INVALID_CONTRIBUTOR"
  | "DJ_DIRECTORY_TOO_LARGE";

const ADMIN_ERROR_MESSAGES: Record<ExternalLinkAdminErrorCode, string> = {
  FORBIDDEN: "Forbidden",
  VENUE_UNAVAILABLE: "Venue unavailable",
  INVALID_CONTRIBUTOR: "INVALID_CONTRIBUTOR",
  DJ_DIRECTORY_TOO_LARGE: "DJ_DIRECTORY_TOO_LARGE",
};

export class ExternalLinkAdminError extends Error {
  readonly code: ExternalLinkAdminErrorCode;

  constructor(code: ExternalLinkAdminErrorCode) {
    super(ADMIN_ERROR_MESSAGES[code]);
    this.code = code;
  }
}

export interface ExternalLinkAdminServiceDependencies {
  persistence: ExternalLinkAdminPersistence;
  resolveEventForRosterWrite(input: {
    venueId: string;
    businessDate: string;
    eventId?: string | null;
    actorUserId?: string | null;
    actorGuard?: {
      id: string;
      role: ExternalLinkAdminActor["role"];
      accountKind: ExternalLinkAdminActor["accountKind"];
      venueId: string | null;
      sessionVersion: number;
      allowedRoles: readonly ExternalLinkAdminActor["role"][];
    };
    purpose: "register";
  }): Promise<{ id: string }>;
  createId?: () => string;
  createToken?: () => string;
  createContributorId?: (venueId: string, nameKey: string) => Promise<string>;
  getContributorCreatedAuditId?: (contributorId: string) => string;
  now?: () => Date;
}

export interface ExternalLinkAdminCreateInput {
  actor: ExternalLinkAdminActor;
  requestedVenueId: string;
  eventId?: string | null;
  draft: ExternalLinkCreateDraft;
}

function externalAdminEventActorGuard(actor: ExternalLinkAdminActor) {
  return {
    id: actor.userId,
    role: actor.role,
    accountKind: actor.accountKind,
    venueId: actor.venueId,
    sessionVersion: actor.sessionVersion,
    allowedRoles: ["super_admin", "venue_admin"] as const,
  };
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

function resolveAdminVenueId(
  actor: ExternalLinkAdminActor,
  requestedVenueId: string,
): string {
  if (!requestedVenueId) throw new ExternalLinkAdminError("FORBIDDEN");
  if (actor.role === "super_admin") return requestedVenueId;
  if (
    actor.role === "venue_admin" &&
    actor.venueId &&
    actor.venueId === requestedVenueId
  ) {
    return requestedVenueId;
  }
  throw new ExternalLinkAdminError("FORBIDDEN");
}

async function requireActiveAdminVenue(
  actor: ExternalLinkAdminActor,
  requestedVenueId: string,
  persistence: ExternalLinkAdminPersistence,
): Promise<string> {
  const venueId = resolveAdminVenueId(actor, requestedVenueId);
  if (!(await persistence.isVenueActive(venueId))) {
    throw new ExternalLinkAdminError("VENUE_UNAVAILABLE");
  }
  return venueId;
}

function defaultExternalLinkExpiresAt(date: string, now: Date): string {
  const eventDay = new Date(`${date}T23:59:59.999Z`);
  if (!Number.isNaN(eventDay.getTime())) {
    eventDay.setUTCDate(eventDay.getUTCDate() + 1);
    return eventDay.toISOString();
  }
  return new Date(
    now.getTime() + DEFAULT_EXTERNAL_LINK_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

async function resolveAdminContributor(
  venueId: string,
  draft: ExternalLinkCreateDraft,
  dependencies: ExternalLinkAdminServiceDependencies,
): Promise<
  (ExternalLinkAdminContributor & { nameKey: string; shouldCreate: false }) |
  {
    id: string;
    venueId: string;
    displayName: string;
    nameKey: string;
    active: true;
    shouldCreate: true;
  } |
  null
> {
  if (draft.kind !== "contributor") return null;
  const nameKey = getContributorNameKey(draft.djName);
  if (!nameKey) throw new ExternalLinkAdminError("INVALID_CONTRIBUTOR");

  const existing = await dependencies.persistence.loadContributor({
    venueId,
    contributorId: draft.contributorId,
    nameKey,
  });
  if (existing) {
    if (!existing.active || existing.nameKey !== nameKey) {
      throw new ExternalLinkAdminError("INVALID_CONTRIBUTOR");
    }
    return { ...existing, nameKey, shouldCreate: false };
  }
  if (draft.contributorId) {
    throw new ExternalLinkAdminError("INVALID_CONTRIBUTOR");
  }
  return {
    id: await (dependencies.createContributorId ?? getExternalDjContributorId)(
      venueId,
      nameKey,
    ),
    venueId,
    displayName: draft.djName,
    nameKey,
    active: true,
    shouldCreate: true,
  };
}

export async function fetchAdminExternalDjDirectory(
  input: {
    actor: ExternalLinkAdminActor;
    requestedVenueId: string;
  },
  dependencies: Pick<ExternalLinkAdminServiceDependencies, "persistence">,
): Promise<ExternalDjSuggestion[]> {
  const venueId = await requireActiveAdminVenue(
    input.actor,
    input.requestedVenueId,
    dependencies.persistence,
  );
  const rows = await dependencies.persistence.listContributorDirectory(
    venueId,
    MAX_EXTERNAL_DJ_DIRECTORY_ROWS + 1,
  );
  if (rows.length > MAX_EXTERNAL_DJ_DIRECTORY_ROWS) {
    throw new ExternalLinkAdminError("DJ_DIRECTORY_TOO_LARGE");
  }
  return rows;
}

export async function createAdminExternalLink(
  input: ExternalLinkAdminCreateInput,
  dependencies: ExternalLinkAdminServiceDependencies,
): Promise<ExternalLinkAdminRecord | null> {
  const venueId = await requireActiveAdminVenue(
    input.actor,
    input.requestedVenueId,
    dependencies.persistence,
  );
  const event = await dependencies.resolveEventForRosterWrite({
    venueId,
    businessDate: input.draft.date,
    eventId: input.eventId,
    actorUserId: input.actor.userId,
    actorGuard: externalAdminEventActorGuard(input.actor),
    purpose: "register",
  });
  const getNow = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const createToken = dependencies.createToken ?? (() => crypto.randomUUID());
  const linkId = createId();
  const token = createToken();
  const createdAt = getNow().toISOString();
  const contributor = await resolveAdminContributor(
    venueId,
    input.draft,
    dependencies,
  );

  const created = await dependencies.persistence.createExternalLink({
    actor: input.actor,
    link: {
      id: linkId,
      venueId,
      token,
      djName: contributor?.displayName ?? input.draft.djName,
      contributorId: contributor?.id ?? null,
      event: input.draft.event,
      date: input.draft.date,
      eventId: event.id,
      maxGuests: input.draft.maxGuests,
      localeMode: input.draft.localeMode,
      kind: input.draft.kind,
      expiresAt: defaultExternalLinkExpiresAt(input.draft.date, getNow()),
      createdBy: input.actor.userId,
      createdAt,
    },
    contributor: contributor
      ? {
          id: contributor.id,
          venueId: contributor.venueId,
          displayName: contributor.displayName,
          nameKey: contributor.nameKey,
          shouldCreate: contributor.shouldCreate,
        }
      : null,
    createdAuditId:
      contributor?.shouldCreate
        ? (dependencies.getContributorCreatedAuditId ??
            getExternalDjCreatedAuditId)(contributor.id)
        : null,
    mappingAuditId: contributor ? createId() : null,
  });
  if (created) return created;

  if (!(await dependencies.persistence.isVenueActive(venueId))) {
    throw new ExternalLinkAdminError("VENUE_UNAVAILABLE");
  }
  await dependencies.resolveEventForRosterWrite({
    venueId,
    businessDate: input.draft.date,
    eventId: event.id,
    actorUserId: input.actor.userId,
    actorGuard: externalAdminEventActorGuard(input.actor),
    purpose: "register",
  });
  if (contributor) {
    const currentContributor = await dependencies.persistence.loadContributor({
      venueId,
      contributorId: contributor.id,
      nameKey: contributor.nameKey,
    });
    if (
      !currentContributor ||
      !currentContributor.active ||
      currentContributor.displayName !== contributor.displayName ||
      currentContributor.nameKey !== contributor.nameKey
    ) {
      throw new ExternalLinkAdminError("INVALID_CONTRIBUTOR");
    }
  }
  throw new Error("External link create precondition changed");
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

function requireActivatableTarget(
  target: ExternalLinkLifecycleTarget,
  getNow: () => Date,
): asserts target is ExternalLinkLifecycleTarget & { date: string } {
  if (
    isExpired(target.expiresAt, getNow) ||
    !target.date ||
    !isValidExternalLinkDate(target.date)
  ) {
    throw new ExternalLinkLifecycleError("CANNOT_ACTIVATE");
  }
}

export async function deleteAdminExternalLink(
  input: ExternalLinkLifecycleInput,
  dependencies: ExternalLinkLifecycleServiceDependencies,
): Promise<void> {
  const target = await requireManagedTarget(input, dependencies.persistence);
  const disposition = await dependencies.persistence.deleteManaged({
    linkId: target.id,
    venueId: target.venueId,
    deletedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    actor: input.actor,
  });
  if (disposition) return;

  await requireManagedTarget(input, dependencies.persistence);
  throw new ExternalLinkLifecycleError("NOT_FOUND");
}

export async function deactivateAdminExternalLink(
  input: ExternalLinkLifecycleInput,
  dependencies: ExternalLinkLifecycleServiceDependencies,
): Promise<void> {
  const target = await requireManagedTarget(input, dependencies.persistence);
  const updated = await dependencies.persistence.deactivateManaged({
    linkId: target.id,
    venueId: target.venueId,
    expectedActive: target.active,
    actor: input.actor,
  });
  if (updated) return;

  await requireManagedTarget(input, dependencies.persistence);
  throw new ExternalLinkLifecycleError("NOT_FOUND");
}

export async function activateAdminExternalLink(
  input: ExternalLinkLifecycleInput,
  dependencies: ExternalLinkLifecycleServiceDependencies,
): Promise<void> {
  const target = await requireManagedTarget(input, dependencies.persistence);
  const getNow = dependencies.now ?? (() => new Date());
  requireActivatableTarget(target, getNow);
  const updated = await dependencies.persistence.activateManaged({
    linkId: target.id,
    venueId: target.venueId,
    expectedActive: target.active,
    date: target.date,
    expiresAt: target.expiresAt,
    now: getNow().toISOString(),
    actor: input.actor,
  });
  if (updated) return;

  const currentTarget = await requireManagedTarget(
    input,
    dependencies.persistence,
  );
  requireActivatableTarget(currentTarget, getNow);
  throw new ExternalLinkLifecycleError("CANNOT_ACTIVATE");
}
