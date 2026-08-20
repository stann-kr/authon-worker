import type {
  BulkGuestCreateInput,
  Guest,
} from "../guests/types.ts";
import type {
  ExternalLinkPublicGuest,
  ExternalLinkPublicGuestCreateItemResult,
  ExternalLinkPublicGuestCreateResult,
  ExternalLinkPublicValidationData,
} from "./types.ts";
import {
  MAX_BULK_WRITE_NAMES,
  prepareGuestName,
  toStoredGuestName,
} from "../guests/bulk-entry.ts";
import { hashOpaqueIdentifier } from "../guests/activity-ledger.ts";
import {
  isValidExternalLinkDate,
  toExternalDJLink,
} from "./domain.ts";
import { isValidExternalOwnerKey } from "./ownership.ts";
import type {
  ExternalLinkPublicGuestRecord,
  ExternalLinkPublicPersistence,
  ExternalLinkPublicRecord,
} from "./public-persistence.ts";

const EXTERNAL_GUEST_RATE_LIMIT_NAMES = 100;
const EXTERNAL_GUEST_RATE_LIMIT_WINDOW_SECONDS = 60;

const INVALID_EXTERNAL_LINK_ERROR = "INVALID_EXTERNAL_LINK";
const PUBLIC_LINK_INVALID_ERROR = "Link is invalid, expired, or inactive.";

export type ExternalLinkPublicResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

export interface ExternalLinkPublicTenantContext {
  scope: "platform" | "venue";
  venueId: string | null;
  resolved: boolean;
}

export interface ExternalLinkPublicServiceDependencies {
  persistence: ExternalLinkPublicPersistence;
  getTenantContext(): Promise<ExternalLinkPublicTenantContext>;
  getRequestIp(): Promise<string>;
  consumeRateLimit(input: {
    namespace: "external-guest-write" | "self-rsvp-write";
    identifier: string;
    limit: number;
    windowSeconds: number;
    cost: number;
  }): Promise<{ allowed: boolean }>;
  onRateLimitUnavailable(
    scope: "external_guest" | "self_rsvp",
  ): Promise<void>;
  resolveEventForRosterWrite(input: {
    venueId: string;
    businessDate: string;
    eventId?: string | null;
    purpose: "register";
  }): Promise<{ id: string }>;
  hashOwnerKey?: (ownerKey: string) => Promise<string>;
  createId?: () => string;
  now?: () => Date;
}

interface PendingExternalBulkGuest {
  index: number;
  id: string;
  name: string;
  key: string;
  allowDuplicate: boolean;
}

function resultError<T>(error: string): ExternalLinkPublicResult<T> {
  return { data: null, error };
}

function toExternalLinkPublicGuest(
  guest: ExternalLinkPublicGuestRecord,
): ExternalLinkPublicGuest {
  return {
    id: guest.id,
    name: guest.name,
    status: guest.status,
    checkInTime: guest.checkInTime ?? null,
    createdAt: guest.createdAt,
  };
}

function isExpired(expiresAt: string | null, now: () => Date): boolean {
  return Boolean(
    expiresAt && new Date(expiresAt).getTime() <= now().getTime(),
  );
}

function isAvailableLink(
  link: ExternalLinkPublicRecord | null,
  now: () => Date,
): link is ExternalLinkPublicRecord & { date: string } {
  return Boolean(
    link &&
      !link.deletedAt &&
      link.active &&
      !isExpired(link.expiresAt, now) &&
      link.date &&
      isValidExternalLinkDate(link.date),
  );
}

function tenantAllowsVenue(
  tenant: ExternalLinkPublicTenantContext,
  venueId: string,
): boolean {
  return Boolean(
    tenant.resolved &&
      (tenant.scope !== "venue" || tenant.venueId === venueId),
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

function createId(dependencies: ExternalLinkPublicServiceDependencies): string {
  return (dependencies.createId ?? (() => crypto.randomUUID()))();
}

async function isRateLimitAllowed(
  scope: "external_guest" | "self_rsvp",
  linkId: string,
  cost: number,
  dependencies: ExternalLinkPublicServiceDependencies,
): Promise<boolean> {
  // Preserve the legacy boundary: request-header failures are operation
  // failures, while only the best-effort KV consume is fail-open.
  const identifier = `${linkId}:${await dependencies.getRequestIp()}`;
  try {
    const rateLimit = await dependencies.consumeRateLimit({
      namespace:
        scope === "self_rsvp"
          ? "self-rsvp-write"
          : "external-guest-write",
      identifier,
      limit: EXTERNAL_GUEST_RATE_LIMIT_NAMES,
      windowSeconds: EXTERNAL_GUEST_RATE_LIMIT_WINDOW_SECONDS,
      cost,
    });
    return rateLimit.allowed;
  } catch {
    // D1's scoped atomic predicates remain authoritative when the best-effort
    // KV shield is unavailable.
    await dependencies.onRateLimitUnavailable(scope);
    return true;
  }
}

export async function loadPublicExternalLinkKind(
  token: string,
  dependencies: Pick<ExternalLinkPublicServiceDependencies, "persistence">,
): Promise<string | null> {
  return dependencies.persistence.loadLinkKindByToken(token);
}

export async function validatePublicExternalToken(
  input: { token: string; ownerKey?: string | null },
  dependencies: Pick<
    ExternalLinkPublicServiceDependencies,
    "persistence" | "getTenantContext" | "hashOwnerKey" | "now"
  >,
): Promise<
  ExternalLinkPublicResult<ExternalLinkPublicValidationData>
> {
  const now = dependencies.now ?? (() => new Date());
  const link = await dependencies.persistence.loadLinkByToken(input.token);
  if (!isAvailableLink(link, now)) {
    return resultError(INVALID_EXTERNAL_LINK_ERROR);
  }

  const tenant = await dependencies.getTenantContext();
  if (!tenantAllowsVenue(tenant, link.venueId)) {
    return resultError(INVALID_EXTERNAL_LINK_ERROR);
  }

  const venue = await dependencies.persistence.loadVenue(link.venueId);
  if (!venue?.active) {
    return resultError(INVALID_EXTERNAL_LINK_ERROR);
  }

  let guestRows: ExternalLinkPublicGuestRecord[] = [];
  if (link.kind === "self_rsvp") {
    if (isValidExternalOwnerKey(input.ownerKey)) {
      const ownerKeyHash = await (
        dependencies.hashOwnerKey ?? hashOpaqueIdentifier
      )(input.ownerKey);
      const ownedGuest = await dependencies.persistence.findOwnedGuest({
        linkId: link.id,
        ownerKeyHash,
      });
      if (ownedGuest) guestRows = [ownedGuest];
    }
  } else {
    guestRows = await dependencies.persistence.listActiveGuestsForLink(
      link.id,
    );
  }

  const publicLink = toExternalDJLink(link);
  delete publicLink.contributorId;
  return {
    data: {
      link: {
        ...publicLink,
        usedGuests:
          link.kind === "self_rsvp" ? guestRows.length : link.usedGuests,
      },
      venue,
      guests: guestRows.map(toExternalLinkPublicGuest),
    },
    error: null,
  };
}

export async function createPublicGuestsViaExternalLink(
  input: {
    token: string;
    date: string;
    items: BulkGuestCreateInput[];
  },
  dependencies: ExternalLinkPublicServiceDependencies,
): Promise<ExternalLinkPublicResult<ExternalLinkPublicGuestCreateResult>> {
  if (!isValidExternalLinkDate(input.date)) {
    return resultError("INVALID_DATE");
  }
  if (!Array.isArray(input.items) || input.items.length > MAX_BULK_WRITE_NAMES) {
    return resultError("BULK_LIMIT_EXCEEDED");
  }
  if (input.items.length === 0) {
    return { data: { items: [] }, error: null };
  }

  const now = dependencies.now ?? (() => new Date());
  const link = await dependencies.persistence.loadLinkByToken(input.token);
  if (!isAvailableLink(link, now)) {
    return resultError(PUBLIC_LINK_INVALID_ERROR);
  }
  const tenant = await dependencies.getTenantContext();
  if (!tenantAllowsVenue(tenant, link.venueId)) {
    return resultError(PUBLIC_LINK_INVALID_ERROR);
  }
  if (!(await dependencies.persistence.isVenueActive(link.venueId))) {
    return resultError(PUBLIC_LINK_INVALID_ERROR);
  }
  if (input.date !== link.date) {
    return resultError("Guest date does not match this link.");
  }
  if (link.kind === "self_rsvp") {
    return resultError("SELF_RSVP_BULK_UNSUPPORTED");
  }

  const event = await dependencies.resolveEventForRosterWrite({
    venueId: link.venueId,
    businessDate: link.date,
    eventId: link.eventId,
    purpose: "register",
  });
  if (
    !(await isRateLimitAllowed(
      "external_guest",
      link.id,
      input.items.length,
      dependencies,
    ))
  ) {
    return resultError("RATE_LIMITED");
  }

  const existingNames = await dependencies.persistence.listActiveGuestNames(
    link.id,
  );
  const seenKeys = new Set<string>();
  for (const existingName of existingNames) {
    const prepared = prepareGuestName(existingName);
    if (prepared.error === null) seenKeys.add(prepared.key);
  }

  const itemResults: ExternalLinkPublicGuestCreateItemResult[] = input.items.map(
    (_, index) => ({ index, status: "invalid_name", guest: null }),
  );
  const pendingGuests: PendingExternalBulkGuest[] = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const item = parseBulkGuestCreateInput(input.items[index]);
    if (!item) continue;
    const prepared = prepareGuestName(item.name);
    if (prepared.error !== null) continue;

    if (seenKeys.has(prepared.key) && !item.allowDuplicate) {
      itemResults[index] = {
        index,
        status: "duplicate_requires_confirmation",
        guest: null,
      };
      continue;
    }

    seenKeys.add(prepared.key);
    pendingGuests.push({
      index,
      id: createId(dependencies),
      name: toStoredGuestName(prepared.name),
      key: prepared.key,
      allowDuplicate: item.allowDuplicate,
    });
  }

  if (pendingGuests.length === 0) {
    return { data: { items: itemResults }, error: null };
  }

  const occurredAt = now().toISOString();
  const guardedNames = Array.from(
    new Set(
      pendingGuests
        .filter((guest) => !guest.allowDuplicate)
        .map((guest) => guest.name),
    ),
  );
  const activityIds = pendingGuests.map(() => createId(dependencies));
  const writes = pendingGuests.map((guest, index) => ({
    id: guest.id,
    name: guest.name,
    activityId: activityIds[index],
    requestId: createId(dependencies),
  }));
  const writeResult = await dependencies.persistence.reserveBulkGuests({
    linkId: link.id,
    venueId: link.venueId,
    eventId: event.id,
    date: input.date,
    occurredAt,
    guardedNames,
    guests: writes,
  });

  if (!writeResult.reserved) {
    const currentLink = await dependencies.persistence.loadLinkById(link.id);
    if (!isAvailableLink(currentLink, now)) {
      return resultError(PUBLIC_LINK_INVALID_ERROR);
    }
    if (currentLink.date && currentLink.date !== input.date) {
      return resultError("Guest date does not match this link.");
    }
    const concurrentDuplicateNames =
      await dependencies.persistence.listMatchingActiveGuestNames({
        linkId: link.id,
        names: guardedNames,
      });
    const concurrentDuplicateKeys = new Set(
      concurrentDuplicateNames.flatMap((name) => {
        const prepared = prepareGuestName(name);
        return prepared.error === null ? [prepared.key] : [];
      }),
    );
    const rosterChanged = concurrentDuplicateKeys.size > 0;
    for (const pendingGuest of pendingGuests) {
      itemResults[pendingGuest.index] = {
        index: pendingGuest.index,
        status: rosterChanged
          ? !pendingGuest.allowDuplicate &&
            concurrentDuplicateKeys.has(pendingGuest.key)
            ? "duplicate_requires_confirmation"
            : "batch_changed"
          : "limit_reached",
        guest: null,
      };
    }
    return { data: { items: itemResults }, error: null };
  }

  const allInserted = pendingGuests.every(
    (guest, index) =>
      writeResult.insertedGuestIds.includes(guest.id) &&
      writeResult.recordedActivityIds.includes(activityIds[index]),
  );
  if (!allInserted) {
    throw new Error("External bulk guest insert was not atomic");
  }

  const createdRows = await dependencies.persistence.loadGuestsByIds(
    pendingGuests.map((guest) => guest.id),
  );
  const createdById = new Map(createdRows.map((guest) => [guest.id, guest]));
  for (const pendingGuest of pendingGuests) {
    const guest = createdById.get(pendingGuest.id);
    if (!guest) {
      throw new Error("External bulk guest insert could not be read back");
    }
    itemResults[pendingGuest.index] = {
      index: pendingGuest.index,
      status: "created",
      guest: toExternalLinkPublicGuest(guest),
    };
  }
  return { data: { items: itemResults }, error: null };
}

export async function createPublicSelfRsvpGuest(
  input: {
    token: string;
    ownerKey: string;
    guestName: string;
    date: string;
  },
  dependencies: ExternalLinkPublicServiceDependencies,
): Promise<ExternalLinkPublicResult<ExternalLinkPublicGuest>> {
  if (!isValidExternalOwnerKey(input.ownerKey)) {
    return resultError("INVALID_SELF_RSVP_OWNER");
  }
  if (!isValidExternalLinkDate(input.date)) {
    return resultError("INVALID_DATE");
  }
  const preparedName = prepareGuestName(input.guestName);
  if (preparedName.error !== null) {
    return resultError("INVALID_GUEST_NAME");
  }

  const now = dependencies.now ?? (() => new Date());
  const link = await dependencies.persistence.loadLinkByToken(input.token);
  if (!isAvailableLink(link, now) || link.kind !== "self_rsvp") {
    return resultError(PUBLIC_LINK_INVALID_ERROR);
  }
  const tenant = await dependencies.getTenantContext();
  if (!tenantAllowsVenue(tenant, link.venueId)) {
    return resultError(PUBLIC_LINK_INVALID_ERROR);
  }
  if (!(await dependencies.persistence.isVenueActive(link.venueId))) {
    return resultError(PUBLIC_LINK_INVALID_ERROR);
  }
  if (input.date !== link.date) {
    return resultError("Guest date does not match this link.");
  }

  const ownerKeyHash = await (
    dependencies.hashOwnerKey ?? hashOpaqueIdentifier
  )(input.ownerKey);
  const existing = await dependencies.persistence.findOwnedGuest({
    linkId: link.id,
    ownerKeyHash,
  });
  if (existing) {
    return { data: toExternalLinkPublicGuest(existing), error: null };
  }

  if (
    !(await isRateLimitAllowed(
      "self_rsvp",
      link.id,
      1,
      dependencies,
    ))
  ) {
    return resultError("RATE_LIMITED");
  }

  const event = await dependencies.resolveEventForRosterWrite({
    venueId: link.venueId,
    businessDate: link.date,
    eventId: link.eventId,
    purpose: "register",
  });
  const guestId = createId(dependencies);
  const activityId = createId(dependencies);
  const occurredAt = now().toISOString();
  const writeResult = await dependencies.persistence.reserveSelfRsvpGuest({
    link,
    ownerKeyHash,
    guestId,
    guestName: toStoredGuestName(preparedName.name),
    eventId: event.id,
    activityId,
    requestId: createId(dependencies),
    occurredAt,
  });
  if (!writeResult.reserved) {
    const concurrent = await dependencies.persistence.findOwnedGuest({
      linkId: link.id,
      ownerKeyHash,
    });
    return concurrent
      ? { data: toExternalLinkPublicGuest(concurrent), error: null }
      : resultError("Guest limit reached for this link.");
  }
  if (
    !writeResult.guestInserted ||
    !writeResult.ownerInserted ||
    !writeResult.activityRecorded
  ) {
    throw new Error("Self RSVP guest insert was not atomic");
  }
  const created = await dependencies.persistence.loadGuestForLink({
    guestId,
    linkId: link.id,
  });
  if (!created) throw new Error("Self RSVP guest could not be read back");
  return { data: toExternalLinkPublicGuest(created), error: null };
}

export async function updatePublicGuestViaExternalLink(
  input: {
    token: string;
    ownerKey: string;
    guestId: string;
    guestName: string;
  },
  dependencies: ExternalLinkPublicServiceDependencies,
): Promise<ExternalLinkPublicResult<ExternalLinkPublicGuest>> {
  if (!isValidExternalOwnerKey(input.ownerKey)) {
    return resultError("INVALID_SELF_RSVP_OWNER");
  }
  const preparedName = prepareGuestName(input.guestName);
  if (preparedName.error !== null) {
    return resultError("INVALID_GUEST_NAME");
  }

  const now = dependencies.now ?? (() => new Date());
  const link = await dependencies.persistence.loadLinkByToken(input.token);
  if (!isAvailableLink(link, now) || link.kind !== "self_rsvp") {
    return resultError(PUBLIC_LINK_INVALID_ERROR);
  }
  const tenant = await dependencies.getTenantContext();
  if (!tenantAllowsVenue(tenant, link.venueId)) {
    return resultError(PUBLIC_LINK_INVALID_ERROR);
  }
  const ownerKeyHash = await (
    dependencies.hashOwnerKey ?? hashOpaqueIdentifier
  )(input.ownerKey);
  const current = await dependencies.persistence.findOwnedGuest({
    linkId: link.id,
    ownerKeyHash,
  });
  if (
    !current ||
    current.id !== input.guestId ||
    current.status !== "pending"
  ) {
    return resultError("Unable to update this RSVP.");
  }

  const occurredAt = now().toISOString();
  const activityId = createId(dependencies);
  const updated = await dependencies.persistence.updateSelfRsvpGuest({
    link,
    guest: current,
    ownerKeyHash,
    guestName: toStoredGuestName(preparedName.name),
    activityId,
    requestId: createId(dependencies),
    occurredAt,
  });
  if (!updated) return resultError("Unable to update this RSVP.");
  const updatedGuest = await dependencies.persistence.findOwnedGuest({
    linkId: link.id,
    ownerKeyHash,
  });
  return updatedGuest
    ? { data: toExternalLinkPublicGuest(updatedGuest), error: null }
    : resultError("Unable to update this RSVP.");
}

export async function deletePublicGuestViaExternalLink(
  input: {
    token: string;
    guestId: string;
    ownerKey?: string | null;
  },
  dependencies: ExternalLinkPublicServiceDependencies,
): Promise<{ error: string | null }> {
  const now = dependencies.now ?? (() => new Date());
  const link = await dependencies.persistence.loadLinkByToken(input.token);
  if (!isAvailableLink(link, now)) {
    return { error: PUBLIC_LINK_INVALID_ERROR };
  }
  const tenant = await dependencies.getTenantContext();
  if (!tenantAllowsVenue(tenant, link.venueId)) {
    return { error: PUBLIC_LINK_INVALID_ERROR };
  }
  if (!(await dependencies.persistence.isVenueActive(link.venueId))) {
    return { error: PUBLIC_LINK_INVALID_ERROR };
  }

  let ownerKeyHash: string | null = null;
  let guest: Pick<Guest, "id" | "status" | "externalLinkId"> | null = null;
  if (link.kind === "self_rsvp") {
    if (!isValidExternalOwnerKey(input.ownerKey)) {
      return { error: "Unable to delete this RSVP." };
    }
    ownerKeyHash = await (
      dependencies.hashOwnerKey ?? hashOpaqueIdentifier
    )(input.ownerKey);
    const owned = await dependencies.persistence.findOwnedGuest({
      linkId: link.id,
      ownerKeyHash,
    });
    if (owned?.id === input.guestId) guest = owned;
  } else {
    const candidate = await dependencies.persistence.loadGuestCandidate(
      input.guestId,
    );
    if (candidate?.externalLinkId === link.id) guest = candidate;
  }
  if (!guest || guest.status !== "pending") {
    return { error: "Unable to delete this guest from this link." };
  }

  const occurredAt = now().toISOString();
  const deleted = await dependencies.persistence.deletePendingGuest({
    link,
    guest,
    ownerKeyHash,
    activityId: createId(dependencies),
    requestId: createId(dependencies),
    occurredAt,
  });
  return deleted
    ? { error: null }
    : { error: "Unable to delete this guest from this link." };
}
